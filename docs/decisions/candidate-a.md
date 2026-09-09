# Candidate A: signed synthetic visit continuations

Status: architecture proposal, 2026-09-09. This candidate favors a stateless application service for the current simulation. The controller selects and synthesizes the final architecture. No implementation or cloud mutation is part of this document.

## Problem

One portable MCP App must demonstrate a US virtual visit through intake, appointment selection, coverage, consent, consultation, and follow-up. Every clinical and financial outcome is simulated. ChatGPT and Claude can render the standard MCP Apps bridge, but neither source research nor the SDK guarantees persistent iframe state or working media permissions. Candidate A keeps the server responsible for every transition while carrying the validated synthetic visit between requests in an expiring signed continuation. This avoids a visit database at the cost of shared-history and revocation guarantees. See the [protocol research](../research/mcp-apps.md) and [comparison rubric](rubric.md).

## Usage, caller's view

The UI needs three operations. It displays returned snapshots and does not calculate its own next visit stage.

```ts
import type { CareClient } from "../../domain/visit.js";

declare const care: CareClient;

const started = await care.start({
  scenarioId: "rural-adult",
  access: { language: "en", mode: "audio", captions: true, caregiver: "none" },
});

if (started.kind === "ok") {
  renderVisit(started.envelope.snapshot);
}
```

An intake submission sends one command. The adapter stores the returned continuation only after a successful response. It retains the request ID across a retry.

```ts
const updated = await care.advance({
  continuation: current.continuation,
  command: {
    kind: "submit_intake",
    commandId: newCommandId(),
    intake: { concern: "seasonal-symptoms", location: "NY", assistance: "none" },
  },
});

if (updated.kind === "ok") {
  current = updated.envelope;
  renderVisit(current.snapshot);
} else {
  showRecovery(updated.error);
}
```

A host's text tool or a top-level browser continuation uses the same service. Possession of a continuation permits only that synthetic branch, until expiry.

```ts
const restored = await care.resume({ continuation: suppliedContinuation });
if (restored.kind === "ok") {
  renderVisit(restored.envelope.snapshot);
} else {
  showRecovery(restored.error);
}
```

`renderVisit`, command-ID creation, and recovery presentation above are caller code. The service interface hides token validation, scenario lookup, transition rules, and simulated quote calculation. It does not expose cryptography, MCP envelopes, HTTP types, or storage APIs to the component.

## Shape

The following is a type sketch. Implementation must define runtime Zod 4 schemas first and infer exported domain types from them. Token strings, fixture IDs, and external results enter as `unknown` and become branded values only after boundary validation. The sketch uses semantic brands to make the intended distinctions explicit, per type-system-discipline.

