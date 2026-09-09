import { z } from "zod";

export const usStates = [
	"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
	"IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
	"MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
	"RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
	"VI", "GU", "AS", "MP",
] as const;

export const visitIdSchema = z.string().uuid().brand<"VisitId">();
export const commandIdSchema = z.string().uuid().brand<"CommandId">();
export const credentialSchema = z.string().regex(/^vcm_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/).brand<"VisitCredential">();
export const instantSchema = z.iso.datetime();
export const scenarioSchema = z.enum(["rural-adult", "older-adult", "uninsured-adult"]);
export const modeSchema = z.enum(["video", "audio", "text"]);
export const insuranceScenarioSchema = z.enum([
	"active-copay", "inactive", "unknown-member", "benefits-unavailable",
	"prior-authorization-required", "claim-denied",
]);
const textField = (maximum: number) => z.string().trim().max(maximum);

export const accessNeedsSchema = z.object({
	mode: modeSchema,
	language: z.enum(["en", "es", "other"]),
	interpreterRequested: z.boolean(),
	caregiver: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("none") }).strict(),
		z.object({ kind: z.literal("requested"), name: textField(80) }).strict(),
	]),
	captionsRequested: z.boolean(),
	largeText: z.boolean(),
	lowBandwidth: z.boolean(),
}).strict();

export const appointmentSlotSchema = z.object({
	id: z.string().regex(/^slot-[1-3]$/),
	startsAt: instantSchema,
	durationMinutes: z.literal(20),
	careTeam: z.literal("Demo care team"),
}).strict();
export const appointmentSchema = appointmentSlotSchema.extend({
	locationState: z.enum(usStates),
	timeZone: z.string().min(1).max(80).refine((value) => {
		try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
		catch { return false; }
	}, "Choose a valid time zone."),
}).strict();
export const intakeSchema = z.object({
	reason: textField(1200).min(3, "Describe the fictional reason for this visit."),
	goals: textField(1200),
	medications: textField(1200),
	allergies: textField(1200),
	communicationNotes: textField(800),
}).strict();

export const insuranceCheckSchema = z.object({
	scenario: insuranceScenarioSchema,
	status: z.enum(["active", "inactive", "unknown", "authorization-needed"]),
	planName: z.literal("Community Demo Health"),
	patientEstimateCents: z.number().int().min(0).max(50000).nullable().default(null),
	explanation: z.string().max(1000),
	checkedAt: instantSchema,
	simulation: z.literal(true),
}).strict();
export const quoteSchema = z.object({
	id: z.string().uuid(),
	amountCents: z.literal(3500),
	currency: z.literal("USD"),
	expiresAt: instantSchema,
	simulation: z.literal(true),
}).strict();
export const paymentReceiptSchema = z.object({
	id: z.string().uuid(),
	quoteId: z.string().uuid(),
	amountCents: z.literal(3500),
	currency: z.literal("USD"),
	settledAt: instantSchema,
	verification: z.literal("simulated"),
	settlement: z.literal("simulated"),
	transaction: z.literal(""),
}).strict();
export const billingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("insurance"), eligibility: insuranceCheckSchema }).strict(),
	z.object({ kind: z.literal("self-pay"), quote: quoteSchema, receipt: paymentReceiptSchema }).strict(),
	z.object({ kind: z.literal("assistance"), patientEstimateCents: z.literal(0), explanation: z.string().max(1000) }).strict(),
]);
export const consentSchema = z.object({
	version: z.literal("demo-2026-09-09"),
	acceptedAt: instantSchema,
	syntheticDataOnly: z.literal(true),
	understandsSimulation: z.literal(true),
	telehealthAcknowledged: z.literal(true),
	locationConfirmed: z.literal(true),
}).strict();
export const chatMessageSchema = z.object({
	id: z.string().uuid(),
	kind: z.enum(["participant", "scripted-demo"]),
	text: z.string().min(1).max(1600),
	sentAt: instantSchema,
}).strict();
export const consultationSchema = z.object({
	id: z.string().uuid(),
	startedAt: instantSchema,
	mode: modeSchema,
	generation: z.number().int().min(1).max(20),
	messages: z.array(chatMessageSchema).max(40),
}).strict();
export const afterVisitSchema = z.object({
	id: z.string().uuid(),
	createdAt: instantSchema,
	provenance: z.literal("scripted-demo"),
	clinicianReviewed: z.literal(false),
	title: z.literal("Sample after-visit summary"),
	summary: z.string().max(2000),
	nextSteps: z.array(z.string().max(500)).max(8),
	claimStatus: z.enum(["not-applicable", "simulated-approved", "simulated-denied"]),
	notice: z.string().max(1000),
}).strict();

