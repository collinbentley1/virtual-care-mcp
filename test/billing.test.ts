import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	checkInsurance, createMockPaymentPayload, createPaymentRequired, createPaymentSettlement,
	exportFhirRecord, mockPaymentRequiredSchema, syntheticFhirBundleSchema,
	validateMockPaymentPayload,
} from "../src/billing.js";
import { commandIdSchema, insuranceCheckSchema, insuranceScenarioSchema, type CareResult, type InsuranceScenario, type Quote, type VisitCommand } from "../src/contracts.js";
import { createMemoryStore } from "../src/persistence.js";
import { createCareService } from "../src/visit.js";

const at = "2026-09-09T03:30:00.000Z";
const quote: Quote = { id: "d5fc6e60-9993-47ac-adeb-71b53fbba9ca", amountCents: 3500, currency: "USD", expiresAt: "2026-09-09T03:45:00.000Z", simulation: true };
const paymentContext = { quote, resourceUrl: "mcp://virtual-care/visits/fictional-visit/quotes/d5fc6e60-9993-47ac-adeb-71b53fbba9ca", operationId: "f39b706c-b074-4993-a88d-6d207063014a" };

function envelope(result: CareResult) {
	if (result.kind !== "ok") throw new Error("Expected successful fixture operation.");
	return result.envelope;
}

