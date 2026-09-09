import { z } from "zod";
import type { InsuranceCheck, InsuranceScenario, PaymentReceipt, Quote, VisitSnapshot } from "./contracts.js";

export function checkInsurance({ scenario, now }: { scenario: InsuranceScenario; now: string }): InsuranceCheck {
	const common = { scenario, planName: "Community Demo Health", checkedAt: now, simulation: true } satisfies Partial<InsuranceCheck>;
	switch (scenario) {
		case "active-copay":
		case "claim-denied":
			return { ...common, status: "active", patientEstimateCents: 1500, explanation: "Simulated active coverage with a $15 demo copay estimate. Eligibility does not guarantee claim approval. Coverage and costs have not been verified." };
		case "inactive":
			return { ...common, status: "inactive", patientEstimateCents: null, explanation: "The fictional plan is inactive for this visit. Choose another demo payment option. Coverage and costs have not been verified." };
		case "unknown-member":
			return { ...common, status: "unknown", patientEstimateCents: null, explanation: "The mock payer could not find the fictional member. Coverage and costs remain unknown and have not been verified." };
		case "benefits-unavailable":
			return { ...common, status: "unknown", patientEstimateCents: null, explanation: "The mock payer could not return benefits. No coverage or cost estimate is available. Coverage and costs have not been verified." };
		case "prior-authorization-required":
			return { ...common, status: "authorization-needed", patientEstimateCents: null, explanation: "The fictional plan requires prior authorization. This demo cannot request authorization. Coverage and costs have not been verified." };
		default: {
			const exhaustive: never = scenario;
			return exhaustive;
		}
	}
}

// x402 v2 core and MCP binding: https://github.com/x402-foundation/x402/tree/main/specs
// This private mock scheme deliberately cannot be mistaken for a supported wallet scheme.
const mockRequirementSchema = z.object({
	scheme: z.literal("mock-exact"),
	network: z.literal("eip155:84532"),
	amount: z.literal("35000000"),
	asset: z.literal("0x0000000000000000000000000000000000000000"),
	payTo: z.literal("0x0000000000000000000000000000000000000000"),
	maxTimeoutSeconds: z.literal(120),
	extra: z.object({ simulation: z.literal(true), name: z.literal("DEMO-USD"), decimals: z.literal(6), quoteId: z.string().uuid(), expiresAt: z.iso.datetime() }).strict(),
}).strict();
const mockResourceSchema = z.object({
	url: z.url(),
	description: z.literal("Simulated self-pay visit. No wallet, signature, or money movement."),
	mimeType: z.literal("application/json"),
}).strict();
export const mockPaymentRequiredSchema = z.object({
	x402Version: z.literal(2),
	error: z.literal("Simulated payment authorization required. No money will move."),
	resource: mockResourceSchema,
	accepts: z.tuple([mockRequirementSchema]),
}).strict();
export const mockPaymentPayloadSchema = z.object({
	x402Version: z.literal(2),
	resource: mockResourceSchema,
	accepted: mockRequirementSchema,
	payload: z.object({ simulation: z.literal(true), operationId: z.string().uuid(), quoteId: z.string().uuid(), authorization: z.literal("approve-demo-payment") }).strict(),
}).strict();
export type MockPaymentRequired = z.infer<typeof mockPaymentRequiredSchema>;
export type MockPaymentPayload = z.infer<typeof mockPaymentPayloadSchema>;
type PaymentContext = { quote: Quote; resourceUrl: string };

export function createPaymentRequired({ quote, resourceUrl }: PaymentContext): MockPaymentRequired {
	return {
		x402Version: 2,
		error: "Simulated payment authorization required. No money will move.",
		resource: { url: resourceUrl, description: "Simulated self-pay visit. No wallet, signature, or money movement.", mimeType: "application/json" },
		accepts: [{
			scheme: "mock-exact", network: "eip155:84532", amount: "35000000",
			asset: "0x0000000000000000000000000000000000000000", payTo: "0x0000000000000000000000000000000000000000", maxTimeoutSeconds: 120,
			extra: { simulation: true, name: "DEMO-USD", decimals: 6, quoteId: quote.id, expiresAt: quote.expiresAt },
		}],
	};
}

