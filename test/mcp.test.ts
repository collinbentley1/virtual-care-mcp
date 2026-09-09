import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMockPaymentPayload, mockPaymentRequiredSchema, syntheticFhirBundleSchema } from "../src/billing.ts";
import { advanceInputSchema, careResultSchema, mediaResultSchema, type CareResult, type VisitCommand, type VisitEnvelope } from "../src/contracts.ts";
import { getVisitResourceUri, paymentInputSchema, type McpOptions } from "../src/mcp.ts";
import { createSqliteStore } from "../src/persistence.ts";
import { createRequestHandler, type RequestHandlerOptions } from "../src/server.ts";
import { createCareService } from "../src/visit.ts";
import { omitNullObjectProperties } from "./host/null-omission.ts";

const publicOrigin = "https://care.example";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const action of cleanup.splice(0)) await action(); });

async function harness(media?: McpOptions["media"], overrides: Partial<RequestHandlerOptions> = {}) {
	let time = new Date("2030-09-09T14:00:00.000Z");
	const store = await createSqliteStore(":memory:");
	const care = createCareService({ store, now: () => time });
	const uiHtml = overrides.uiHtml ?? '<!doctype html><title>Synthetic visit</title><script type="importmap">{"imports":{"virtual-care-livekit":"__VIRTUAL_CARE_ASSET_ORIGIN__/livekit.js"}}</script>';
	const configuredOrigin = overrides.publicOrigin ?? publicOrigin;
	const mediaConnectOrigins = overrides.mediaConnectOrigins ?? ["wss://media.example", "https://media.example"];
	const resourceUri = getVisitResourceUri({ uiHtml, publicOrigin: configuredOrigin, mediaConnectOrigins });
	const handle = createRequestHandler({
		care, publicOrigin: configuredOrigin, uiHtml,
		browserHtml: "<!doctype html><title>Browser visit</title>", deploymentNonce: "fixture-deployment", media,
		mediaConnectOrigins,
		...overrides,
	});
	const client = new Client({ name: "virtual-care-transport-test", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(`${publicOrigin}/mcp`), {
		fetch: async (input, init) => handle(new Request(input, init)),
	});
	cleanup.push(async () => { await client.close(); store.close(); });
	await client.connect(transport);
	const call = async (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) =>
		CallToolResultSchema.parse(await client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) }));
	const post = (path: string, value: unknown, headers: Record<string, string> = {}) => handle(new Request(`${publicOrigin}${path}`, {
		method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
	}));
	return { client, handle, call, post, resourceUri, advanceTime: (milliseconds: number) => { time = new Date(time.getTime() + milliseconds); } };
}

type Harness = Awaited<ReturnType<typeof harness>>;
async function nullOmittingHost(h: Harness, options: { promoteToolErrors?: boolean } = {}) {
	const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
	const app = new App({ name: "Synthetic visit test app", version: "1.0.0" }, {}, { autoResize: false });
	const host = new AppBridge(null, { name: "Null-omitting host fixture", version: "1.0.0" }, { serverTools: {} });
	let fixtureResult: CallToolResult | undefined;
	let promotedErrors = 0;
	host.oncalltool = async (params) => {
		const result = fixtureResult ?? await h.call(params.name, params.arguments ?? {}, params._meta);
		if (options.promoteToolErrors && result.isError) {
			promotedErrors += 1;
			throw new Error("The host did not deliver the tool's error result.");
		}
		return CallToolResultSchema.parse(omitNullObjectProperties(result));
	};
	cleanup.push(async () => { await app.close(); await host.close(); });
	await host.connect(hostTransport);
	await app.connect(appTransport);
	return { app, respondWith: (result: CallToolResult) => { fixtureResult = result; }, promotedErrorCount: () => promotedErrors };
}
const fictionalIntake = {
	reason: "This is a fictional routine follow-up. I'd like to practice explaining what I want to discuss.",
	goals: "Practice asking questions and reviewing the next steps.",
	medications: "No real medication information entered.",
	allergies: "No real allergy information entered.",
	communicationNotes: "Please use clear language and leave time for questions.",
};
function saved(value: unknown): VisitEnvelope {
	const result = careResultSchema.parse(value);
	if (result.kind !== "ok") throw new Error(`Expected a saved synthetic visit, received ${result.kind}.`);
	return result.envelope;
}
async function act(h: Harness, current: VisitEnvelope, command: VisitCommand): Promise<VisitEnvelope> {
	const input = advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), command });
	return saved((await h.call("care_advance", input)).structuredContent);
}
async function prepared(h: Harness): Promise<VisitEnvelope> {
	let current = saved((await h.call("care_start", { scenarioId: "rural-adult" })).structuredContent);
	current = await act(h, current, { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
	return act(h, current, { kind: "save_intake", intake: {
		reason: "Fictional follow-up visit", goals: "Practice asking questions.", medications: "None in this fictional fixture.", allergies: "None in this fixture.", communicationNotes: "Please speak slowly.",
	}, access: current.snapshot.access });
}
async function quoted(h: Harness) {
	const current = await act(h, await prepared(h), { kind: "select_payment", choice: { kind: "self-pay" } });
	if (current.snapshot.state.kind !== "payment") throw new Error("The demo quote was not prepared.");
	const quote = current.snapshot.state.quote;
	const input = paymentInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), quoteId: quote.id, outcome: "approve" });
	return { current, quote, input };
}
const consent: VisitCommand = {
	kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true,
	understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true,
};