const selectedShape = { appointment: appointmentSchema, intake: intakeSchema };
const coveredShape = { ...selectedShape, billing: billingSchema };
const readyShape = { ...coveredShape, consent: consentSchema };
const openVisitSchemas = [
	z.object({ kind: z.literal("appointment") }).strict(),
	z.object({ kind: z.literal("intake"), appointment: appointmentSchema }).strict(),
	z.object({ kind: z.literal("coverage"), ...selectedShape, insuranceCheck: insuranceCheckSchema.nullable().default(null) }).strict(),
	z.object({ kind: z.literal("payment"), ...selectedShape, quote: quoteSchema }).strict(),
	z.object({ kind: z.literal("consent"), ...coveredShape }).strict(),
	z.object({ kind: z.literal("ready"), ...readyShape }).strict(),
	z.object({ kind: z.literal("consulting"), ...readyShape, consultation: consultationSchema }).strict(),
] as const;
export const openVisitStateSchema = z.discriminatedUnion("kind", openVisitSchemas);
export const visitStateSchema = z.discriminatedUnion("kind", [
	...openVisitSchemas,
	z.object({ kind: z.literal("complete"), ...readyShape, consultation: consultationSchema, endedAt: instantSchema, afterVisit: afterVisitSchema }).strict(),
	z.object({ kind: z.literal("cancelled"), previous: openVisitStateSchema, cancelledAt: instantSchema }).strict(),
]);
export const timelineEventSchema = z.object({
	revision: z.number().int().min(0),
	at: instantSchema,
	label: z.string().max(200),
}).strict();
export const visitSnapshotSchema = z.object({
	visitId: visitIdSchema,
	revision: z.number().int().min(0),
	scenarioId: scenarioSchema,
	patientDisplay: z.string().max(80),
	access: accessNeedsSchema,
	appointmentOptions: z.array(appointmentSlotSchema).length(3),
	paymentHistory: z.array(z.object({ commandId: commandIdSchema, quote: quoteSchema, receipt: paymentReceiptSchema }).strict()).max(8),
	state: visitStateSchema,
	timeline: z.array(timelineEventSchema).max(100),
	createdAt: instantSchema,
}).strict();