async function visit(scenario: InsuranceScenario | "self-pay" | "assistance") {
	const store = createMemoryStore();
	const care = createCareService({ store, now: () => new Date(at) });
	let current = envelope(await care.start({ scenarioId: "older-adult" }));
	const send = async (command: VisitCommand) => {
		current = envelope(await care.advance({ credential: current.credential, commandId: commandIdSchema.parse(crypto.randomUUID()), expectedRevision: current.snapshot.revision, command }));
		return current;
	};
	await send({ kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
	await send({ kind: "save_intake", access: current.snapshot.access, intake: { reason: "Practice explaining a fictional concern <script>", goals: "Review the software", medications: "", allergies: "", communicationNotes: "Sample-only café" } });
	await send({ kind: "select_payment", choice: scenario === "self-pay" || scenario === "assistance" ? { kind: scenario } : { kind: "insurance", scenario } });
	return { care, store, send, current: () => current };
}

async function complete(scenario: "active-copay" | "claim-denied" | "self-pay" | "assistance") {
	const fixture = await visit(scenario);
	const state = fixture.current().snapshot.state;
	if (state.kind === "payment") await fixture.send({ kind: "simulate_payment", quoteId: state.quote.id, outcome: "approve" });
	await fixture.send({ kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
	await fixture.send({ kind: "enter_consultation", mode: "video" });
	await fixture.send({ kind: "send_demo_message", text: "Fictional participant message" });
	await fixture.send({ kind: "finish_consultation" });
	return fixture;
}

describe("insurance fixtures", () => {
	test.each(insuranceScenarioSchema.options)("%s preserves uncertainty and its simulation label", (scenario) => {
		const check = checkInsurance({ scenario, now: at });
		expect(insuranceCheckSchema.parse(check)).toEqual(check);
		expect(check.checkedAt).toBe(at);
		expect(check.explanation).toContain("have not been verified");
		if (scenario === "active-copay" || scenario === "claim-denied") expect(check.patientEstimateCents).toBe(1500);
		else expect(check.patientEstimateCents).toBeNull();
	});
	test("claim denial does not rewrite earlier active eligibility", () => {
		expect(checkInsurance({ scenario: "claim-denied", now: at }).status).toBe("active");
	});
});

describe("x402 v2 protocol simulation", () => {
	// https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
	// https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md
	test("required, submitted, and settlement envelopes retain v2 fields", () => {
		const required = createPaymentRequired(paymentContext);
		expect(mockPaymentRequiredSchema.parse(required)).toEqual(required);
		expect(required.x402Version).toBe(2);
		expect(required.accepts[0].amount).toMatch(/^\d+$/);
		expect(required.accepts[0].network).toMatch(/^[a-z0-9-]{3,8}:[-_a-zA-Z0-9]{1,32}$/);
		expect(required.accepts[0].scheme).toBe("mock-exact");
		const payload = createMockPaymentPayload(paymentContext);
		expect(payload.accepted).toEqual(required.accepts[0]);
		expect(validateMockPaymentPayload({ ...paymentContext, payload })).toBeTrue();
		expect("signature" in payload.payload).toBeFalse();
		const settlement = createPaymentSettlement({ id: crypto.randomUUID(), quoteId: quote.id, amountCents: 3500, currency: "USD", settledAt: at, verification: "simulated", settlement: "simulated", transaction: "" });
		expect(settlement).toEqual({ success: true, transaction: "", network: "eip155:84532" });
	});
	test("rejects wrong operation, quote, expiration, amount, resource, extra properties, and real wallet schemes", () => {
		const payload = createMockPaymentPayload(paymentContext);
		const invalid: unknown[] = [
			null,
			{ ...payload, x402Version: 1 },
			{ ...payload, resource: { ...payload.resource, url: "mcp://another-visit/quote" } },
			{ ...payload, payload: { ...payload.payload, operationId: crypto.randomUUID() } },
			{ ...payload, payload: { ...payload.payload, quoteId: crypto.randomUUID() } },
			{ ...payload, payload: { ...payload.payload, signature: "not-a-signature" } },
			{ ...payload, accepted: { ...payload.accepted, amount: "1" } },
			{ ...payload, accepted: { ...payload.accepted, scheme: "exact" } },
			{ ...payload, accepted: { ...payload.accepted, extra: { ...payload.accepted.extra, expiresAt: "2026-09-10T00:00:00.000Z" } } },
		];
		for (const candidate of invalid) expect(validateMockPaymentPayload({ ...paymentContext, payload: candidate })).toBeFalse();
	});
	test("equivalent property ordering validates; changed quote cannot reuse authorization", () => {
		const payload = createMockPaymentPayload(paymentContext);
		const reordered = { payload: payload.payload, accepted: payload.accepted, resource: payload.resource, x402Version: payload.x402Version };
		expect(validateMockPaymentPayload({ ...paymentContext, payload: reordered })).toBeTrue();
		expect(validateMockPaymentPayload({ ...paymentContext, quote: { ...quote, id: crypto.randomUUID() }, payload })).toBeFalse();
	});
});

describe("FHIR R4 synthetic record", () => {
	// Required fields and nested cardinalities come from these base R4 definitions, not CARIN profiles:
	// https://hl7.org/fhir/R4/coverage.html
	// https://hl7.org/fhir/R4/coverageeligibilityrequest.html
	// https://hl7.org/fhir/R4/coverageeligibilityresponse.html
	// https://hl7.org/fhir/R4/claim.html
	// https://hl7.org/fhir/R4/claimresponse.html
	// https://hl7.org/fhir/R4/explanationofbenefit.html
	test.each(["active-copay", "claim-denied"] as const)("%s exports distinct linked financial records and the full snapshot", async (scenario) => {
		const fixture = await complete(scenario);
		try {
			const snapshot = fixture.current().snapshot;
			const bundle = exportFhirRecord(snapshot);
			expect(syntheticFhirBundleSchema.parse(bundle)).toEqual(bundle);
			const types: string[] = bundle.entry.map(({ resource }) => resource.resourceType);
			for (const type of ["Coverage", "CoverageEligibilityRequest", "CoverageEligibilityResponse", "Claim", "ClaimResponse", "ExplanationOfBenefit", "Patient", "Appointment", "QuestionnaireResponse", "Consent", "Encounter"]) expect(types).toContain(type);
			const urls = new Set(bundle.entry.map(({ fullUrl }) => fullUrl));
			function checkReferences(value: unknown) {
				if (Array.isArray(value)) { for (const child of value) checkReferences(child); }
				else if (typeof value === "object" && value !== null) {
					for (const [key, child] of Object.entries(value)) {
						if (key === "reference") expect(urls.has(z.string().parse(child))).toBeTrue();
						else checkReferences(child);
					}
				}
			}
			checkReferences(bundle);
			const record = bundle.entry.find(({ resource }) => resource.id === "record")?.resource;
			if (record?.resourceType !== "DocumentReference") throw new Error("Missing full record.");
			const content = record.content[0];
			if (!content) throw new Error("Missing snapshot attachment.");
			expect(JSON.parse(Buffer.from(content.attachment.data, "base64").toString())).toEqual(snapshot);
			expect(JSON.stringify(bundle)).not.toContain(fixture.current().credential);
			const eligibility = bundle.entry.find(({ resource }) => resource.resourceType === "CoverageEligibilityResponse")?.resource;
			if (eligibility?.resourceType !== "CoverageEligibilityResponse") throw new Error("Missing eligibility.");
			expect(eligibility.insurance[0]?.inforce).toBeTrue();
			const response = bundle.entry.find(({ resource }) => resource.resourceType === "ClaimResponse")?.resource;
			if (response?.resourceType !== "ClaimResponse") throw new Error("Missing adjudication.");
			expect(response.outcome).toBe("complete");
			expect(response.item[0]?.adjudication.find((item) => item.category.coding[0]?.code === "benefit")?.amount.value).toBe(scenario === "claim-denied" ? 0 : 20);
		} finally { fixture.store.close(); }
	});
	test.each(["inactive", "unknown-member", "benefits-unavailable", "prior-authorization-required"] as const)("%s has eligibility but no invented claim adjudication", async (scenario) => {
		const fixture = await visit(scenario);
		try {
			const bundle = exportFhirRecord(fixture.current().snapshot);
			expect(syntheticFhirBundleSchema.parse(bundle)).toEqual(bundle);
			expect(bundle.entry.some(({ resource }) => ["Claim", "ClaimResponse", "ExplanationOfBenefit"].includes(resource.resourceType))).toBeFalse();
			const response = bundle.entry.find(({ resource }) => resource.resourceType === "CoverageEligibilityResponse")?.resource;
			if (response?.resourceType !== "CoverageEligibilityResponse") throw new Error("Missing response.");
			if (scenario === "unknown-member" || scenario === "benefits-unavailable") expect(response.insurance[0]?.inforce).toBeUndefined();
			if (scenario === "prior-authorization-required") expect(response.insurance[0]?.item?.[0]?.authorizationRequired).toBeTrue();
		} finally { fixture.store.close(); }
	});
	test.each(["self-pay", "assistance"] as const)("%s does not invent insurance or payer payment", async (scenario) => {
		const fixture = await complete(scenario);
		try {
			const bundle = exportFhirRecord(fixture.current().snapshot);
			expect(syntheticFhirBundleSchema.parse(bundle)).toEqual(bundle);
			expect(bundle.entry.some(({ resource }) => ["Coverage", "Claim", "ClaimResponse", "ExplanationOfBenefit", "PaymentReconciliation"].includes(resource.resourceType))).toBeFalse();
		} finally { fixture.store.close(); }
	});
	test("service date uses appointment time zone and cancellation keeps prior information", async () => {
		const fixture = await visit("active-copay");
		try {
			await fixture.send({ kind: "cancel_visit" });
			const snapshot = fixture.current().snapshot;
			if (snapshot.state.kind !== "cancelled" || !("appointment" in snapshot.state.previous)) throw new Error("Expected cancelled booked visit.");
			snapshot.state.previous.appointment.startsAt = "2026-09-10T02:30:00.000Z";
			const bundle = exportFhirRecord(snapshot);
			expect(syntheticFhirBundleSchema.parse(bundle)).toEqual(bundle);
			const response = bundle.entry.find(({ resource }) => resource.resourceType === "CoverageEligibilityResponse")?.resource;
			if (response?.resourceType !== "CoverageEligibilityResponse") throw new Error("Missing response.");
			expect(response.servicedDate).toBe("2026-09-09");
			const appointment = bundle.entry.find(({ resource }) => resource.resourceType === "Appointment")?.resource;
			if (appointment?.resourceType !== "Appointment") throw new Error("Missing appointment.");
			expect(appointment.status).toBe("cancelled");
		} finally { fixture.store.close(); }
	});
});
