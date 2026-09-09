import {
	registerAppResource,
	registerAppTool,
	RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	advanceInputSchema,
	careResultSchema,
	mediaInputSchema,
	mediaResultSchema,
	resumeInputSchema,
	startInputSchema,
	quoteSchema,
	type CareClient,
	type CareResult,
	type MediaInput,
	type MediaResult,
	type Quote,
	type VisitId,
} from "./contracts.js";

import {
	createPaymentRequired,
	createPaymentSettlement,
	exportFhirRecord,
	syntheticFhirBundleSchema,
	validateMockPaymentPayload,
	type MockPaymentRequired,
	type MockSettlementResponse,
} from "./billing.js";

export const paymentInputSchema = advanceInputSchema.omit({ command: true }).extend({
	quoteId: quoteSchema.shape.id,
	outcome: z.enum(["approve", "decline"]),
}).strict();
export type PaymentInput = z.infer<typeof paymentInputSchema>;
type PaymentResult =
	| { kind: "payment-required"; required: MockPaymentRequired }
	| { kind: "result"; result: CareResult; settlement?: MockSettlementResponse };

function paymentResourceUrl(publicOrigin: string, visitId: VisitId, quoteId: Quote["id"]): string {
	return `${new URL(publicOrigin).origin}/api/visits/${visitId}/quotes/${quoteId}`;
}

export async function simulatePayment(care: CareClient, publicOrigin: string, input: PaymentInput, proof: unknown): Promise<PaymentResult> {
	const current = careResultSchema.parse(await care.resume({ credential: input.credential }));
	if (current.kind !== "ok") return { kind: "result", result: current };
	const snapshot = current.envelope.snapshot;
	const previous = snapshot.paymentHistory.find((entry) => entry.commandId === input.commandId);
	const quote = previous?.quote ?? (snapshot.state.kind === "payment" ? snapshot.state.quote : undefined);
	if (!quote || quote.id !== input.quoteId) {
		return { kind: "result", result: { kind: "conflict", envelope: current.envelope, message: "The saved payment option changed. Review the current visit and payment option before simulating another payment." } };
	}
	const resourceUrl = paymentResourceUrl(publicOrigin, snapshot.visitId, quote.id);
	if (!validateMockPaymentPayload({ payload: proof, quote, resourceUrl, operationId: input.commandId })) {
		return { kind: "payment-required", required: createPaymentRequired({ quote, resourceUrl }) };
	}
	const result = careResultSchema.parse(await care.advance({
		credential: input.credential,
		commandId: input.commandId,
		expectedRevision: input.expectedRevision,
		command: { kind: "simulate_payment", quoteId: input.quoteId, outcome: input.outcome },
	}));
	const receipt = result.kind === "ok"
		? result.envelope.snapshot.paymentHistory.find((entry) => entry.commandId === input.commandId)?.receipt
		: undefined;
	return { kind: "result", result, ...(receipt ? { settlement: createPaymentSettlement(receipt) } : {}) };
}

export type McpOptions = {
	care: CareClient;
	uiHtml: string;
	publicOrigin: string;
	media?: (input: MediaInput) => Promise<MediaResult>;
	mediaConnectOrigins?: readonly string[];
};

type VisitResourceIdentity = Pick<McpOptions, "uiHtml" | "publicOrigin" | "mediaConnectOrigins">;

function resourceUiMetadata(publicOrigin: string, mediaConnectOrigins: readonly string[] | undefined) {
	return {
		prefersBorder: true,
		permissions: { camera: {}, microphone: {} },
		csp: {
			connectDomains: [...(mediaConnectOrigins ?? [])],
			resourceDomains: [publicOrigin],
			frameDomains: [],
		},
	};
}

function resolvedVisitHtml(uiHtml: string, publicOrigin: string): string {
	return uiHtml.replaceAll("__VIRTUAL_CARE_ASSET_ORIGIN__", publicOrigin);
}

