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
	acceptConsentInputSchema,
	afterVisitCardSchema,
	appointmentCardSchema,
	beginConsultationInputSchema,
	bookAppointmentInputSchema,
	cardKindSchema,
	checkInsuranceInputSchema,
	choosePaymentInputSchema,
	consultationCardSchema,
	maternalPlanCardSchema,
	mutationInputSchema,
	saveIntakeInputSchema,
	setAccessInputSchema,
	updateMaternalPlanInputSchema,
	type CardKind,
	type CardResult,
	type VisitCommand,
	type VisitEnvelope,
	type CareClient,
	type CareResult,
	type MediaInput,
	type MediaResult,
	type Quote,
	type VisitId,
} from "./contracts.js";

import {
	createPaymentRequired,
	createMockPaymentPayload,
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
	cardHtml?: string;
	publicOrigin: string;
	media?: (input: MediaInput) => Promise<MediaResult>;
	mediaConnectOrigins?: readonly string[];
};

type VisitResourceIdentity = Pick<McpOptions, "uiHtml" | "cardHtml" | "publicOrigin" | "mediaConnectOrigins">;

function resourceUiMetadata(publicOrigin: string, mediaConnectOrigins: readonly string[] | undefined, cardKind: CardKind) {
	return {
		prefersBorder: true,
		...(cardKind === "consultation" ? { permissions: { camera: {}, microphone: {} } } : {}),
		csp: {
			connectDomains: cardKind === "consultation" ? [...(mediaConnectOrigins ?? [])] : [],
			resourceDomains: [publicOrigin],
			frameDomains: [],
		},
	};
}

function resolvedVisitHtml(uiHtml: string, publicOrigin: string): string {
	return uiHtml.replaceAll("__VIRTUAL_CARE_ASSET_ORIGIN__", publicOrigin);
}

export function getVisitResourceUri(identity: VisitResourceIdentity): string {
	return getCardResourceUri(identity, "consultation");
}

export function getCardResourceUri(identity: VisitResourceIdentity, cardKind: CardKind): string {
	const publicOrigin = new URL(identity.publicOrigin).origin;
	const html = resolvedVisitHtml(identity.cardHtml ?? identity.uiHtml, publicOrigin);
	const ui = resourceUiMetadata(publicOrigin, identity.mediaConnectOrigins, cardKind);
	const material = JSON.stringify({ mimeType: RESOURCE_MIME_TYPE, html, ui });
	const digest = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
	return `ui://virtual-care/${cardKind}-v2.${digest}.html`;
}

