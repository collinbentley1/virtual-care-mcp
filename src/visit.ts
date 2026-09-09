import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { checkInsurance } from "./billing.ts";
import {
	advanceInputSchema, credentialSchema, resumeInputSchema, startInputSchema,
	visitIdSchema,
} from "./contracts.ts";
import type {
	AccessNeeds, ActionName, AdvanceInput, CareClient, CareResult, ScenarioId,
	VisitCommand, VisitCredential, VisitEnvelope, VisitSnapshot, VisitState,
} from "./contracts.ts";
import { StoreUnavailable } from "./persistence.ts";
import type { StoredVisit, VisitStore } from "./persistence.ts";

const retentionMs = 24 * 60 * 60 * 1000;
const consentVersion = "demo-2026-09-09";
const scenarios: Record<ScenarioId, { patientDisplay: string; access: AccessNeeds }> = {
	"rural-adult": {
		patientDisplay: "Jordan Ellis, sample patient",
		access: { mode: "audio", language: "en", interpreterRequested: false, caregiver: { kind: "none" }, captionsRequested: false, largeText: false, lowBandwidth: true },
	},
	"older-adult": {
		patientDisplay: "Sam Rivera, sample patient",
		access: { mode: "video", language: "en", interpreterRequested: false, caregiver: { kind: "requested", name: "Alex, sample caregiver" }, captionsRequested: true, largeText: true, lowBandwidth: false },
	},
	"uninsured-adult": {
		patientDisplay: "Taylor Morgan, sample patient",
		access: { mode: "text", language: "es", interpreterRequested: true, caregiver: { kind: "none" }, captionsRequested: false, largeText: false, lowBandwidth: true },
	},
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (code: Extract<CareResult, { kind: "error" }>["code"], message: string): CareResult => ({ kind: "error", code, message });
const closed = (state: VisitState) => state.kind === "complete" || state.kind === "cancelled";

export function availableActions(state: VisitState): ActionName[] {
	switch (state.kind) {
		case "appointment": return ["choose_appointment", "set_access", "cancel_visit"];
		case "intake": return ["choose_appointment", "save_intake", "set_access", "cancel_visit"];
		case "coverage": return ["choose_appointment", "save_intake", "select_payment", "set_access", "cancel_visit"];
		case "payment": return ["choose_appointment", "save_intake", "select_payment", "simulate_payment", "set_access", "cancel_visit"];
		case "consent": return ["choose_appointment", "save_intake", "select_payment", "accept_consent", "set_access", "cancel_visit"];
		case "ready": return ["choose_appointment", "save_intake", "select_payment", "enter_consultation", "set_access", "cancel_visit"];
		case "consulting": return ["send_demo_message", "finish_consultation", "set_access", "cancel_visit"];
		case "complete": return [];
		case "cancelled": return [];
		default: { const unreachable: never = state; return unreachable; }
	}
}

function envelope(record: StoredVisit, credential: VisitCredential): VisitEnvelope {
	return {
		schemaVersion: 1, mode: "synthetic", credential, expiresAt: record.expiresAt,
		snapshot: record.snapshot, availableActions: availableActions(record.snapshot.state),
	};
}
function authenticate(record: StoredVisit | null, credential: VisitCredential, now: Date): CareResult | null {
	if (!record || !timingSafeEqual(Buffer.from(record.credentialHash, "hex"), Buffer.from(digest(credential), "hex"))) {
		return fail("not_found", "This resume code could not be opened. Check the code or start a new demo visit.");
	}
	if (Date.parse(record.expiresAt) <= now.getTime()) return fail("expired", "This demo visit has expired. Start a new visit with fictional information.");
	return null;
}

type Transition = { kind: "changed"; state: VisitState; access: AccessNeeds; label: string } | { kind: "failed"; result: CareResult };
type TransitionContext = { now: Date; ids: { primary: string; secondary: string; reply: string } };

function transition(snapshot: VisitSnapshot, command: VisitCommand, context: TransitionContext): Transition {
	const state = snapshot.state;
	const at = context.now.toISOString();
	const rejected = (message = "That action is not available at this stage. Refresh the visit and use its next action."): Transition => ({ kind: "failed", result: fail("invalid_transition", message) });
	const changed = (next: VisitState, label: string, access = snapshot.access): Transition => ({ kind: "changed", state: next, access, label });
	if (!availableActions(state).includes(command.kind)) return rejected();
	switch (command.kind) {
		case "choose_appointment": {
			const slot = snapshot.appointmentOptions.find((option) => option.id === command.slotId);
			if (!slot) return rejected("Choose one of this visit's demo appointment times.");
			const appointment = { ...slot, locationState: command.locationState, timeZone: command.timeZone };
			if ("intake" in state) return changed({ kind: "coverage", appointment, intake: state.intake, insuranceCheck: null }, "Demo appointment changed; review coverage and consent again.");
			return changed({ kind: "intake", appointment }, "Demo appointment saved. No real appointment was booked.");
		}
		case "save_intake": {
			if (!("appointment" in state)) return rejected();
			return changed({ kind: "coverage", appointment: state.appointment, intake: command.intake, insuranceCheck: null }, "Pre-visit information saved. No clinician has received it.", command.access);
		}
		case "select_payment": {
			if (!("intake" in state) || closed(state)) return rejected();
			const selected = { appointment: state.appointment, intake: state.intake };
			switch (command.choice.kind) {
				case "insurance": {
					const eligibility = checkInsurance({ scenario: command.choice.scenario, now: at });
					if (eligibility.status !== "active") return changed({ kind: "coverage", ...selected, insuranceCheck: eligibility }, "Simulated insurance checked. Choose another demo payment option or scenario.");
					return changed({ kind: "consent", ...selected, billing: { kind: "insurance", eligibility } }, "Simulated coverage selected. Eligibility does not guarantee payment.");
				}
				case "self-pay": return changed({ kind: "payment", ...selected, quote: {
					id: context.ids.primary, amountCents: 3500, currency: "USD", expiresAt: new Date(context.now.getTime() + 15 * 60 * 1000).toISOString(), simulation: true,
				} }, "A $35 demo quote is ready. No payment has been authorized.");
				case "assistance": return changed({ kind: "consent", ...selected, billing: {
					kind: "assistance", patientEstimateCents: 0, explanation: "Demo financial assistance covers the sample visit. No real assistance or coverage has been approved.",
				} }, "Demo financial assistance selected. No eligibility decision was made.");
				default: { const unreachable: never = command.choice; return unreachable; }
			}
		}
		case "simulate_payment": {
			if (state.kind !== "payment" || state.quote.id !== command.quoteId) return rejected("That demo quote is no longer current. Review the latest cost before simulating payment.");
			if (snapshot.paymentHistory.length >= 8) return { kind: "failed", result: fail("limit_reached", "This visit has reached its simulated payment limit. You can choose demo assistance or start a new visit.") };
			if (Date.parse(state.quote.expiresAt) <= context.now.getTime()) return { kind: "failed", result: fail("quote_expired", "This demo quote expired. Choose self-pay again to create a new quote.") };
			if (command.outcome === "decline") return { kind: "failed", result: fail("payment_declined", "The demo payment was declined by the selected fixture. No money moved. Choose another demo outcome or payment option.") };
			return changed({ kind: "consent", appointment: state.appointment, intake: state.intake, billing: { kind: "self-pay", quote: state.quote, receipt: {
				id: context.ids.primary, quoteId: state.quote.id, amountCents: 3500, currency: "USD", settledAt: at,
				verification: "simulated", settlement: "simulated", transaction: "",
			} } }, "Simulated payment complete. No money moved.");
		}
		case "accept_consent": {
			if (state.kind !== "consent") return rejected();
			return changed({ ...state, kind: "ready", consent: {
				version: consentVersion, acceptedAt: at, syntheticDataOnly: command.syntheticDataOnly,
				understandsSimulation: command.understandsSimulation, telehealthAcknowledged: command.telehealthAcknowledged,
				locationConfirmed: command.locationConfirmed,
			} }, "Demo visit acknowledgments saved.");
		}
		case "enter_consultation": {
			if (state.kind !== "ready") return rejected();
			return changed({ ...state, kind: "consulting", consultation: {
				id: context.ids.primary, startedAt: at, mode: command.mode, generation: 1,
				messages: [{ id: context.ids.secondary, kind: "scripted-demo", text: "Welcome to the practice visit. No clinician is connected. You can rehearse sharing your concerns, try your devices, and review a sample after-visit record.", sentAt: at }],
			} }, "Practice visit opened. Media connection and clinician participation are separate.");
		}
		case "send_demo_message": {
			if (state.kind !== "consulting") return rejected();
			if (state.consultation.messages.length > 37) return { kind: "failed", result: fail("limit_reached", "The practice transcript is full. You can finish the demo and review its sample summary.") };
			return changed({ ...state, consultation: { ...state.consultation, messages: [
				...state.consultation.messages,
				{ id: context.ids.primary, kind: "participant", text: command.text, sentAt: at },
				{ id: context.ids.reply, kind: "scripted-demo", text: "Your practice message is saved. In a real visit, the care team would respond here. This scripted rehearsal cannot assess symptoms or recommend treatment.", sentAt: at },
			] } }, "Practice message saved with a scripted reply.");
		}
		case "finish_consultation": {
			if (state.kind !== "consulting") return rejected();
			return changed({ ...state, kind: "complete", endedAt: at, afterVisit: {
				id: context.ids.primary, createdAt: at, provenance: "scripted-demo", clinicianReviewed: false,
				title: "Sample after-visit summary",
				summary: "You completed a software rehearsal of a virtual care visit. The appointment, care-team handoff, insurance results, payment, and this note were simulated. No clinician assessed your concerns or provided treatment.",
				nextSteps: ["Review the fictional information you saved before the visit.", "Download or print this sample record to see how visit information can follow you.", "For an actual health concern, contact a licensed care provider. This app has not arranged care."],
				claimStatus: state.billing.kind === "insurance" ? state.billing.eligibility.scenario === "claim-denied" ? "simulated-denied" : "simulated-approved" : "not-applicable",
				notice: "Sample after-visit summary. No clinician reviewed or signed this document. It contains no personalized medical advice.",
			} }, "Practice visit completed. A sample after-visit record is available.");
		}
		case "set_access": return changed(state, "Access preferences saved.", command.access);
		case "cancel_visit": {
			if (closed(state)) return rejected();
			return changed({ kind: "cancelled", previous: state, cancelledAt: at }, "Demo visit cancelled. Its saved information remains available until expiry.");
		}
		default: { const unreachable: never = command; return unreachable; }
	}
}

export function createCareService(options: { store: VisitStore; now?: () => Date }): CareClient {
	const now = options.now ?? (() => new Date());
	const recover = async (work: () => Promise<CareResult>): Promise<CareResult> => {
		try { return await work(); }
		catch (error) {
			if (error instanceof StoreUnavailable) return fail("temporarily_unavailable", "Your saved visit is temporarily unavailable. Keep your resume code and try again.");
			throw error;
		}
	};
	return {
		async start(input) {
			const parsed = startInputSchema.safeParse(input);
			if (!parsed.success) return fail("invalid_input", "Choose one of the available fictional patient scenarios.");
			return recover(async () => {
				const time = now();
				const visitId = visitIdSchema.parse(randomUUID());
				const credential = credentialSchema.parse(`vcm_${visitId}.${randomBytes(32).toString("base64url")}`);
				const firstSlot = Math.ceil((time.getTime() + 60 * 60 * 1000) / (30 * 60 * 1000)) * (30 * 60 * 1000);
				const optionsForVisit = [
					{ id: "slot-1", startsAt: new Date(firstSlot).toISOString(), durationMinutes: 20, careTeam: "Demo care team" },
					{ id: "slot-2", startsAt: new Date(firstSlot + 4 * 60 * 60 * 1000).toISOString(), durationMinutes: 20, careTeam: "Demo care team" },
					{ id: "slot-3", startsAt: new Date(firstSlot + 8 * 60 * 60 * 1000).toISOString(), durationMinutes: 20, careTeam: "Demo care team" },
				] satisfies VisitSnapshot["appointmentOptions"];
				const scenario = scenarios[parsed.data.scenarioId];
				const record: StoredVisit = {
					snapshot: {
						visitId, revision: 0, scenarioId: parsed.data.scenarioId, patientDisplay: scenario.patientDisplay,
						access: structuredClone(scenario.access), appointmentOptions: optionsForVisit, paymentHistory: [], state: { kind: "appointment" },
						timeline: [{ revision: 0, at: time.toISOString(), label: "Fictional visit started." }], createdAt: time.toISOString(),
					},
					credentialHash: digest(credential), expiresAt: new Date(time.getTime() + retentionMs).toISOString(), receipts: [],
				};
				if (!await options.store.create(record)) return fail("temporarily_unavailable", "A demo visit could not be created. Please try again.");
				return { kind: "ok", envelope: envelope(record, credential), replayed: false };
			});
		},
		async resume(input) {
			const parsed = resumeInputSchema.safeParse(input);
			if (!parsed.success) return fail("invalid_input", "Paste the complete demo resume code.");
			const id = visitIdSchema.safeParse(parsed.data.credential.slice(4, 40));
			if (!id.success) return fail("invalid_input", "Paste a valid demo resume code.");
			return recover(() => options.store.transact(id.data, (record) => {
				const error = authenticate(record, parsed.data.credential, now());
				if (error || !record) return { result: error ?? fail("not_found", "This visit could not be opened.") };
				return { result: { kind: "ok", envelope: envelope(record, parsed.data.credential), replayed: false } };
			}));
		},
		async advance(input) {
			const parsed = advanceInputSchema.safeParse(input);
			if (!parsed.success) return fail("invalid_input", "Check the visit input and required acknowledgments, then try again.");
			const request: AdvanceInput = parsed.data;
			const id = visitIdSchema.safeParse(request.credential.slice(4, 40));
			if (!id.success) return fail("invalid_input", "Paste a valid demo resume code.");
			const inputHash = digest(JSON.stringify({ expectedRevision: request.expectedRevision, command: request.command }));
			const ids = { primary: randomUUID(), secondary: randomUUID(), reply: randomUUID() };
			return recover(() => options.store.transact(id.data, (record) => {
				const time = now();
				const error = authenticate(record, request.credential, time);
				if (error || !record) return { result: error ?? fail("not_found", "This visit could not be opened.") };
				const receipt = record.receipts.find((item) => item.commandId === request.commandId);
				if (receipt) return { result: receipt.inputHash === inputHash
					? { kind: "ok", envelope: envelope(record, request.credential), replayed: true }
					: fail("command_reused", "This action ID was already used with different input. Refresh the visit before trying again.") };
				if (record.snapshot.revision !== request.expectedRevision) return { result: {
					kind: "conflict", envelope: envelope(record, request.credential), message: "This visit changed in another view. Review the latest saved information before submitting again.",
				} };
				const finishing = request.command.kind === "finish_consultation" || request.command.kind === "cancel_visit";
				if (record.receipts.length >= (finishing ? 256 : 254)) return { result: fail("limit_reached", "This demo has reached its update limit. Finish or cancel it, then start a new visit.") };
				const result = transition(record.snapshot, request.command, { now: time, ids });
				if (result.kind === "failed") return { result: result.result };
				const revision = record.snapshot.revision + 1;
				const next: StoredVisit = {
					...record,
					snapshot: {
						...record.snapshot, revision, state: result.state, access: result.access,
						timeline: [...record.snapshot.timeline, { revision, at: time.toISOString(), label: result.label }].slice(-100),
						paymentHistory: request.command.kind === "simulate_payment" && result.state.kind === "consent" && result.state.billing.kind === "self-pay"
							? [...record.snapshot.paymentHistory, { commandId: request.commandId, quote: result.state.billing.quote, receipt: result.state.billing.receipt }]
							: record.snapshot.paymentHistory,
					},
					receipts: [...record.receipts, { commandId: request.commandId, inputHash, appliedRevision: revision }],
				};
				return { next, result: { kind: "ok", envelope: envelope(next, request.credential), replayed: false } };
			}));
		},
	};
}