export const paymentChoiceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("insurance"), scenario: insuranceScenarioSchema }).strict(),
	z.object({ kind: z.literal("self-pay") }).strict(),
	z.object({ kind: z.literal("assistance") }).strict(),
]);
export const visitCommandSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("choose_appointment"), slotId: appointmentSlotSchema.shape.id, locationState: z.enum(usStates), timeZone: appointmentSchema.shape.timeZone }).strict(),
	z.object({ kind: z.literal("save_intake"), intake: intakeSchema, access: accessNeedsSchema }).strict(),
	z.object({ kind: z.literal("select_payment"), choice: paymentChoiceSchema }).strict(),
	z.object({ kind: z.literal("simulate_payment"), quoteId: quoteSchema.shape.id, outcome: z.enum(["approve", "decline"]) }).strict(),
	z.object({ kind: z.literal("accept_consent"), version: consentSchema.shape.version, syntheticDataOnly: z.literal(true), understandsSimulation: z.literal(true), telehealthAcknowledged: z.literal(true), locationConfirmed: z.literal(true) }).strict(),
	z.object({ kind: z.literal("enter_consultation"), mode: modeSchema }).strict(),
	z.object({ kind: z.literal("send_demo_message"), text: textField(1200).min(1) }).strict(),
	z.object({ kind: z.literal("finish_consultation") }).strict(),
	z.object({ kind: z.literal("set_access"), access: accessNeedsSchema }).strict(),
	z.object({ kind: z.literal("cancel_visit") }).strict(),
]);
export const actionNameSchema = z.enum([
	"choose_appointment", "save_intake", "select_payment", "simulate_payment", "accept_consent",
	"enter_consultation", "send_demo_message", "finish_consultation", "set_access", "cancel_visit",
]);
export const visitEnvelopeSchema = z.object({
	schemaVersion: z.literal(1),
	mode: z.literal("synthetic"),
	credential: credentialSchema,
	expiresAt: instantSchema,
	snapshot: visitSnapshotSchema,
	availableActions: z.array(actionNameSchema),
}).strict();
export const startInputSchema = z.object({ scenarioId: scenarioSchema.default("rural-adult") }).strict();
export const resumeInputSchema = z.object({ credential: credentialSchema }).strict();
export const advanceInputSchema = resumeInputSchema.extend({
	commandId: commandIdSchema,
	expectedRevision: z.number().int().min(0),
	command: visitCommandSchema,
}).strict();
export const careResultSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ok"), envelope: visitEnvelopeSchema, replayed: z.boolean() }).strict(),
	z.object({ kind: z.literal("conflict"), envelope: visitEnvelopeSchema, message: z.string() }).strict(),
	z.object({ kind: z.literal("error"), code: z.enum(["invalid_input", "not_found", "expired", "invalid_transition", "command_reused", "quote_expired", "payment_declined", "temporarily_unavailable", "limit_reached"]), message: z.string() }).strict(),
]);

export const mediaInputSchema = resumeInputSchema.extend({ mode: z.enum(["video", "audio"]) }).strict();
export const mediaResultSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("practice"), reason: z.enum(["unconfigured", "text-mode"]), message: z.string() }).strict(),
	z.object({ kind: z.literal("livekit"), serverUrl: z.url(), token: z.string().min(1), roomName: z.string(), participantIdentity: z.string(), expiresAt: instantSchema }).strict(),
	z.object({ kind: z.literal("error"), message: z.string() }).strict(),
]);

export type VisitId = z.infer<typeof visitIdSchema>;
export type CommandId = z.infer<typeof commandIdSchema>;
export type VisitCredential = z.infer<typeof credentialSchema>;
export type ScenarioId = z.infer<typeof scenarioSchema>;
export type AccessNeeds = z.infer<typeof accessNeedsSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type Intake = z.infer<typeof intakeSchema>;
export type InsuranceScenario = z.infer<typeof insuranceScenarioSchema>;
export type InsuranceCheck = z.infer<typeof insuranceCheckSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;
export type Billing = z.infer<typeof billingSchema>;
export type VisitState = z.infer<typeof visitStateSchema>;
export type VisitSnapshot = z.infer<typeof visitSnapshotSchema>;
export type VisitCommand = z.infer<typeof visitCommandSchema>;
export type ActionName = z.infer<typeof actionNameSchema>;
export type VisitEnvelope = z.infer<typeof visitEnvelopeSchema>;
export type StartInput = z.infer<typeof startInputSchema>;
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type AdvanceInput = z.infer<typeof advanceInputSchema>;
export type CareResult = z.infer<typeof careResultSchema>;
export type MediaInput = z.infer<typeof mediaInputSchema>;
export type MediaResult = z.infer<typeof mediaResultSchema>;

export interface CareClient {
	start(input: StartInput): Promise<CareResult>;
	resume(input: ResumeInput): Promise<CareResult>;
	advance(input: AdvanceInput): Promise<CareResult>;
}