function summarize(result: CareResult): string {
	switch (result.kind) {
		case "ok":
			return `Synthetic visit for ${result.envelope.snapshot.patientDisplay}. Saved status: ${result.envelope.snapshot.state.kind}. Available actions: ${result.envelope.availableActions.join(", ") || "none"}. The saved demo expires at ${result.envelope.expiresAt}. No clinical service or real payment occurred.`;
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

export function projectCard(envelope: VisitEnvelope, cardKind: CardKind): CardResult {
	const { snapshot } = envelope;
	const { state } = snapshot;
	const effective = state.kind === "cancelled" ? state.previous : state;
	const common = {
		schemaVersion: 2, mode: "synthetic", visitId: snapshot.visitId, revision: snapshot.revision,
		expiresAt: envelope.expiresAt, patientDisplay: snapshot.patientDisplay,
		access: snapshot.access, availableActions: envelope.availableActions,
	};
	const purpose = "intake" in effective ? effective.intake.reason : snapshot.scenarioId === "postpartum" ? "Postpartum check-in" : "Virtual care check-in";
	switch (cardKind) {
		case "appointment": return appointmentCardSchema.parse({
			...common, cardKind, purpose,
			appointment: "appointment" in effective
				? { kind: "booked", details: effective.appointment, status: state.kind === "cancelled" ? "cancelled" : state.kind === "complete" ? "complete" : "scheduled", readyToJoin: state.kind === "ready" || state.kind === "consulting" }
				: { kind: "not-booked" },
		});
		case "consultation": return consultationCardSchema.parse({
			...common, cardKind, purpose,
			consultation: state.kind === "consulting"
				? { kind: "active", id: state.consultation.id, generation: state.consultation.generation, startedAt: state.consultation.startedAt, mode: state.consultation.mode }
				: state.kind === "complete"
					? { kind: "ended", id: state.consultation.id, endedAt: state.endedAt, mode: state.consultation.mode }
					: state.kind === "cancelled" ? { kind: "cancelled" }
						: { kind: "not-started", canBegin: state.kind === "ready", mode: snapshot.access.mode },
		});
		case "after-visit": return afterVisitCardSchema.parse({
			...common, cardKind,
			afterVisit: state.kind === "complete"
				? { kind: "available", summary: state.afterVisit, appointment: state.appointment, endedAt: state.endedAt }
				: { kind: "not-ready" },
			hasMaternalPlan: snapshot.specialtyPlan.kind === "maternal-postpartum",
		});
		case "maternal-plan": return maternalPlanCardSchema.parse({
			...common, cardKind, plan: snapshot.specialtyPlan,
			canEdit: snapshot.specialtyPlan.kind === "maternal-postpartum" && state.kind !== "cancelled",
		});
		default: { const unreachable: never = cardKind; return unreachable; }
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
	const html = resolvedVisitHtml(options.cardHtml ?? options.uiHtml, publicOrigin);
	const server = new McpServer(
		{ name: "virtual-care-mcp", version: "0.1.0" },
		{
			instructions:
				"Use fictional information only. Let the conversation gather missing visit context; reuse what the user already supplied. Use care_start once, retain its scoped credential privately, and use focused care_* tools with the latest revision and a stable UUID commandId for unchanged retries. Show a card only for a booked appointment, consultation, after-visit summary, or postpartum plan. Never invent intake answers, consent, bookings, clinician review, or payment approval. Demo records expire after 24 hours. Ask one short question at a time for required missing context. Leave unanswered optional intake fields empty; never turn missing medication or allergy information into 'none'. The postpartum scenario supplies a fictional care-plan utility. Clinical and billing outcomes are simulations.",
		},
	);

	const cards = {
		appointment: { tool: "care_show_appointment", title: "Show the appointment", description: "Use this when the user wants to see the booked sample appointment. First book with care_book_appointment. Read-only; does not book or change a visit.", schema: appointmentCardSchema },
		consultation: { tool: "care_show_consultation", title: "Show the consultation", description: "Use this when the user wants the live audio/video card for their sample consultation. First prepare the visit with conversational tools and call care_begin_consultation. Rendering never joins media or activates devices.", schema: consultationCardSchema },
		"after-visit": { tool: "care_show_after_visit", title: "Show the after-visit summary", description: "Use this when the user wants the saved sample summary after care_finish_consultation. Reads the immutable scripted summary; does not create clinical advice.", schema: afterVisitCardSchema },
		"maternal-plan": { tool: "care_show_maternal_plan", title: "Show the postpartum plan", description: "Use this when a postpartum sample patient wants their appointment timeline, preparation tasks, or questions. This utility remains editable after the consultation, until the demo expires. No appointment is booked by showing it.", schema: maternalPlanCardSchema },
	} satisfies Record<CardKind, { tool: string; title: string; description: string; schema: z.ZodObject }>;
	for (const cardKind of cardKindSchema.options) {
		const card = cards[cardKind];
		const resourceUri = getCardResourceUri({ ...options, publicOrigin }, cardKind);
		const ui = resourceUiMetadata(publicOrigin, options.mediaConnectOrigins, cardKind);
		registerAppResource(server, card.title, resourceUri, { description: card.description }, async () => ({
			contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui } }],
		}));
		registerAppTool(server, card.tool, {
			title: card.title, description: card.description, inputSchema: resumeInputSchema, outputSchema: card.schema,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { resourceUri, visibility: ["model", "app"] } },
		}, async (input) => {
			const result = careResultSchema.parse(await options.care.resume(resumeInputSchema.parse(input)));
			if (result.kind !== "ok") return { content: [{ type: "text", text: summarize(result) }], isError: true };
			return {
				content: [{ type: "text", text: `${card.title}. This is a fictional demonstration; the saved record expires at ${result.envelope.expiresAt}.` }],
				structuredContent: projectCard(result.envelope, cardKind),
				_meta: { "virtual-care/credential": result.envelope.credential, "virtual-care/browserUrl": publicOrigin },
			};
		});
	}

	function registerMutation<Schema extends z.ZodObject>(name: string, title: string, description: string, schema: Schema, command: (input: z.output<Schema>) => VisitCommand): void {
		const toolSchema: z.ZodObject = schema;
		registerAppTool(server, name, {
			title, description: `${description} Use the latest expectedRevision and a stable UUID commandId. Retry an unchanged request with the same commandId.`,
			inputSchema: toolSchema,
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { visibility: ["model", "app"] } },
		}, async (input) => {
			const parsed = schema.parse(input);
			const request = advanceInputSchema.parse({ credential: parsed.credential, commandId: parsed.commandId, expectedRevision: parsed.expectedRevision, command: command(parsed) });
			return toolResult(await options.care.advance(request), publicOrigin);
		});
	}
	registerMutation("care_book_appointment", "Book a sample appointment", "Use this after the user selects a returned sample slot and confirms location and time zone. No real appointment is booked.", bookAppointmentInputSchema, (input) => ({ kind: "choose_appointment", slotId: input.slotId, locationState: input.locationState, timeZone: input.timeZone }));
	registerMutation("care_save_intake", "Save the visit context", "Use this to save fictional intake gathered in conversation. Reuse known context and ask only for missing required information. Unanswered optional fields remain empty; never invent negative medication or allergy history.", saveIntakeInputSchema, (input) => ({ kind: "save_intake", intake: input.intake, access: input.access }));
	registerMutation("care_set_access", "Save access preferences", "Use this when the user asks to change their language, communication, or device preferences.", setAccessInputSchema, (input) => ({ kind: "set_access", access: input.access }));
	registerMutation("care_check_insurance", "Check sample insurance", "Use this to select an explicit fictional insurance scenario after intake. The returned estimate and eligibility are simulations, not verified benefits.", checkInsuranceInputSchema, (input) => ({ kind: "select_payment", choice: { kind: "insurance", scenario: input.scenario } }));
	registerMutation("care_choose_payment", "Choose a sample payment option", "Use this when the user chooses self-pay or assistance. Self-pay creates a quote for review; it does not authorize payment. Assistance is simulated.", choosePaymentInputSchema, (input) => ({ kind: "select_payment", choice: { kind: input.choice } }));
	registerMutation("care_accept_demo_consent", "Save demo acknowledgments", "Use this only after the user acknowledges the fictional-data-only demo, understands it is simulated, acknowledges telehealth, and confirms their current location. Do not infer these acknowledgments from other context.", acceptConsentInputSchema, (input) => ({ kind: "accept_consent", version: input.version, syntheticDataOnly: input.syntheticDataOnly, understandsSimulation: input.understandsSimulation, telehealthAcknowledged: input.telehealthAcknowledged, locationConfirmed: input.locationConfirmed }));
	registerMutation("care_begin_consultation", "Begin the sample consultation", "Use this after preparation and acknowledgments are saved and the user wants to begin. It opens saved consultation state. Media starts only from the consultation card after a device action.", beginConsultationInputSchema, (input) => ({ kind: "enter_consultation", mode: input.mode }));
	registerMutation("care_finish_consultation", "Finish the sample consultation", "Use this when the user ends the practice visit. It saves an immutable scripted summary. Then show care_show_after_visit. It does not create a clinician-reviewed note.", mutationInputSchema, () => ({ kind: "finish_consultation" }));
	registerMutation("care_cancel_visit", "Cancel the sample visit", "Use this when the user asks to cancel their fictional visit. The saved record remains readable until expiry.", mutationInputSchema, () => ({ kind: "cancel_visit" }));
	registerMutation("care_update_maternal_plan", "Update the postpartum plan", "Use this to complete or reopen an existing preparation task, or save a patient-entered question. Works after the consultation ends. It never changes the saved summary, books appointments, or sends questions to a care team.", updateMaternalPlanInputSchema, (input) => ({ kind: "update_maternal_plan", update: input.update }));
	registerAppTool(server, "care_demo_payment", {
		title: "Simulate a payment decision",
		description: "Use this only after the user reviews the current sample self-pay quote and explicitly selects approve or decline. Provide that exact quoteId. This performs the mock x402 exchange without client protocol metadata and cannot move money. Retry identical arguments with the same commandId.",
		inputSchema: paymentInputSchema,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		_meta: { ui: { visibility: ["model", "app"] } },
	}, async (input) => {
		const parsed = paymentInputSchema.parse(input);
		const current = careResultSchema.parse(await options.care.resume({ credential: parsed.credential }));
		if (current.kind !== "ok") return toolResult(current, publicOrigin);
		const { snapshot } = current.envelope;
		const previous = snapshot.paymentHistory.find((entry) => entry.commandId === parsed.commandId);
		const quote = previous?.quote ?? (snapshot.state.kind === "payment" ? snapshot.state.quote : undefined);
		if (!quote || quote.id !== parsed.quoteId) return toolResult({ kind: "conflict", envelope: current.envelope, message: "The saved quote changed. Review the current payment option before a new decision." }, publicOrigin);
		const proof = createMockPaymentPayload({ quote, resourceUrl: paymentResourceUrl(publicOrigin, snapshot.visitId, quote.id), operationId: parsed.commandId });
		const payment = await simulatePayment(options.care, publicOrigin, parsed, proof);
		if (payment.kind === "payment-required") return toolResult({ kind: "error", code: "invalid_input", message: "The sample payment offer could not be verified. Refresh the saved quote before trying again." }, publicOrigin);
		const result = toolResult(payment.result, publicOrigin);
		return payment.settlement ? { ...result, _meta: { ...result._meta, "x402/payment-response": payment.settlement } } : result;
	});

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
			_meta: { ui: { visibility: ["app"] } },
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
			_meta: { ui: { visibility: ["app"] } },
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
			title: "Read the saved demo visit",
			description:
				"Read the saved fictional visit for an existing client. Use the focused care_show_* tools for cards. This reads state without advancing the visit.",
			inputSchema: resumeInputSchema,
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
			_meta: { ui: { visibility: ["app"] } },
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