describe("MCP Apps transport", () => {
	test("a real App round trip restores omitted nullable coverage after intake, replay, resume, and cancellation", async () => {
		const { app } = await nullOmittingHost(await harness());
		const call = (name: string, args: Record<string, unknown>) => app.callServerTool({ name, arguments: args });
		let current = saved((await call("care_start", { scenarioId: "older-adult" })).structuredContent);
		const inputFor = (command: VisitCommand) => advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), command });
		current = saved((await call("care_advance", inputFor({ kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" }))).structuredContent);
		const input = inputFor({ kind: "save_intake", intake: fictionalIntake, access: { ...current.snapshot.access, mode: "text" } });
		const result = await call("care_advance", input);
		expect(result.structuredContent).not.toHaveProperty("envelope.snapshot.state.insuranceCheck");
		current = saved(result.structuredContent);
		expect(current.snapshot).toMatchObject({ revision: 2, state: { kind: "coverage", insuranceCheck: null, intake: fictionalIntake }, access: { mode: "text", language: "en", largeText: true, captionsRequested: true, caregiver: { kind: "requested", name: "Alex, sample caregiver" } } });
		expect(careResultSchema.parse((await call("care_advance", input)).structuredContent)).toMatchObject({ kind: "ok", replayed: true, envelope: { snapshot: { revision: 2, state: { insuranceCheck: null } } } });
		const resumed = await call("care_resume", { credential: current.credential });
		expect(resumed.structuredContent).not.toHaveProperty("envelope.snapshot.state.insuranceCheck");
		expect(saved(resumed.structuredContent).snapshot).toEqual(current.snapshot);
		const cancelled = await call("care_advance", inputFor({ kind: "cancel_visit" }));
		expect(cancelled.structuredContent).not.toHaveProperty("envelope.snapshot.state.previous.insuranceCheck");
		expect(saved(cancelled.structuredContent).snapshot).toMatchObject({ revision: 3, state: { kind: "cancelled", previous: { kind: "coverage", insuranceCheck: null } } });
	});

	test("host omission restores unknown estimates while required fields, invalid values, and strict objects still reject", async () => {
		expect(omitNullObjectProperties({ object: { absent: null, zero: 0, flag: false }, array: [null, { absent: null }] })).toEqual({ object: { zero: 0, flag: false }, array: [null, {}] });
		const { app, respondWith } = await nullOmittingHost(await harness());
		const call = (name: string, args: Record<string, unknown>) => app.callServerTool({ name, arguments: args });
		let current = saved((await call("care_start", { scenarioId: "older-adult" })).structuredContent);
		const inputFor = (command: VisitCommand) => advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), command });
		current = saved((await call("care_advance", inputFor({ kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" }))).structuredContent);
		current = saved((await call("care_advance", inputFor({ kind: "save_intake", intake: fictionalIntake, access: { ...current.snapshot.access, mode: "text" } }))).structuredContent);
		const result = await call("care_advance", inputFor({ kind: "select_payment", choice: { kind: "insurance", scenario: "benefits-unavailable" } }));
		expect(result.structuredContent).not.toHaveProperty("envelope.snapshot.state.insuranceCheck.patientEstimateCents");
		const decoded = careResultSchema.parse(result.structuredContent);
		if (decoded.kind !== "ok" || decoded.envelope.snapshot.state.kind !== "coverage" || !decoded.envelope.snapshot.state.insuranceCheck) throw new Error("Expected a completed insurance fixture check.");
		current = decoded.envelope;
		const state = decoded.envelope.snapshot.state;
		expect(state.insuranceCheck).toMatchObject({ status: "unknown", patientEstimateCents: null, scenario: "benefits-unavailable" });
		const cancelled = await call("care_advance", inputFor({ kind: "cancel_visit" }));
		expect(cancelled.structuredContent).not.toHaveProperty("envelope.snapshot.state.previous.insuranceCheck.patientEstimateCents");
		expect(saved(cancelled.structuredContent).snapshot.state).toMatchObject({ kind: "cancelled", previous: { kind: "coverage", insuranceCheck: { patientEstimateCents: null } } });
		const withoutReason: Record<string, unknown> = { ...state.intake };
		delete withoutReason.reason;
		const cases = [
			{ label: "missing intake reason", state: { ...state, intake: withoutReason } },
			{ label: "invalid check value", state: { ...state, insuranceCheck: "unknown" } },
			{ label: "negative estimate", state: { ...state, insuranceCheck: { ...state.insuranceCheck, patientEstimateCents: -1 } } },
			{ label: "invalid estimate type", state: { ...state, insuranceCheck: { ...state.insuranceCheck, patientEstimateCents: "unknown" } } },
			{ label: "unexpected state property", state: { ...state, unexpected: true } },
		];
		for (const fixture of cases) {
			respondWith({ ...result, structuredContent: { ...decoded, envelope: { ...decoded.envelope, snapshot: { ...decoded.envelope.snapshot, state: fixture.state } } } });
			const response = await call("care_resume", { credential: current.credential });
			expect(careResultSchema.safeParse(response.structuredContent).success, fixture.label).toBe(false);
		}
		respondWith({ ...result, structuredContent: { ...decoded, envelope: { ...decoded.envelope, snapshot: { ...decoded.envelope.snapshot, state: { ...state, insuranceCheck: { ...state.insuranceCheck, patientEstimateCents: 3500 } } } } } });
		expect(saved((await call("care_resume", { credential: current.credential })).structuredContent).snapshot.state).toMatchObject({ kind: "coverage", insuranceCheck: { patientEstimateCents: 3500 } });
	});

	test("derives an immutable resource URI from final HTML and resource metadata", () => {
		const identity = {
			uiHtml: '<!doctype html><script type="importmap">{"imports":{"livekit":"__VIRTUAL_CARE_ASSET_ORIGIN__/livekit.js"}}</script>',
			publicOrigin: "https://care.example",
			mediaConnectOrigins: ["wss://media.example", "https://media.example"],
		};
		expect(getVisitResourceUri(identity)).toBe(getVisitResourceUri({ ...identity }));
		expect(getVisitResourceUri({ ...identity, uiHtml: `${identity.uiHtml}<!-- updated -->` })).not.toBe(getVisitResourceUri(identity));
		expect(getVisitResourceUri({ ...identity, mediaConnectOrigins: ["wss://other-media.example", "https://other-media.example"] })).not.toBe(getVisitResourceUri(identity));
		expect(getVisitResourceUri({ ...identity, publicOrigin: "https://other-care.example" })).not.toBe(getVisitResourceUri(identity));
	});

	test("advertises standard resource metadata, strict inputs, and app-only media access", async () => {
		const h = await harness();
		const tools = await h.client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
			"care_advance", "care_export", "care_media", "care_render", "care_resume", "care_simulate_payment", "care_start",
		]);
		expect(tools.tools.find((tool) => tool.name === "care_render")?._meta).toMatchObject({ ui: { resourceUri: h.resourceUri } });
		expect(tools.tools.find((tool) => tool.name === "care_media")?._meta).toEqual({ ui: { visibility: ["app"] } });
		expect(tools.tools.find((tool) => tool.name === "care_advance")?.inputSchema.additionalProperties).toBe(false);
		const resources = await h.client.listResources();
		expect(resources.resources.map((resource) => resource.uri)).toEqual([h.resourceUri]);
		const resource = await h.client.readResource({ uri: h.resourceUri });
		expect(resource.contents[0]).toMatchObject({
			uri: h.resourceUri, mimeType: "text/html;profile=mcp-app",
			_meta: { ui: { permissions: { camera: {}, microphone: {} }, csp: { connectDomains: ["wss://media.example", "https://media.example"], resourceDomains: [publicOrigin], frameDomains: [] } } },
		});
		expect(resource.contents[0]).toMatchObject({ text: expect.stringContaining(`${publicOrigin}/livekit.js`) });
		expect(JSON.stringify(resource)).not.toContain("__VIRTUAL_CARE_ASSET_ORIGIN__");
		expect((await h.call("care_start", { scenarioId: "rural-adult", patientName: "Unexpected input" })).isError).toBe(true);
	});

	test("completes a visit through the official client and exports the saved synthetic record", async () => {
		const h = await harness();
		let current = await prepared(h);
		current = await act(h, current, { kind: "select_payment", choice: { kind: "insurance", scenario: "claim-denied" } });
		current = await act(h, current, consent);
		current = await act(h, current, { kind: "enter_consultation", mode: "text" });
		current = await act(h, current, { kind: "send_demo_message", text: "A fictional question for this rehearsal." });
		current = await act(h, current, { kind: "finish_consultation" });
		const rendered = await h.call("care_render", { credential: current.credential });
		expect(saved(rendered.structuredContent)).toEqual(current);
		expect(rendered._meta?.["virtual-care/browserUrl"]).toBe(publicOrigin);
		const exported = await h.call("care_export", { credential: current.credential });
		const bundle = syntheticFhirBundleSchema.parse(exported.structuredContent);
		expect(bundle.entry.map((entry) => entry.resource.resourceType)).toContain("ExplanationOfBenefit");
		const record = bundle.entry.find((entry) => entry.resource.resourceType === "DocumentReference" && entry.resource.id === "record")?.resource;
		if (record?.resourceType !== "DocumentReference") throw new Error("The saved record is missing.");
		const attachment = record.content[0]?.attachment;
		if (!attachment) throw new Error("The snapshot attachment is missing.");
		expect(JSON.parse(Buffer.from(attachment.data, "base64").toString("utf8"))).toEqual(current.snapshot);
		expect(JSON.stringify(bundle)).not.toContain(current.credential);
	});

	test("preserves committed retries and exposes revision conflicts without applying stale commands", async () => {
		const h = await harness();
		const current = saved((await h.call("care_start", {})).structuredContent);
		const args = { credential: current.credential, expectedRevision: 0, commandId: crypto.randomUUID(), command: { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" } };
		saved((await h.call("care_advance", args)).structuredContent);
		const replay = careResultSchema.parse((await h.call("care_advance", args)).structuredContent);
		expect(replay.kind === "ok" && replay.replayed).toBe(true);
		const conflict = careResultSchema.parse((await h.call("care_advance", { ...args, commandId: crypto.randomUUID() })).structuredContent);
		expect(conflict.kind).toBe("conflict");
		if (conflict.kind === "conflict") expect(conflict.envelope.snapshot.revision).toBe(1);
		expect(careResultSchema.parse((await h.call("care_advance", { ...args, expectedRevision: 1 })).structuredContent)).toMatchObject({ kind: "error", code: "command_reused" });
	});

	test("returns temporary media only in app metadata and denies media outside consultation", async () => {
		const h = await harness(async () => ({ kind: "livekit", token: "synthetic-secret-token", serverUrl: "wss://media.example", roomName: "demo-room", participantIdentity: "demo-tester", expiresAt: "2030-09-09T14:02:00.000Z" }));
		let current = await prepared(h);
		expect((await h.call("care_media", { credential: current.credential, mode: "audio" })).isError).toBe(true);
		current = await act(h, current, { kind: "select_payment", choice: { kind: "assistance" } });
		current = await act(h, current, consent);
		current = await act(h, current, { kind: "enter_consultation", mode: "audio" });
		const result = await h.call("care_media", { credential: current.credential, mode: "audio" });
		expect(mediaResultSchema.parse(result._meta?.["virtual-care/media"]).kind).toBe("livekit");
		expect(result.structuredContent).toBeUndefined();
		expect(JSON.stringify(result.content)).not.toContain("synthetic-secret-token");
		current = await act(h, current, { kind: "finish_consultation" });
		expect((await h.call("care_media", { credential: current.credential, mode: "audio" })).isError).toBe(true);
	});
});

describe("synthetic x402 exchange", () => {
	test("advertises the authoritative current offer while retaining MCP and HTTP challenges and proof binding", async () => {
		const h = await harness();
		const preparedVisit = await prepared(h);
		const response = await h.call("care_advance", advanceInputSchema.parse({ credential: preparedVisit.credential, expectedRevision: preparedVisit.snapshot.revision, commandId: crypto.randomUUID(), command: { kind: "select_payment", choice: { kind: "self-pay" } } }));
		const current = saved(response.structuredContent);
		if (current.snapshot.state.kind !== "payment") throw new Error("The demo quote was not prepared.");
		const quote = current.snapshot.state.quote;
		const required = mockPaymentRequiredSchema.parse(response._meta?.["virtual-care/payment-required"]);
		expect(response.isError).toBe(false);
		expect(required.resource.url).toBe(`${publicOrigin}/api/visits/${current.snapshot.visitId}/quotes/${quote.id}`);
		expect(required.accepts[0]).toMatchObject({ amount: String(quote.amountCents * 10_000), extra: { name: `DEMO-${quote.currency}`, quoteId: quote.id, expiresAt: quote.expiresAt } });
		expect(JSON.stringify(required)).not.toContain(current.credential);
		expect(response.structuredContent).not.toHaveProperty("virtual-care/payment-required");
		for (const name of ["care_resume", "care_render"]) expect((await h.call(name, { credential: current.credential }))._meta?.["virtual-care/payment-required"]).toEqual(required);
		const conflict = await h.call("care_advance", advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision - 1, commandId: crypto.randomUUID(), command: { kind: "set_access", access: current.snapshot.access } }));
		expect(careResultSchema.parse(conflict.structuredContent).kind).toBe("conflict");
		expect(conflict._meta?.["virtual-care/payment-required"]).toEqual(required);
		const input = paymentInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), quoteId: quote.id, outcome: "approve" });
		const challenge = await h.call("care_simulate_payment", input);
		expect(challenge.isError).toBe(true);
		expect(challenge.structuredContent).toEqual(required);
		const native = await h.post("/api/visits/payment", input);
		expect(native.status).toBe(402);
		expect(await native.json()).toEqual(required);
		expect(JSON.parse(Buffer.from(native.headers.get("PAYMENT-REQUIRED") ?? "", "base64").toString("utf8"))).toEqual(required);
		const proof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
		const tampered = [
			{ ...proof, resource: { ...proof.resource, url: `https://other.example/api/visits/${current.snapshot.visitId}/quotes/${quote.id}` } },
			{ ...proof, resource: { ...proof.resource, url: `${publicOrigin}/api/visits/${crypto.randomUUID()}/quotes/${quote.id}` } },
			{ ...proof, resource: { ...proof.resource, url: `${publicOrigin}/api/visits/${current.snapshot.visitId}/quotes/${crypto.randomUUID()}` } },
			{ ...proof, payload: { ...proof.payload, quoteId: crypto.randomUUID() } },
			{ ...proof, accepted: { ...proof.accepted, amount: "36000000" } },
			{ ...proof, accepted: { ...proof.accepted, extra: { ...proof.accepted.extra, name: "DEMO-EUR" } } },
			{ ...proof, accepted: { ...proof.accepted, extra: { ...proof.accepted.extra, expiresAt: new Date(Date.parse(quote.expiresAt) + 1000).toISOString() } } },
		];
		for (const payload of tampered) {
			const rejected = await h.call("care_simulate_payment", input, { "x402/payment": payload });
			expect(rejected.isError).toBe(true);
			expect(rejected.structuredContent).toEqual(required);
		}
		expect(saved((await h.call("care_resume", { credential: current.credential })).structuredContent).snapshot.revision).toBe(current.snapshot.revision);
		await act(h, current, { kind: "select_payment", choice: { kind: "assistance" } });
		expect((await h.call("care_resume", { credential: current.credential }))._meta?.["virtual-care/payment-required"]).toBeUndefined();
		expect(careResultSchema.parse((await h.call("care_simulate_payment", input, { "x402/payment": proof })).structuredContent).kind).toBe("conflict");
	});

	test("an App uses the offered proof through an error-promoting host and retains it for a consumed-quote replay", async () => {
		const h = await harness();
		const { current, quote, input } = await quoted(h);
		const { app, promotedErrorCount } = await nullOmittingHost(h, { promoteToolErrors: true });
		const resumed = await app.callServerTool({ name: "care_resume", arguments: { credential: current.credential } });
		const required = mockPaymentRequiredSchema.parse(resumed._meta?.["virtual-care/payment-required"]);
		await expect(app.callServerTool({ name: "care_simulate_payment", arguments: input })).rejects.toThrow();
		expect(promotedErrorCount()).toBe(1);
		const declineInput = { ...input, commandId: crypto.randomUUID(), outcome: "decline" };
		const declineProof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: declineInput.commandId });
		const declined = await app.callServerTool({ name: "care_simulate_payment", arguments: declineInput, _meta: { "x402/payment": declineProof } });
		expect(declined.isError).toBe(false);
		expect(careResultSchema.parse(declined.structuredContent)).toMatchObject({ kind: "error", code: "payment_declined" });
		expect(declined._meta?.["x402/payment-response"]).toBeUndefined();
		expect(saved((await h.call("care_resume", { credential: current.credential })).structuredContent).snapshot.revision).toBe(current.snapshot.revision);
		const submitted = { name: "care_simulate_payment", arguments: input, _meta: { "x402/payment": createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId }) } };
		const approved = await app.callServerTool(submitted);
		let paid = saved(approved.structuredContent);
		expect(paid.snapshot.state.kind).toBe("consent");
		expect(paid.snapshot.paymentHistory).toHaveLength(1);
		expect(approved._meta?.["virtual-care/payment-required"]).toBeUndefined();
		expect(approved._meta?.["x402/payment-response"]).toEqual({ success: true, transaction: "", network: "eip155:84532" });
		expect(promotedErrorCount()).toBe(1);
		paid = await act(h, paid, { kind: "select_payment", choice: { kind: "self-pay" } });
		if (paid.snapshot.state.kind !== "payment") throw new Error("The replacement quote was not prepared.");
		expect(paid.snapshot.state.quote.id).not.toBe(quote.id);
		h.advanceTime(20 * 60_000);
		const replay = await app.callServerTool(submitted);
		expect(careResultSchema.parse(replay.structuredContent)).toMatchObject({ kind: "ok", replayed: true });
		expect(saved(replay.structuredContent)).toEqual(paid);
		expect(replay._meta?.["x402/payment-response"]).toBeDefined();
		expect(promotedErrorCount()).toBe(1);
		await expect(app.callServerTool({ ...submitted, arguments: { ...input, outcome: "decline" } })).rejects.toThrow();
		expect(promotedErrorCount()).toBe(2);
	});

	const replacements: Array<"assistance" | "self-pay"> = ["assistance", "self-pay"];
	test.each(replacements)("a cached offer conflicts without payment when another client selects %s without notification", async (replacement) => {
		const h = await harness();
		const { current, quote, input } = await quoted(h);
		const { app, promotedErrorCount } = await nullOmittingHost(h, { promoteToolErrors: true });
		const original = await app.callServerTool({ name: "care_resume", arguments: { credential: current.credential } });
		const required = mockPaymentRequiredSchema.parse(original._meta?.["virtual-care/payment-required"]);
		const submitted = { name: "care_simulate_payment", arguments: input, _meta: { "x402/payment": createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId }) } };
		const otherClient = await h.post("/api/visits/advance", advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), command: { kind: "select_payment", choice: { kind: replacement } } }));
		const changed = saved(await otherClient.json());
		expect(changed.snapshot.revision).toBe(current.snapshot.revision + 1);
		const result = await app.callServerTool(submitted);
		expect(result.isError).toBe(false);
		const conflict = careResultSchema.parse(result.structuredContent);
		expect(conflict).toMatchObject({ kind: "conflict", envelope: changed });
		expect(result._meta?.["x402/payment-response"]).toBeUndefined();
		if (changed.snapshot.state.kind === "payment") {
			const nextOffer = mockPaymentRequiredSchema.parse(result._meta?.["virtual-care/payment-required"]);
			expect(nextOffer.accepts[0].extra.quoteId).toBe(changed.snapshot.state.quote.id);
			expect(nextOffer.accepts[0].extra.quoteId).not.toBe(quote.id);
		} else expect(result._meta?.["virtual-care/payment-required"]).toBeUndefined();
		const repeated = careResultSchema.parse((await app.callServerTool(submitted)).structuredContent);
		expect(repeated).toMatchObject({ kind: "conflict", envelope: changed });
		const latest = saved((await h.call("care_resume", { credential: current.credential })).structuredContent);
		expect(latest.snapshot).toEqual(changed.snapshot);
		expect(latest.snapshot.paymentHistory).toEqual([]);
		expect(promotedErrorCount()).toBe(0);
	});

	test("quote expiry remains a visible domain outcome while unavailable execution remains a tool error", async () => {
		const h = await harness();
		const { current, quote, input } = await quoted(h);
		const { app, promotedErrorCount } = await nullOmittingHost(h, { promoteToolErrors: true });
		const resumed = await app.callServerTool({ name: "care_resume", arguments: { credential: current.credential } });
		const required = mockPaymentRequiredSchema.parse(resumed._meta?.["virtual-care/payment-required"]);
		const proof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
		h.advanceTime(16 * 60_000);
		const expired = await app.callServerTool({ name: "care_simulate_payment", arguments: input, _meta: { "x402/payment": proof } });
		expect(expired.isError).toBe(false);
		expect(careResultSchema.parse(expired.structuredContent)).toMatchObject({ kind: "error", code: "quote_expired" });
		expect(expired._meta?.["x402/payment-response"]).toBeUndefined();
		expect(saved((await h.call("care_resume", { credential: current.credential })).structuredContent).snapshot).toMatchObject({ revision: current.snapshot.revision, paymentHistory: [], state: { kind: "payment" } });
		expect(promotedErrorCount()).toBe(0);
		const unavailable = async (): Promise<CareResult> => ({ kind: "error", code: "temporarily_unavailable", message: "The synthetic fixture service is unavailable." });
		const unavailableHost = await harness(undefined, { care: { start: unavailable, resume: unavailable, advance: unavailable } });
		expect((await unavailableHost.call("care_start", { scenarioId: "older-adult" })).isError).toBe(true);
	});

	test("requires proof, rejects mismatched proof and bypasses, and safely replays after later billing changes", async () => {
		const h = await harness();
		const { current, quote, input } = await quoted(h);
		const challenge = await h.call("care_simulate_payment", input);
		expect(challenge.isError).toBe(true);
		const required = mockPaymentRequiredSchema.parse(challenge.structuredContent);
		expect(required.resource.url).not.toContain(current.credential);
		const proof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
		expect((await h.call("care_simulate_payment", input, { "x402/payment": { ...proof, payload: { ...proof.payload, operationId: crypto.randomUUID() } } })).isError).toBe(true);
		expect((await h.call("care_simulate_payment", input, { "x402/payment": { ...proof, resource: { ...proof.resource, url: `${publicOrigin}/wrong-visit` } } })).isError).toBe(true);
		const bypass = await h.call("care_advance", { credential: input.credential, commandId: input.commandId, expectedRevision: input.expectedRevision, command: { kind: "simulate_payment", quoteId: input.quoteId, outcome: "approve" } });
		expect(bypass.isError).toBe(true);
		expect(saved((await h.call("care_resume", { credential: input.credential })).structuredContent).snapshot.revision).toBe(current.snapshot.revision);
		const payment = await h.call("care_simulate_payment", input, { "x402/payment": proof });
		let paid = saved(payment.structuredContent);
		expect(payment._meta?.["x402/payment-response"]).toEqual({ success: true, transaction: "", network: "eip155:84532" });
		expect(paid.snapshot.paymentHistory).toHaveLength(1);
		paid = await act(h, paid, { kind: "select_payment", choice: { kind: "assistance" } });
		h.advanceTime(20 * 60_000);
		const replay = await h.call("care_simulate_payment", input, { "x402/payment": proof });
		expect(careResultSchema.parse(replay.structuredContent)).toMatchObject({ kind: "ok", replayed: true });
		expect(saved(replay.structuredContent)).toEqual(paid);
		expect(replay._meta?.["x402/payment-response"]).toBeDefined();
		const altered = await h.call("care_simulate_payment", { ...input, outcome: "decline" }, { "x402/payment": proof });
		expect(careResultSchema.parse(altered.structuredContent)).toMatchObject({ kind: "error", code: "command_reused" });
		expect(careResultSchema.parse((await h.call("care_simulate_payment", { ...input, commandId: crypto.randomUUID() }, { "x402/payment": proof })).structuredContent).kind).toBe("conflict");
	});

	test("native HTTP uses 402 and payment headers, with direct results and no settlement after a decline", async () => {
		const h = await harness();
		const { current, quote, input } = await quoted(h);
		const first = await h.post("/api/visits/payment", input);
		expect(first.status).toBe(402);
		const required = mockPaymentRequiredSchema.parse(await first.json());
		expect(JSON.parse(Buffer.from(first.headers.get("PAYMENT-REQUIRED") ?? "", "base64").toString("utf8"))).toEqual(required);
		const proof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
		const headers = { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(proof)).toString("base64") };
		const malformed = await h.post("/api/visits/payment", input, { "PAYMENT-SIGNATURE": "%%%" });
		expect(malformed.status).toBe(400);
		const bypass = await h.post("/api/visits/advance", { credential: input.credential, commandId: input.commandId, expectedRevision: input.expectedRevision, command: { kind: "simulate_payment", quoteId: input.quoteId, outcome: "approve" } });
		expect(bypass.status).toBe(400);
		const declined = await h.post("/api/visits/payment", { ...input, outcome: "decline" }, headers);
		expect(careResultSchema.parse(await declined.json())).toMatchObject({ kind: "error", code: "payment_declined" });
		expect(declined.headers.has("PAYMENT-RESPONSE")).toBe(false);
		const approved = await h.post("/api/visits/payment", input, headers);
		expect(approved.status).toBe(200);
		const paid = saved(await approved.json());
		expect(paid.snapshot.revision).toBe(current.snapshot.revision + 1);
		expect(JSON.parse(Buffer.from(approved.headers.get("PAYMENT-RESPONSE") ?? "", "base64").toString("utf8"))).toMatchObject({ success: true, transaction: "" });
		const replay = await h.post("/api/visits/payment", input, headers);
		expect(careResultSchema.parse(await replay.json())).toMatchObject({ kind: "ok", replayed: true });
		const exported = await h.post("/api/visits/export", { credential: paid.credential });
		expect(syntheticFhirBundleSchema.parse(await exported.json()).id).toBe(paid.snapshot.visitId);
	});

	test("a valid mock proof cannot settle an expired quote", async () => {
		const h = await harness();
		const { quote, input } = await quoted(h);
		const required = mockPaymentRequiredSchema.parse((await h.call("care_simulate_payment", input)).structuredContent);
		const proof = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
		h.advanceTime(16 * 60_000);
		const result = await h.call("care_simulate_payment", input, { "x402/payment": proof });
		expect(careResultSchema.parse(result.structuredContent)).toMatchObject({ kind: "error", code: "quote_expired" });
		expect(result._meta?.["x402/payment-response"]).toBeUndefined();
	});
});