export function createMockPaymentPayload({ quote, resourceUrl, operationId }: PaymentContext & { operationId: string }): MockPaymentPayload {
	const required = createPaymentRequired({ quote, resourceUrl });
	return { x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { simulation: true, operationId, quoteId: quote.id, authorization: "approve-demo-payment" } };
}

export function validateMockPaymentPayload({ payload, ...context }: PaymentContext & { operationId: string; payload: unknown }): boolean {
	const parsed = mockPaymentPayloadSchema.safeParse(payload);
	if (!parsed.success) return false;
	return JSON.stringify(parsed.data) === JSON.stringify(createMockPaymentPayload(context));
}

export type MockSettlementResponse = { success: true; transaction: ""; network: "eip155:84532" };
export function createPaymentSettlement(_receipt: PaymentReceipt): MockSettlementResponse {
	return { success: true, transaction: "", network: "eip155:84532" };
}

const demoSystem = "https://virtual-care.example/CodeSystem/demo";
const terminology = "http://terminology.hl7.org/CodeSystem/";
const referenceSchema = z.object({ reference: z.string().min(1) }).strict();
const codingSchema = z.object({ system: z.url(), code: z.string().min(1), display: z.string().min(1).optional() }).strict();
const conceptSchema = z.object({ coding: z.array(codingSchema).min(1) }).strict();
const moneySchema = z.object({ value: z.number().min(0), currency: z.literal("USD") }).strict();
const periodSchema = z.object({ start: z.iso.datetime(), end: z.iso.datetime().optional() }).strict();
const baseSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/),
	meta: z.object({ tag: z.array(codingSchema).min(1) }).strict(),
});
const domainSchema = baseSchema.extend({ text: z.object({ status: z.literal("generated"), div: z.string() }).strict() });
const attachmentSchema = z.object({ contentType: z.string(), data: z.string().min(1), title: z.string() }).strict();
const adjudicationSchema = z.object({ category: conceptSchema, amount: moneySchema, reason: conceptSchema.optional() }).strict();
const financialShape = {
	status: z.literal("active"), type: conceptSchema, use: z.literal("claim"), patient: referenceSchema, created: z.iso.datetime(), insurer: referenceSchema,
};
const insuranceShape = { focal: z.literal(true), coverage: referenceSchema };
const claimItemShape = { sequence: z.literal(1), productOrService: conceptSchema, servicedDate: z.iso.date(), net: moneySchema };

