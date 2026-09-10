import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { cardKindSchema, careResultSchema, type CardKind, type VisitCommand, type VisitEnvelope } from "../../src/contracts.ts";
import { createMcpServer, getCardResourceUri } from "../../src/mcp.ts";
import { createMemoryStore } from "../../src/persistence.ts";
import { createCareService } from "../../src/visit.ts";
import { cardTools } from "../../src/ui/card-client.ts";

const root = join(import.meta.dir, "../..");
const port = Number(process.env.CARD_HOST_PORT ?? "4335");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a local card host port between 1024 and 65535.");
const origin = `http://127.0.0.1:${port}`;
const output = join(root, ".local/card-host");
await mkdir(output, { recursive: true });
const build = await Bun.build({ entrypoints: [join(import.meta.dir, "main.ts")], outdir: output, naming: "host.js", target: "browser", drop: ["console"] });
if (!build.success) throw new AggregateError(build.logs, "The card host did not build.");
const uiHtml = await readFile(join(root, "dist/mcp-app.html"), "utf8");
const store = createMemoryStore();
const care = createCareService({ store });
const mcp = createMcpServer({ care, uiHtml, publicOrigin: origin });
const client = new Client({ name: "Synthetic card browser test", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcp.connect(serverTransport);
await client.connect(clientTransport);
const call = async (name: string, args: Record<string, unknown>) => CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
function envelope(data: unknown): VisitEnvelope {
	const result = careResultSchema.parse(data);
	if (result.kind !== "ok") throw new Error("The synthetic card fixture could not be prepared.");
	return result.envelope;
}
async function act(current: VisitEnvelope, command: VisitCommand): Promise<VisitEnvelope> {
	return envelope((await call("care_advance", { credential: current.credential, expectedRevision: current.snapshot.revision, commandId: crypto.randomUUID(), command })).structuredContent);
}
async function fixture(stage: "ready" | "active" | "complete"): Promise<VisitEnvelope> {
	let current = envelope((await call("care_start", { scenarioId: "postpartum" })).structuredContent);
	current = await act(current, { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
	current = await act(current, { kind: "save_intake", intake: { reason: "Postpartum check-in", goals: "Prepare questions and arrange follow-up support.", medications: "Not provided", allergies: "Not provided", communicationNotes: "Audio is easier from home." }, access: { ...current.snapshot.access, mode: "video", largeText: stage === "complete" } });
	current = await act(current, { kind: "select_payment", choice: { kind: "assistance" } });
	current = await act(current, { kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
	if (stage === "ready") return current;
	current = await act(current, { kind: "enter_consultation", mode: "video" });
	return stage === "active" ? current : act(current, { kind: "finish_consultation" });
}
const appointment = await fixture("ready");
const consultation = await fixture("active");
const complete = await fixture("complete");
const fixtures: Record<CardKind, VisitEnvelope> = { appointment, consultation, "after-visit": complete, "maternal-plan": complete };
const page = await readFile(join(import.meta.dir, "index.html"), "utf8");
const server = Bun.serve({
	hostname: "127.0.0.1", port,
	async fetch(request) {
		const url = new URL(request.url);
		const suppliedOrigin = request.headers.get("origin");
		if (url.origin !== origin || (suppliedOrigin && suppliedOrigin !== origin)) return new Response(null, { status: 403 });
		if (request.method === "GET" && url.pathname === "/") return new Response(page, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
		if (request.method === "GET" && url.pathname === "/host.js") return new Response(Bun.file(join(output, "host.js")), { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
		if (request.method === "GET" && url.pathname === "/livekit.js") return new Response(Bun.file(join(root, "dist/public/livekit.js")), { headers: { "Content-Type": "text/javascript" } });
		if (request.method === "GET" && url.pathname === "/fixture") {
			const kind = cardKindSchema.safeParse(url.searchParams.get("card"));
			if (!kind.success) return new Response(null, { status: 400 });
			const result = await call(cardTools[kind.data], { credential: fixtures[kind.data].credential });
			const resource = await client.readResource({ uri: getCardResourceUri({ uiHtml, publicOrigin: origin }, kind.data) });
			return Response.json({ result, resource }, { headers: { "Cache-Control": "no-store" } });
		}
		if (request.method === "POST" && url.pathname === "/tool" && request.headers.get("content-type") === "application/json") {
			const parsed = CallToolRequestSchema.safeParse({ method: "tools/call", params: await request.json() });
			if (!parsed.success || !parsed.data.params.name.startsWith("care_")) return new Response(null, { status: 400 });
			return Response.json(CallToolResultSchema.parse(await client.callTool(parsed.data.params)), { headers: { "Cache-Control": "no-store" } });
		}
		return new Response(null, { status: 404 });
	},
});
process.stdout.write(`Card UI test host: ${origin}\nSynthetic records only. Built MCP HTML with a real AppBridge and real MCP calls.\n`);
const close = async () => { await server.stop(); await client.close(); await mcp.close(); store.close(); };
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