```ts
type VisitId = string & { readonly __brand: "VisitId" };
type CommandId = string & { readonly __brand: "CommandId" };
type Continuation = string & { readonly __brand: "Continuation" };
type AppointmentId = string & { readonly __brand: "AppointmentId" };
type ScenarioId = "rural-adult" | "older-adult" | "uninsured-adult";
type AccessNeeds = {
  language: "en" | "es";
  mode: "video" | "audio" | "text";
  captions: boolean;
  caregiver: "none" | "present";
};
type Intake = {
  concern: "seasonal-symptoms" | "routine-follow-up";
  location: string; // Implement as the validated US state-code schema.
  assistance: "none" | "interpreter" | "caregiver";
};
type Appointment = {
  appointmentId: AppointmentId;
  clinicianDisplay: string;
  startsAt: string;
  durationMinutes: number;
};
type PaymentChoice =
  | { kind: "insurance_mock"; planId: string }
  | { kind: "self_pay_mock" }
  | { kind: "x402_mock" };
type MockCoverage = {
  kind: "simulation";
  choice: PaymentChoice;
  currency: "USD";
  patientCostMinor: number;
  explanation: string;
};
type Selection = { intake: Intake; appointment: Appointment };
type CoveredVisit = Selection & { coverage: MockCoverage };
type ConsentedVisit = CoveredVisit & { consentVersion: string };
type MockSummary = {
  kind: "simulation";
  clinicianNote: string;
  nextSteps: string[];
  receiptLabel: "Simulated receipt. No charge.";
};
type VisitState =
  | { kind: "intake" }
  | { kind: "options"; intake: Intake; appointments: Appointment[] }
  | { kind: "coverage"; selected: Selection }
  | { kind: "consent"; covered: CoveredVisit }
  | { kind: "ready"; visit: ConsentedVisit }
  | { kind: "consulting"; visit: ConsentedVisit; session: { kind: "simulation" } }
  | { kind: "complete"; visit: ConsentedVisit; summary: MockSummary };
type VisitSnapshot = {
  schemaVersion: 1;
  mode: "synthetic";
  visitId: VisitId;
  revision: number;
  scenarioId: ScenarioId;
  patientDisplay: string;
  access: AccessNeeds;
  state: VisitState;
};
type VisitEnvelope = {
  snapshot: VisitSnapshot;
  continuation: Continuation;
  expiresAt: string;
};
type VisitCommand = { commandId: CommandId } & (
  | { kind: "submit_intake"; intake: Intake }
  | { kind: "choose_visit"; appointmentId: AppointmentId }
  | { kind: "select_payment"; choice: PaymentChoice }
  | { kind: "accept_consent"; consentVersion: string }
  | { kind: "prepare_consultation" }
  | { kind: "finish_consultation" }
  | { kind: "set_access"; access: AccessNeeds }
);
type CareError =
  | { kind: "invalid_input"; message: string }
  | { kind: "invalid_continuation" }
  | { kind: "expired_continuation" }
  | { kind: "rejected_transition"; currentStage: VisitState["kind"]; message: string }
  | { kind: "command_id_reused" }
  | { kind: "temporarily_unavailable" };
type CareResult =
  | { kind: "ok"; envelope: VisitEnvelope }
  | { kind: "error"; error: CareError };
interface CareClient {
  start(input: { scenarioId: ScenarioId; access: AccessNeeds }): Promise<CareResult>;
  resume(input: { continuation: Continuation }): Promise<CareResult>;
  advance(input: { continuation: Continuation; command: VisitCommand }): Promise<CareResult>;
}
```