export function getVisitResourceUri(identity: VisitResourceIdentity): string {
	const publicOrigin = new URL(identity.publicOrigin).origin;
	const html = resolvedVisitHtml(identity.uiHtml, publicOrigin);
	const ui = resourceUiMetadata(publicOrigin, identity.mediaConnectOrigins);
	const material = JSON.stringify({ mimeType: RESOURCE_MIME_TYPE, html, ui });
	const digest = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
	return `ui://virtual-care/visit-v1.${digest}.html`;
}

function summarize(result: CareResult): string {
	switch (result.kind) {
		case "ok":
			return `Synthetic visit for ${result.envelope.snapshot.patientDisplay}. Current step: ${result.envelope.snapshot.state.kind}. Available actions: ${result.envelope.availableActions.join(", ") || "none"}. Resume code: ${result.envelope.credential}. No clinical service or real payment occurred.`;
		case "conflict":
			return `${result.message} The current synthetic visit is at ${result.envelope.snapshot.state.kind}. Review it before sending a new command.`;
		case "error":
			return result.message;
		default: {
			const exhaustive: never = result;
			return exhaustive;
		}
	}
}

function toolResult(value: CareResult, publicOrigin: string): CallToolResult {
	const result = careResultSchema.parse(value);
	const snapshot = result.kind === "error" ? undefined : result.envelope.snapshot;
	const required = snapshot?.state.kind === "payment"
		? createPaymentRequired({ quote: snapshot.state.quote, resourceUrl: paymentResourceUrl(publicOrigin, snapshot.visitId, snapshot.state.quote.id) })
		: undefined;
	return {
		content: [{ type: "text", text: summarize(result) }],
		structuredContent: result,
		isError: result.kind === "error" && result.code !== "payment_declined" && result.code !== "quote_expired",
		_meta: { "virtual-care/browserUrl": publicOrigin, ...(required ? { "virtual-care/payment-required": required } : {}) },
	};
}