// Schemas describe the emitted subset, including R4 required fields. They are not a full FHIR validator.
// Normative source anchors for the financial resources are recorded in test/billing.test.ts.
export const syntheticFhirResourceSchema = z.discriminatedUnion("resourceType", [
	domainSchema.extend({ resourceType: z.literal("Patient"), active: z.literal(true), name: z.array(z.object({ text: z.string() }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("Organization"), active: z.literal(true), name: z.string() }).strict(),
	domainSchema.extend({ resourceType: z.literal("Appointment"), status: z.enum(["booked", "fulfilled", "cancelled"]), start: z.iso.datetime(), end: z.iso.datetime(), participant: z.array(z.object({ actor: referenceSchema, status: z.literal("accepted") }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("Encounter"), status: z.enum(["in-progress", "finished", "cancelled"]), class: codingSchema, subject: referenceSchema, appointment: z.array(referenceSchema).min(1), period: periodSchema, serviceProvider: referenceSchema }).strict(),
	domainSchema.extend({ resourceType: z.literal("QuestionnaireResponse"), status: z.literal("completed"), subject: referenceSchema, authored: z.iso.datetime(), item: z.array(z.object({ linkId: z.string(), text: z.string(), answer: z.array(z.object({ valueString: z.string().min(1) }).strict()).min(1) }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("Consent"), status: z.literal("active"), scope: conceptSchema, category: z.array(conceptSchema).min(1), patient: referenceSchema, dateTime: z.iso.datetime(), sourceAttachment: attachmentSchema }).strict(),
	domainSchema.extend({ resourceType: z.literal("DocumentReference"), status: z.literal("current"), type: conceptSchema, subject: referenceSchema, date: z.iso.datetime(), description: z.string(), content: z.array(z.object({ attachment: attachmentSchema }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("Coverage"), status: z.enum(["active", "cancelled", "draft"]), beneficiary: referenceSchema, payor: z.array(referenceSchema).min(1), subscriberId: z.string() }).strict(),
	domainSchema.extend({ resourceType: z.literal("CoverageEligibilityRequest"), status: z.literal("active"), purpose: z.array(z.enum(["validation", "benefits"])).min(1), patient: referenceSchema, servicedDate: z.iso.date(), created: z.iso.datetime(), insurer: referenceSchema, provider: referenceSchema, insurance: z.array(z.object(insuranceShape).strict()).min(1), item: z.array(z.object({ productOrService: conceptSchema }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("CoverageEligibilityResponse"), status: z.literal("active"), purpose: z.array(z.enum(["validation", "benefits"])).min(1), patient: referenceSchema, servicedDate: z.iso.date(), created: z.iso.datetime(), request: referenceSchema, outcome: z.enum(["complete", "partial", "error"]), disposition: z.string(), insurer: referenceSchema,
		insurance: z.array(z.object({ coverage: referenceSchema, inforce: z.boolean().optional(), item: z.array(z.object({ productOrService: conceptSchema, authorizationRequired: z.boolean(), benefit: z.array(z.object({ type: conceptSchema, allowedMoney: moneySchema }).strict()).min(1).optional() }).strict()).min(1).optional() }).strict()).min(1),
		error: z.array(z.object({ code: conceptSchema }).strict()).min(1).optional(),
	}).strict(),
	domainSchema.extend({ resourceType: z.literal("Claim"), ...financialShape, provider: referenceSchema, priority: conceptSchema, insurance: z.array(z.object({ sequence: z.literal(1), ...insuranceShape }).strict()).min(1), item: z.array(z.object(claimItemShape).strict()).min(1), total: moneySchema }).strict(),
	domainSchema.extend({ resourceType: z.literal("ClaimResponse"), ...financialShape, request: referenceSchema, outcome: z.literal("complete"), disposition: z.string(), item: z.array(z.object({ itemSequence: z.literal(1), adjudication: z.array(adjudicationSchema).min(1) }).strict()).min(1), total: z.array(z.object({ category: conceptSchema, amount: moneySchema }).strict()).min(1) }).strict(),
	domainSchema.extend({ resourceType: z.literal("ExplanationOfBenefit"), ...financialShape, provider: referenceSchema, claim: referenceSchema, claimResponse: referenceSchema, outcome: z.literal("complete"), disposition: z.string(), insurance: z.array(z.object(insuranceShape).strict()).min(1), item: z.array(z.object({ ...claimItemShape, adjudication: z.array(adjudicationSchema).min(1) }).strict()).min(1), total: z.array(z.object({ category: conceptSchema, amount: moneySchema }).strict()).min(1) }).strict(),
]);
export const syntheticFhirBundleSchema = baseSchema.extend({ resourceType: z.literal("Bundle"), type: z.literal("collection"), timestamp: z.iso.datetime(), entry: z.array(z.object({ fullUrl: z.url(), resource: syntheticFhirResourceSchema }).strict()).min(1) }).strict();
type FhirResource = z.infer<typeof syntheticFhirResourceSchema>;
export type SyntheticFhirBundle = z.infer<typeof syntheticFhirBundleSchema>;

function concept(code: string, system = demoSystem) { return { coding: [{ system, code }] }; }
function money(cents: number) { return { value: cents / 100, currency: "USD" } satisfies z.infer<typeof moneySchema>; }
function base(id: string, narrative: string) {
	const escaped = narrative.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
	return { id, meta: { tag: [{ system: demoSystem, code: "synthetic", display: "Fictional data. No clinical service, payer submission, or payment." }] }, text: { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escaped}</p></div>` } } satisfies z.infer<typeof domainSchema>;
}

export function exportFhirRecord(snapshot: VisitSnapshot): SyntheticFhirBundle {
	const state = snapshot.state.kind === "cancelled" ? snapshot.state.previous : snapshot.state;
	const cancelled = snapshot.state.kind === "cancelled";
	const lastEvent = snapshot.timeline.at(-1);
	const timestamp = lastEvent?.at ?? snapshot.createdAt;
	const namespace = `https://virtual-care.example/fhir/${snapshot.visitId}/`;
	const reference = (resourceType: FhirResource["resourceType"], id: string) => ({ reference: `${namespace}${resourceType}/${id}` });
	const patient = reference("Patient", "patient");
	const provider = reference("Organization", "demo-care-team");
	const insurer = reference("Organization", "demo-payer");
	const resources: FhirResource[] = [
		{ ...base("patient", "Fictional sample patient. Do not use for care."), resourceType: "Patient", active: true, name: [{ text: snapshot.patientDisplay }] },
		{ ...base("demo-care-team", "Demo care team. No clinician is providing care."), resourceType: "Organization", active: true, name: "Demo care team" },
		{ ...base("record", "Complete synthetic visit snapshot. No clinician reviewed or signed this record."), resourceType: "DocumentReference", status: "current", type: concept("synthetic-visit-record"), subject: patient, date: timestamp, description: "Lossless current synthetic snapshot, including access needs, timeline, consultation messages, and local billing state. No credentials or media tokens.", content: [{ attachment: { contentType: "application/json", data: Buffer.from(JSON.stringify(snapshot)).toString("base64"), title: "Complete synthetic visit snapshot" } }] },
	];
	if ("appointment" in state) {
		resources.push({ ...base("appointment", "Demo appointment saved. No real appointment has been booked."), resourceType: "Appointment", status: cancelled ? "cancelled" : state.kind === "complete" ? "fulfilled" : "booked", start: state.appointment.startsAt, end: new Date(Date.parse(state.appointment.startsAt) + state.appointment.durationMinutes * 60_000).toISOString(), participant: [{ actor: patient, status: "accepted" }, { actor: provider, status: "accepted" }] });
	}
	if ("intake" in state) {
		resources.push({ ...base("intake", "Sample intake supplied for rehearsal. No clinical assessment occurred."), resourceType: "QuestionnaireResponse", status: "completed", subject: patient, authored: timestamp, item: Object.entries(state.intake).map(([linkId, value]) => ({ linkId, text: linkId, answer: [{ valueString: value || "Not supplied in this simulation." }] })) });
	}
	if ("consent" in state) {
		resources.push({ ...base("consent", "Acknowledgment of this synthetic telehealth demonstration. Not a real clinical consent."), resourceType: "Consent", status: "active", scope: concept("treatment", `${terminology}consentscope`), category: [concept("synthetic-telehealth-acknowledgment")], patient, dateTime: state.consent.acceptedAt, sourceAttachment: { contentType: "application/json", data: Buffer.from(JSON.stringify(state.consent)).toString("base64"), title: "Synthetic visit acknowledgment" } });
	}
	if ("consultation" in state) {
		resources.push({ ...base("encounter", "Practice visit. No clinician is connected."), resourceType: "Encounter", status: cancelled ? "cancelled" : state.kind === "complete" ? "finished" : "in-progress", class: { system: `${terminology}v3-ActCode`, code: "VR" }, subject: patient, appointment: [reference("Appointment", "appointment")], serviceProvider: provider, period: { start: state.consultation.startedAt, ...(state.kind === "complete" ? { end: state.endedAt } : snapshot.state.kind === "cancelled" ? { end: snapshot.state.cancelledAt } : {}) } });
	}
	if (state.kind === "complete") {
		resources.push({ ...base("after-visit", state.afterVisit.notice), resourceType: "DocumentReference", status: "current", type: concept("sample-after-visit-summary"), subject: patient, date: state.afterVisit.createdAt, description: state.afterVisit.notice, content: [{ attachment: { contentType: "text/plain", title: state.afterVisit.title, data: Buffer.from([state.afterVisit.notice, state.afterVisit.summary, ...state.afterVisit.nextSteps].join("\n\n")).toString("base64") } }] });
	}
	const check = "insuranceCheck" in state ? state.insuranceCheck : "billing" in state && state.billing.kind === "insurance" ? state.billing.eligibility : null;
	if (check && "appointment" in state) {
		const serviceDate = new Intl.DateTimeFormat("en-CA", { timeZone: state.appointment.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(state.appointment.startsAt));
		const coverage = reference("Coverage", "coverage");
		resources.push(
			{ ...base("demo-payer", "Fictional payer. No insurer connection exists."), resourceType: "Organization", active: true, name: check.planName },
			{ ...base("coverage", check.explanation), resourceType: "Coverage", status: check.status === "inactive" ? "cancelled" : check.status === "unknown" ? "draft" : "active", beneficiary: patient, payor: [insurer], subscriberId: "DEMO-MEMBER" },
			{ ...base("eligibility-request", "Simulated eligibility request. Nothing was sent to an insurer."), resourceType: "CoverageEligibilityRequest", status: "active", purpose: ["validation", "benefits"], patient, servicedDate: serviceDate, created: check.checkedAt, insurer, provider, insurance: [{ focal: true, coverage }], item: [{ productOrService: concept("demo-virtual-visit") }] },
			{ ...base("eligibility-response", check.explanation), resourceType: "CoverageEligibilityResponse", status: "active", purpose: ["validation", "benefits"], patient, servicedDate: serviceDate, created: check.checkedAt, request: reference("CoverageEligibilityRequest", "eligibility-request"), outcome: check.scenario === "unknown-member" ? "error" : check.scenario === "benefits-unavailable" ? "partial" : "complete", disposition: check.explanation, insurer,
				insurance: [{ coverage, ...(check.status === "unknown" ? {} : { inforce: check.status !== "inactive" }), ...(check.status === "active" || check.status === "authorization-needed" ? { item: [{ productOrService: concept("demo-virtual-visit"), authorizationRequired: check.status === "authorization-needed", ...(check.patientEstimateCents === null ? {} : { benefit: [{ type: concept("demo-patient-copay-estimate"), allowedMoney: money(check.patientEstimateCents) }] }) }] } : {}) }],
				...(check.scenario === "unknown-member" ? { error: [{ code: concept("unknown-demo-member") }] } : {}),
			},
		);
		if (state.kind === "complete" && state.billing.kind === "insurance") {
			const denied = state.afterVisit.claimStatus === "simulated-denied";
			const disposition = denied ? "Demo claim denied locally. Nothing was sent to an insurer. This is not a bill." : "Demo claim approved locally. Nothing was sent to an insurer. This is not a bill.";
			const common = { status: "active", type: concept("professional", `${terminology}claim-type`), use: "claim", patient, created: state.afterVisit.createdAt, insurer } satisfies z.infer<z.ZodObject<typeof financialShape>>;
			const line = { sequence: 1, productOrService: concept("demo-virtual-visit"), servicedDate: serviceDate, net: money(3500) } satisfies z.infer<z.ZodObject<typeof claimItemShape>>;
			const benefit = denied ? 0 : 3500 - (check.patientEstimateCents ?? 1500);
			const adjudication = [
				{ category: concept("submitted", `${terminology}adjudication`), amount: money(3500) },
				{ category: concept("benefit", `${terminology}adjudication`), amount: money(benefit), ...(denied ? { reason: concept("demo-claim-denied") } : {}) },
				{ category: concept("demo-patient-responsibility"), amount: money(3500 - benefit) },
			];
			const total = adjudication.map(({ category, amount }) => ({ category, amount }));
			resources.push(
				{ ...base("claim", "Synthetic claim created and adjudicated locally. No payer submission occurred."), resourceType: "Claim", ...common, provider, priority: concept("normal", `${terminology}processpriority`), insurance: [{ sequence: 1, focal: true, coverage }], item: [line], total: money(3500) },
				{ ...base("claim-response", disposition), resourceType: "ClaimResponse", ...common, request: reference("Claim", "claim"), outcome: "complete", disposition, item: [{ itemSequence: 1, adjudication }], total },
				{ ...base("eob", disposition), resourceType: "ExplanationOfBenefit", ...common, provider, claim: reference("Claim", "claim"), claimResponse: reference("ClaimResponse", "claim-response"), outcome: "complete", disposition, insurance: [{ focal: true, coverage }], item: [{ ...line, adjudication }], total },
			);
		}
	}
	return { resourceType: "Bundle", id: snapshot.visitId, meta: { tag: [{ system: demoSystem, code: "synthetic" }] }, type: "collection", timestamp, entry: resources.map((resource) => ({ fullUrl: `${namespace}${resource.resourceType}/${resource.id}`, resource })) };
}