The `options` stage adds appointment selection to the early provisional contract. Runtime schemas must constrain dates, durations, minor currency units, state codes, payload size, and identifiers. Scenario fixtures own clinicians, slots, plans, prices, and consent versions. The selected SDK major follows the [dependency-policy recommendation](../research/mcp-apps.md#versions-and-evidence-quality).

| Module | Knowledge owned | Public contract |
| --- | --- | --- |
| `src/domain/visit.ts` | Schemas, scenarios, transitions, and synthetic calculations. | Inferred domain types; pure start/advance functions. |
| `src/server/care-service.ts` | Continuations, expiry, validation, and retry identity. | `start`, `resume`, `advance`. |
| `src/server/mcp.ts` | Tool/resource registration and wire formatting. | Server factory. |
| `src/ui/care-client.ts` | Standard bridge lifecycle and result parsing. | `CareClient` plus host capabilities. |
| `src/ui/visit-app.tsx` | Snapshot, draft input, focus, and accessible presentation. | UI entry. |
| `src/ui/consultation.ts` | Device access, connection states, and track cleanup. | Simulation adapter; future LiveKit adapter. |

A normal action crosses the adapter, service, and domain. Avoid extra repositories, generic command buses, or one service per stage. The service hides crypto and policy behind three operations, per boundary-discipline. Components never coordinate persistence steps or decide legal transitions.

The signed payload contains the synthetic aggregate, version, issuer, audience, absolute expiry, and bounded command receipts. Use a maintained JOSE implementation and a platform-managed key with an algorithm allowlist. Signatures provide integrity, not confidentiality. Include no actual patient information, room credentials, payment authorization, or host OAuth token.

`advance` verifies and parses, validates the stage and fixture references, computes the next aggregate, and signs it. Identical branch and command inputs produce the same aggregate and receipt. Repeating a recorded command returns unchanged state; a reused command ID with different input fails. Expiry does not extend with each mutation.

This provides branch-local idempotency. Two commands against an old continuation can create separate valid descendants. Revision numbers do not identify one globally latest state. The service cannot revoke a visit, invalidate old branches, merge concurrent devices, or prove global single execution. Real appointments, charges, claims, and prescriptions must not depend on this mechanism.

The iframe retains its newest envelope in memory. A top-level browser can receive a continuation in the URL fragment, clear it after reading, and submit it in a POST body. Host remount may restore an older result that predates UI actions. A supplied continuation restores that branch only. Browser storage does not establish cross-host continuity.

Expose `care_start`, `care_advance`, `care_resume`, and `care_render`. Data tools are model/app callable and return a readable summary plus the envelope in `structuredContent`. Only the render tool declares an immutable content-derived `ui://` resource URI. The synthetic continuation must be model-accessible for text fallback. Future media tokens belong only in app-visible result `_meta`; visibility still does not replace authorization.

Consultation connection state is separate from visit state. Model `idle | requesting_permission | connecting | connected | reconnecting | ended | failed` inside the adapter. Both consultation commands currently produce fixture-based simulation results. A device preview is not evidence that a clinician joined. Include audio-only, text, captions, large targets, keyboard focus recovery, and browser fallback. Caregiver presence grants no account authorization. [Host constraints](../research/mcp-apps.md#camera-microphone-csp-and-fallback).

## Synthesis decision

Pending controller comparison. Favor Candidate A for a finite synthetic demo. If one current visit shared across hosts/devices is required, choose the durable aggregate alternative while retaining these domain commands and the standard bridge.

## Tradeoffs accepted

- We accept branch-local history and expiry-based restart in exchange for no visit database.
- We accept a bounded aggregate in each continuation in exchange for deterministic replay.
- We accept possible stale remount recovery in exchange for no proprietary widget persistence.
- We accept a service redesign before real side effects in exchange for a small, honest simulation.

## Alternatives considered

| Alternative | Interface depth and cost | Decision |
| --- | --- | --- |
| Opaque random resume credential plus Firestore aggregate, SQLite locally | The same three operations can hide canonical revisions, transactional deduplication, recovery, expiry, and revocation. Adds storage deployment and database parity work. | Wins when cross-device/host continuity is required. |
| Browser-only state | Small implementation exposes state trust and reconstruction to every caller. Text tools lose reliable recovery. | Rejected. |
| Durable actor per visit | Hides serialized transitions and notifications, but adds actor routing and runtime lifecycle. | Consider for later live collaboration. |

In the durable alternative, store a hash of the random resume credential. Transactionally validate `expectedRevision` and command ID, commit aggregate and receipt together, and return the committed snapshot. SQLite must provide equivalent atomic behavior. Concurrent nonduplicate commands yield one commit and one conflict. `resume` returns the latest revision to either host. A visit ID alone never authorizes access; a resume credential proves possession, not patient identity.

## Rubric self-assessment

| Criterion | Score out of 5 | Reason |
| --- | --- | --- |
| Portability | 5 | Standard bridge and full text workflow. |
| Visit continuity | 2 | Branch recovery without canonical latest state or revocation. |
| Inclusive access | 4 | Audio/text and browser paths specified; actual tests remain. |
| Protocol correctness | 4 | Typed stages and bounded retries; real integrations absent. |
| Maintainability | 4 | Few operations; token evolution and future side effects need care. |

## Open questions and risks

- Is canonical cross-host recovery a first-release acceptance criterion? If yes, select durable state.
- What absolute demo retention period should the user see?
- Which tested host/device combinations require browser media fallback?
- Should x402 simulation display protocol states or also expose a separately testable mocked HTTP 402 exchange?

## Next implementation step

Implement schema-derived types and the pure transition function, verify a complete visit plus retries and rejected commands, then attach the selected persistence and UI adapters.
