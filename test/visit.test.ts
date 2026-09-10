import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceInputSchema, careResultSchema, commandIdSchema, credentialSchema } from "../src/contracts.ts";
import type { CareClient, CareResult, ScenarioId, VisitCommand, VisitEnvelope } from "../src/contracts.ts";
import { createMemoryStore, createSqliteStore } from "../src/persistence.ts";
import type { VisitStore } from "../src/persistence.ts";
import { createCareService } from "../src/visit.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const action of cleanup.splice(0)) await action(); });

function saved(result: CareResult): VisitEnvelope {
	careResultSchema.parse(result);
	if (result.kind !== "ok") throw new Error(`Expected saved visit, received ${JSON.stringify(result)}`);
	return result.envelope;
}
async function harness(kind: "memory" | "sqlite") {
	let time = new Date("2030-09-09T14:00:00.000Z");
	const directory = await mkdtemp(join(tmpdir(), "virtual-care-test-"));
	const path = join(directory, "visits.sqlite");
	const store = kind === "memory" ? createMemoryStore() : await createSqliteStore(path);
	cleanup.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
	const care = createCareService({ store, now: () => time });
	return { care, store, path, advanceTime: (milliseconds: number) => { time = new Date(time.getTime() + milliseconds); } };
}
async function act(care: CareClient, current: VisitEnvelope, command: VisitCommand): Promise<VisitEnvelope> {
	return saved(await care.advance({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: commandIdSchema.parse(randomUUID()), command }));
}
async function prepared(care: CareClient, scenarioId: ScenarioId = "rural-adult"): Promise<VisitEnvelope> {
	let current = saved(await care.start({ scenarioId }));
	current = await act(care, current, { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
	return act(care, current, { kind: "save_intake", intake: {
		reason: "Fictional follow-up for a sample patient.", goals: "Practice asking questions.", medications: "Sample medication list.", allergies: "None in this fixture.", communicationNotes: "Please speak slowly.",
	}, access: current.snapshot.access });
}
async function ready(care: CareClient, choice: "insurance" | "assistance" = "assistance"): Promise<VisitEnvelope> {
	let current = await prepared(care);
	current = await act(care, current, { kind: "select_payment", choice: choice === "insurance" ? { kind: "insurance", scenario: "claim-denied" } : { kind: "assistance" } });
	return act(care, current, { kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
}

for (const kind of ["memory", "sqlite"] satisfies Array<"memory" | "sqlite">) {
	describe(`${kind} visit workflow`, () => {
		test("every offered appointment ends before the saved visit expires", async () => {
			const { care } = await harness(kind);
			const current = saved(await care.start({ scenarioId: "older-adult" }));
			for (const slot of current.snapshot.appointmentOptions) {
				expect(Date.parse(slot.startsAt)).toBeGreaterThan(Date.parse(current.snapshot.createdAt));
				expect(Date.parse(slot.startsAt) + slot.durationMinutes * 60_000).toBeLessThan(Date.parse(current.expiresAt));
			}
		});

		test("completes a fictional visit and retains intake, consent, scripted notes, and separate claim outcome", async () => {
			const { care } = await harness(kind);
			let current = await ready(care, "insurance");
			current = await act(care, current, { kind: "enter_consultation", mode: "audio" });
			current = await act(care, current, { kind: "send_demo_message", text: "A fictional question for this practice visit." });
			current = await act(care, current, { kind: "finish_consultation" });
			expect(current.snapshot.state.kind).toBe("complete");
			if (current.snapshot.state.kind !== "complete") throw new Error("Visit did not complete.");
			expect(current.snapshot.state.intake.reason).toContain("Fictional");
			expect(current.snapshot.state.consent.version).toBe("demo-2026-09-09");
			expect(current.snapshot.state.afterVisit.clinicianReviewed).toBe(false);
			expect(current.snapshot.state.afterVisit.claimStatus).toBe("simulated-denied");
			expect(current.snapshot.state.consultation.messages.map((message) => message.kind)).toEqual(["scripted-demo", "participant", "scripted-demo"]);
			expect(current.availableActions).toEqual([]);
			expect(saved(await care.resume({ credential: current.credential }))).toEqual(current);
		});

		test("a committed command replay returns the latest state and rejects different input with the same ID", async () => {
			const { care } = await harness(kind);
			const initial = saved(await care.start({ scenarioId: "older-adult" }));
			const request = advanceInputSchema.parse({ credential: initial.credential, expectedRevision: 0, commandId: randomUUID(), command: { kind: "choose_appointment", slotId: "slot-1", locationState: "TX", timeZone: "America/Chicago" } });
			let current = saved(await care.advance(request));
			current = await act(care, current, { kind: "set_access", access: { ...current.snapshot.access, lowBandwidth: true } });
			const replay = await care.advance(request);
			expect(replay.kind === "ok" && replay.replayed).toBe(true);
			expect(saved(replay).snapshot.revision).toBe(current.snapshot.revision);
			expect(saved(replay).snapshot.access.lowBandwidth).toBe(true);
			const reused = await care.advance({ ...request, command: { kind: "cancel_visit" } });
			expect(reused.kind === "error" && reused.code).toBe("command_reused");
		});

		test("two clients editing the same revision produce one save and one recoverable conflict", async () => {
			const { care } = await harness(kind);
			const initial = saved(await care.start({ scenarioId: "rural-adult" }));
			const requests = ["slot-1", "slot-2"].map((slotId) => advanceInputSchema.parse({ credential: initial.credential, expectedRevision: 0, commandId: randomUUID(), command: { kind: "choose_appointment", slotId, locationState: "NY", timeZone: "America/New_York" } }));
			const results = await Promise.all(requests.map((request) => care.advance(request)));
			expect(results.filter((result) => result.kind === "ok")).toHaveLength(1);
			const conflict = results.find((result) => result.kind === "conflict");
			expect(conflict?.kind === "conflict" && conflict.envelope.snapshot.revision).toBe(1);
		});

		test("cannot jump to consultation or accept false consent", async () => {
			const { care } = await harness(kind);
			const initial = saved(await care.start({ scenarioId: "rural-adult" }));
			const jump = await care.advance({ credential: initial.credential, expectedRevision: 0, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "enter_consultation", mode: "video" } });
			expect(jump.kind === "error" && jump.code).toBe("invalid_transition");
			expect(advanceInputSchema.safeParse({ credential: initial.credential, expectedRevision: 0, commandId: randomUUID(), command: { kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: false, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true } }).success).toBe(false);
			expect(saved(await care.resume({ credential: initial.credential })).snapshot.revision).toBe(0);
		});

		test("editing intake invalidates dependent consent but preserves appointment", async () => {
			const { care } = await harness(kind);
			let current = await ready(care);
			if (current.snapshot.state.kind !== "ready") throw new Error("Not ready.");
			const appointment = current.snapshot.state.appointment;
			current = await act(care, current, { kind: "save_intake", intake: { ...current.snapshot.state.intake, goals: "A revised fictional goal." }, access: current.snapshot.access });
			expect(current.snapshot.state.kind).toBe("coverage");
			if (current.snapshot.state.kind !== "coverage") throw new Error("Coverage review missing.");
			expect(current.snapshot.state.appointment).toEqual(appointment);
			expect("consent" in current.snapshot.state).toBe(false);
		});

		test("unknown coverage stays unknown and assistance remains available", async () => {
			const { care } = await harness(kind);
			let current = await prepared(care);
			current = await act(care, current, { kind: "select_payment", choice: { kind: "insurance", scenario: "benefits-unavailable" } });
			expect(current.snapshot.state.kind === "coverage" && current.snapshot.state.insuranceCheck?.patientEstimateCents).toBeNull();
			current = await act(care, current, { kind: "select_payment", choice: { kind: "assistance" } });
			expect(current.snapshot.state.kind).toBe("consent");
		});

		test("payment replay survives quote expiry and a later billing choice without another settlement", async () => {
			const { care, advanceTime } = await harness(kind);
			let current = await prepared(care);
			current = await act(care, current, { kind: "select_payment", choice: { kind: "self-pay" } });
			if (current.snapshot.state.kind !== "payment") throw new Error("Missing quote.");
			const quote = current.snapshot.state.quote;
			const request = advanceInputSchema.parse({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: randomUUID(), command: { kind: "simulate_payment", quoteId: quote.id, outcome: "approve" } });
			current = saved(await care.advance(request));
			const receipt = current.snapshot.paymentHistory[0];
			if (!receipt) throw new Error("Payment receipt was not retained.");
			expect(receipt?.quote).toEqual(quote);
			expect(receipt?.receipt.transaction).toBe("");
			current = await act(care, current, { kind: "select_payment", choice: { kind: "assistance" } });
			advanceTime(16 * 60 * 1000);
			const replay = await care.advance(request);
			expect(replay.kind === "ok" && replay.replayed).toBe(true);
			expect(saved(replay).snapshot.paymentHistory).toEqual([receipt]);
			expect(saved(replay).snapshot.revision).toBe(current.snapshot.revision);
		});

		test("unsettled expired quotes are rejected", async () => {
			const { care, advanceTime } = await harness(kind);
			let current = await prepared(care);
			current = await act(care, current, { kind: "select_payment", choice: { kind: "self-pay" } });
			if (current.snapshot.state.kind !== "payment") throw new Error("Missing quote.");
			advanceTime(16 * 60 * 1000);
			const result = await care.advance({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "simulate_payment", quoteId: current.snapshot.state.quote.id, outcome: "approve" } });
			expect(result.kind === "error" && result.code).toBe("quote_expired");
		});

		test("expiry applies to both reads and writes; another credential cannot open a visit", async () => {
			const { care, advanceTime } = await harness(kind);
			const initial = saved(await care.start({ scenarioId: "rural-adult" }));
			const other = saved(await care.start({ scenarioId: "uninsured-adult" }));
			const forged = credentialSchema.parse(`${initial.credential.slice(0, 41)}${other.credential.slice(41)}`);
			const forbidden = await care.resume({ credential: forged });
			expect(forbidden.kind === "error" && forbidden.code).toBe("not_found");
			advanceTime(24 * 60 * 60 * 1000);
			const read = await care.resume({ credential: initial.credential });
			const write = await care.advance({ credential: initial.credential, expectedRevision: 0, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "cancel_visit" } });
			expect(read.kind === "error" && read.code).toBe("expired");
			expect(write.kind === "error" && write.code).toBe("expired");
		});

		test("cancellation retains the prepared record and blocks later progression", async () => {
			const { care } = await harness(kind);
			let current = await ready(care);
			const prior = current.snapshot.state;
			if (prior.kind !== "ready") throw new Error("Visit was not ready before cancellation.");
			current = await act(care, current, { kind: "cancel_visit" });
			expect(current.snapshot.state.kind === "cancelled" && current.snapshot.state.previous).toEqual(prior);
			const later = await care.advance({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "enter_consultation", mode: "audio" } });
			expect(later.kind === "error" && later.code).toBe("invalid_transition");
		});

		test("cancelling a booked postpartum visit cancels its matching plan milestone", async () => {
			const { care } = await harness(kind);
			let current = saved(await care.start({ scenarioId: "postpartum" }));
			current = await act(care, current, { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
			current = await act(care, current, { kind: "cancel_visit" });
			if (current.snapshot.state.kind !== "cancelled" || current.snapshot.specialtyPlan.kind !== "maternal-postpartum") throw new Error("The postpartum visit was not cancelled.");
			expect(current.snapshot.specialtyPlan.timeline.map((milestone) => milestone.progress.kind)).toEqual(["cancelled", "open"]);
			expect(current.snapshot.specialtyPlan.timeline[0]?.progress).toEqual({ kind: "cancelled", cancelledAt: current.snapshot.state.cancelledAt });
			expect(current.availableActions).toEqual([]);
		});

		test("postpartum plan edits survive completion, replay, and conflict without changing the summary or booking a follow-up", async () => {
			const { care } = await harness(kind);
			let current = await prepared(care, "postpartum");
			current = await act(care, current, { kind: "select_payment", choice: { kind: "assistance" } });
			current = await act(care, current, { kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
			current = await act(care, current, { kind: "enter_consultation", mode: "audio" });
			current = await act(care, current, { kind: "finish_consultation" });
			const completed = structuredClone(current.snapshot.state);
			expect(current.availableActions).toEqual(["update_maternal_plan"]);
			if (current.snapshot.specialtyPlan.kind !== "maternal-postpartum") throw new Error("Missing postpartum plan.");
			const timeline = structuredClone(current.snapshot.specialtyPlan.timeline);
			expect(timeline.map((milestone) => milestone.timing.kind)).toEqual(["scheduled", "to-arrange"]);
			expect(timeline.map((milestone) => milestone.progress.kind)).toEqual(["complete", "open"]);
			expect(timeline[0]?.progress).toEqual({ kind: "complete", completedAt: current.snapshot.state.kind === "complete" ? current.snapshot.state.endedAt : "" });
			const addQuestion = advanceInputSchema.parse({ credential: current.credential, commandId: randomUUID(), expectedRevision: current.snapshot.revision, command: { kind: "update_maternal_plan", update: { kind: "add_question", text: "What would help me prepare for my next visit?" } } });
			current = saved(await care.advance(addQuestion));
			current = await act(care, current, { kind: "update_maternal_plan", update: { kind: "complete_task", taskId: "arrange-follow-up" } });
			const replay = await care.advance(addQuestion);
			expect(replay.kind === "ok" && replay.replayed).toBe(true);
			expect(saved(replay)).toEqual(current);
			const conflict = await care.advance({ ...addQuestion, commandId: commandIdSchema.parse(randomUUID()) });
			expect(conflict.kind).toBe("conflict");
			const invalid = await care.advance({ ...addQuestion, expectedRevision: current.snapshot.revision, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "update_maternal_plan", update: { kind: "reopen_task", taskId: "not-a-task" } } });
			expect(invalid).toMatchObject({ kind: "error", code: "invalid_transition" });
			current = await act(care, current, { kind: "update_maternal_plan", update: { kind: "reopen_task", taskId: "arrange-follow-up" } });
			if (current.snapshot.specialtyPlan.kind !== "maternal-postpartum") throw new Error("Missing postpartum plan.");
			expect(current.snapshot.specialtyPlan.questions.filter((question) => question.source === "patient-entered")).toHaveLength(1);
			expect(current.snapshot.specialtyPlan.questions.filter((question) => question.source === "scripted-demo")).toHaveLength(1);
			expect(current.snapshot.specialtyPlan.tasks.find((task) => task.id === "arrange-follow-up")?.status.kind).toBe("open");
			expect(current.snapshot.specialtyPlan.timeline).toEqual(timeline);
			expect(current.snapshot.state).toEqual(completed);
			expect(saved(await care.resume({ credential: current.credential }))).toEqual(current);
		});

		test("only active postpartum records accept utility writes, including the same 24-hour expiry", async () => {
			const { care, advanceTime } = await harness(kind);
			const ordinary = saved(await care.start({ scenarioId: "rural-adult" }));
			const command: VisitCommand = { kind: "update_maternal_plan", update: { kind: "add_question", text: "A sample question." } };
			const submit = (current: VisitEnvelope) => care.advance({ credential: current.credential, commandId: commandIdSchema.parse(randomUUID()), expectedRevision: current.snapshot.revision, command });
			expect(await submit(ordinary)).toMatchObject({ kind: "error", code: "invalid_transition" });
			let cancelled = saved(await care.start({ scenarioId: "postpartum" }));
			cancelled = await act(care, cancelled, { kind: "cancel_visit" });
			expect(await submit(cancelled)).toMatchObject({ kind: "error", code: "invalid_transition" });
			const expiring = saved(await care.start({ scenarioId: "postpartum" }));
			advanceTime(24 * 60 * 60 * 1000);
			expect(await submit(expiring)).toMatchObject({ kind: "error", code: "expired" });
		});
	});
}

test("sample office-hour slots stay within retention across nighttime and daylight saving changes", async () => {
	const officeHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });
	for (const instant of ["2030-09-09T22:00:00.000Z", "2030-09-10T08:45:00.000Z", "2030-03-10T06:30:00.000Z", "2030-11-03T05:30:00.000Z"]) {
		const now = new Date(instant);
		const store = createMemoryStore();
		try {
			const care = createCareService({ store, now: () => now });
			const current = saved(await care.start({ scenarioId: "postpartum" }));
			for (const slot of current.snapshot.appointmentOptions) {
				expect(Number(officeHour.format(new Date(slot.startsAt)))).toBeGreaterThanOrEqual(9);
				expect(Number(officeHour.format(new Date(slot.startsAt)))).toBeLessThan(17);
				expect(Date.parse(slot.startsAt)).toBeGreaterThan(now.getTime());
				expect(Date.parse(slot.startsAt) + slot.durationMinutes * 60_000).toBeLessThan(Date.parse(current.expiresAt));
			}
		} finally { store.close(); }
	}
});

test("SQLite resumes after a process-equivalent reopen and never stores the plaintext resume credential", async () => {
	const directory = await mkdtemp(join(tmpdir(), "virtual-care-restart-"));
	const path = join(directory, "visits.sqlite");
	let store: VisitStore = await createSqliteStore(path);
	cleanup.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
	let care = createCareService({ store });
	let current = await prepared(care, "postpartum");
	current = await act(care, current, { kind: "select_payment", choice: { kind: "assistance" } });
	current = await act(care, current, { kind: "update_maternal_plan", update: { kind: "add_question", text: "A question to keep after reopening the sample record." } });
	store.close();
	store = await createSqliteStore(path);
	care = createCareService({ store });
	expect(saved(await care.resume({ credential: current.credential }))).toEqual(current);
	expect((await readFile(path)).includes(Buffer.from(current.credential))).toBe(false);
});