describe("HTTP request boundary", () => {
	test("cloud startup rejects a missing canonical public origin before serving health", async () => {
		const child = Bun.spawn([process.execPath, "src/server.ts"], {
			cwd: join(import.meta.dir, ".."),
			env: { K_SERVICE: "synthetic-cloud-service", PUBLIC_BASE_URL: "" },
			stdout: "pipe", stderr: "pipe",
		});
		expect(await child.exited).not.toBe(0);
		expect(await new Response(child.stderr).text()).toContain("PUBLIC_BASE_URL is required for a Cloud Run service.");
		expect(await new Response(child.stdout).text()).not.toContain("server_started");
	});

	test("allows sandbox origins to load the public media module while keeping visit endpoints protected", async () => {
		const directory = await mkdtemp(join(tmpdir(), "virtual-care-asset-test-"));
		await writeFile(join(directory, "livekit.js"), "export const fixture = true;\n");
		cleanup.push(async () => { await rm(directory, { recursive: true, force: true }); });
		const h = await harness(undefined, { publicDirectory: directory });
		for (const method of ["GET", "HEAD"]) {
			const response = await h.handle(new Request(`${publicOrigin}/livekit.js`, { method, headers: { Origin: "https://host-sandbox.example" } }));
			expect(response.status).toBe(200);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
			expect(await response.text()).toBe(method === "HEAD" ? "" : "export const fixture = true;\n");
		}
		expect((await h.post("/api/visits/start", {}, { Origin: "https://host-sandbox.example" })).status).toBe(403);
	});

	test("serves nonce health and restrictive browser policy while rejecting invalid protocol requests", async () => {
		const h = await harness();
		expect(await (await h.handle(new Request("http://127.0.0.1/livez"))).json()).toEqual({ ok: true, deployment: "fixture-deployment" });
		const home = await h.handle(new Request(publicOrigin));
		expect(await home.text()).toContain("Browser visit");
		expect(home.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
		expect(home.headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
		const cases: Array<{ method: string; body?: string; headers?: Record<string, string>; status: number }> = [
			{ method: "GET", status: 405 },
			{ method: "POST", body: "{}", headers: { "Content-Type": "text/plain" }, status: 415 },
			{ method: "POST", body: "{", headers: { "Content-Type": "application/json" }, status: 400 },
			{ method: "POST", body: "[]", headers: { "Content-Type": "application/json" }, status: 400 },
			{ method: "POST", body: "{}", headers: { "Content-Type": "application/json" }, status: 400 },
			{ method: "POST", body: JSON.stringify({ padding: "x".repeat(65_536) }), headers: { "Content-Type": "application/json" }, status: 413 },
			{ method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, status: 403 },
		];
		for (const item of cases) {
			const response = await h.handle(new Request(`${publicOrigin}/mcp`, item));
			expect(response.status).toBe(item.status);
		}
		expect((await h.handle(new Request("https://untrusted.example/mcp", { method: "POST", body: "{}" }))).status).toBe(403);
		expect((await h.handle(new Request(`${publicOrigin}/mcp?credential=synthetic`))).status).toBe(400);
		expect((await h.post("/api/visits/start", { scenarioId: "unknown" })).status).toBe(400);
	});
});