export function createMcpServer(options: McpOptions): McpServer {
	const publicOrigin = new URL(options.publicOrigin).origin;
	const resourceUri = getVisitResourceUri({ ...options, publicOrigin });
	const html = resolvedVisitHtml(options.uiHtml, publicOrigin);
	const ui = resourceUiMetadata(publicOrigin, options.mediaConnectOrigins);
	const server = new McpServer(
		{ name: "virtual-care-mcp", version: "0.1.0" },
		{
			instructions:
				"This is a fictional virtual-care demonstration. Use synthetic information only. Start with care_start, retain its scoped demo credential, and call care_render to display the visit when the host supports MCP Apps. Use care_advance with the latest revision and a stable UUID commandId for retries. Never describe a simulated visit, clinician, insurance decision, or payment as real.",
		},
	);

	registerAppResource(
		server,
		"Virtual care visit",
		resourceUri,
		{ description: "Accessible synthetic virtual-care visit." },
		async () => ({
			contents: [
				{
					uri: resourceUri,
					mimeType: RESOURCE_MIME_TYPE,
					text: html,
					_meta: {
						ui,
					},
				},
			],
		}),
	);

	registerAppTool(
		server,
		"care_start",
		{
			title: "Start a synthetic visit",
			description:
				"Start a new fictional virtual-care visit. Choose a synthetic scenario. Returns a scoped demo credential and available appointment options. This creates a new visit each time; use care_resume for an existing visit.",
			inputSchema: startInputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["model", "app"] } },
		},
		async (input) =>
			toolResult(await options.care.start(startInputSchema.parse(input)), options.publicOrigin),
	);

	registerAppTool(
		server,
		"care_resume",
		{
			title: "Resume a synthetic visit",
			description:
				"Read the latest saved state for a synthetic visit using its scoped demo credential. Returns the current revision and available actions without changing the visit.",
			inputSchema: resumeInputSchema,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { visibility: ["model", "app"] } },
		},
		async (input) =>
			toolResult(await options.care.resume(resumeInputSchema.parse(input)), options.publicOrigin),
	);

	registerAppTool(
		server,
		"care_advance",
		{
			title: "Update a synthetic visit",
			description:
				"Apply one available action to a synthetic visit. Supply its credential, expectedRevision, and a UUID commandId. Retry an unchanged request with the same commandId. On conflict, inspect the returned current state before making a new request. Intake, care, insurance, and all payment actions are simulations.",
			inputSchema: advanceInputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["model", "app"] } },
		},
		async (input) => {
			const parsed = advanceInputSchema.parse(input);
			if (parsed.command.kind === "simulate_payment") {
				return toolResult({ kind: "error", code: "invalid_input", message: "Use care_simulate_payment to rehearse the x402 payment exchange." }, options.publicOrigin);
			}
			return toolResult(await options.care.advance(parsed), options.publicOrigin);
		},
	);

	registerAppTool(
		server,
		"care_simulate_payment",
		{
			title: "Rehearse a self-pay payment",
			description:
				"Simulate the x402 payment exchange for the current self-pay quote. The first call returns PaymentRequired. Retry identical arguments with a synthetic PaymentPayload in request _meta[\"x402/payment\"]. This private mock-exact scheme cannot move money. Reuse the commandId for an unchanged retry.",
			inputSchema: paymentInputSchema,
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { visibility: ["model", "app"] } },
		},
		async (input, extra) => {
			const payment = await simulatePayment(options.care, options.publicOrigin, paymentInputSchema.parse(input), extra._meta?.["x402/payment"]);
			if (payment.kind === "payment-required") return {
				isError: true,
				content: [{ type: "text", text: JSON.stringify(payment.required) }],
				structuredContent: payment.required,
			};
			const result = toolResult(payment.result, options.publicOrigin);
			return payment.settlement
				? { ...result, _meta: { ...result._meta, "x402/payment-response": payment.settlement } }
				: result;
		},
	);

	registerAppTool(
		server,
		"care_export",
		{
			title: "Export the synthetic visit record",
			description: "Read the saved fictional visit as a FHIR R4 collection Bundle. This includes synthetic record and billing resources, never credentials or media access tokens. Nothing is sent to a clinician or insurer.",
			inputSchema: resumeInputSchema,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { visibility: ["model", "app"] } },
		},
		async (input) => {
			const current = careResultSchema.parse(await options.care.resume(resumeInputSchema.parse(input)));
			if (current.kind !== "ok") return toolResult(current, options.publicOrigin);
			return {
				content: [{ type: "text", text: "The synthetic FHIR R4 visit record is ready. No clinical service, insurer submission, or real payment occurred." }],
				structuredContent: syntheticFhirBundleSchema.parse(exportFhirRecord(current.envelope.snapshot)),
			};
		},
	);

	registerAppTool(
		server,
		"care_render",
		{
			title: "Open the virtual-care visit",
			description:
				"Display the interactive synthetic visit. First call care_start or obtain an existing demo credential, then pass that credential. This reads the latest saved state and does not advance the visit.",
			inputSchema: resumeInputSchema,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { resourceUri, visibility: ["model", "app"] } },
		},
		async (input) =>
			toolResult(await options.care.resume(resumeInputSchema.parse(input)), options.publicOrigin),
	);

	registerAppTool(
		server,
		"care_media",
		{
			title: "Open demonstration media",
			description:
				"Request temporary media access for an active synthetic visit after the participant chooses video or audio. Media credentials are returned only to the app. A connected room still contains no real clinical service.",
			inputSchema: mediaInputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["app"] } },
		},
		async (input) => {
			const parsed = mediaInputSchema.parse(input);
			const current = await options.care.resume({ credential: parsed.credential });
			if (current.kind !== "ok" || current.envelope.snapshot.state.kind !== "consulting") {
				return {
					content: [{ type: "text", text: "Media is available only during an active synthetic consultation." }],
					isError: true,
					_meta: { "virtual-care/media": { kind: "error", message: "Media is available only during an active synthetic consultation." } },
				};
			}
			const result = mediaResultSchema.parse(
				options.media
					? await options.media(parsed)
					: {
							kind: "practice",
							reason: "unconfigured",
							message: "The scripted visit is ready. Live media is not configured.",
						},
			);
			return {
				content: [{ type: "text", text: result.kind === "livekit" ? "Temporary demonstration media access is ready in the app." : result.message }],
				isError: result.kind === "error",
				_meta: { "virtual-care/media": result },
			};
		},
	);

	return server;
}
