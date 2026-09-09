# Candidate B: a durable visit aggregate

Status: architecture proposal for comparison, September 9, 2026. All paths and interfaces below are proposed. No implementation or deployment is implied.

## Problem

A patient may book in one chat, finish previsit steps in another view, and reconnect after losing internet. The application must retain the same synthetic visit through those changes. It also needs to separate an appointment, a media connection, a mock insurance decision, and a mock payment. A durable visit aggregate puts the rules for those records behind one application interface. It does not introduce a provider backend.

The grounding evidence is in [care and billing research](../research/care-and-billing.md). The MCP adapter follows the controller's current MCP and MCP Apps version selection. This candidate requires direct MCP Apps, a text fallback, and no ChatGPT Apps SDK or `window.openai` dependency.

## Usage (caller's view)

The README experience is: start the app, select a fictional patient, book a demo visit, resume it after refresh, and optionally join a local LiveKit room. Without LiveKit configuration, the same visit supports an explicitly scripted rehearsal. The app owns durable state; the chat and embedded view render its current projection.

These are the three dominant call sites. Transport adapters authenticate the session and parse external values before calling them.

```ts
// The appointment tool creates one visit for this operation, even after a retry.
const result = await visits.book(actor, {
	operationId,
	slotId: selectedSlot.id,
	patientFixture: "sample-adult",
	visitLocation: "NY",
	timeZone: "America/New_York",
});
// result contains the saved visit ID, revision, and next available actions.

// A previsit screen sends one domain action and receives the complete new view.
const updated = await visits.act(actor, visit.id, {
	operationId: saveOperationId,
	expectedRevision: visit.revision,
	command: {
		kind: "save-previsit",
		answers: {
			reason: "sample-follow-up",
			access: "audio-preferred",
			language: "en",
			caregiverRequested: false,
		},
	},
});

// A resumed view reads durable state, then requests ephemeral media access.
const resumed = await visits.read(actor, visit.id);
if (resumed.kind === "found") {
	renderVisit(resumed.view);
	if (resumed.view.visit.phase.kind === "in-demo") {
		const access = await visits.openMedia(actor, visit.id, { mode: "audio" });
		// Only the browser receives access. The model receives the visit projection.
		renderMedia(access);
	}
}
```

`book`, `read`, `act`, and `openMedia` are the whole application interface. An action returns the saved state and permitted next actions. Callers do not load a record, calculate billing, save it, and publish events themselves. This keeps policy inside the module per interface-depth and boundary-discipline.

## Shape

### The visit is durable; presence is temporary

An aggregate is one versioned record that owns a visit's state transitions. Store a snapshot, operation receipts, and pending media effects in one database transaction. The proposed first runtime uses SQLite on a persistent volume, with migrations and a TTL cleanup task. An in-memory adapter is limited to tests. If the controller selects a Cloudflare runtime, the same unit can live in a Durable Object with SQLite storage; that is a deployment alternative, not a second persistence system to build now.

Each demo session owns its records. A verified session identity determines access. A visit ID is an identifier, not authorization. The server stores only a hash of an opaque resume credential, scoped to that demo session and its expiry. The credential never becomes part of the aggregate, model-facing output, or logs. A user-authorized transfer exchanges it for a host or browser session. A separate short-lived, single-use handoff ticket can create a restricted browser session or an invited caregiver session. These access grants belong to the HTTP and MCP boundary. No generic tool accepts an arbitrary patient identity or grants itself the demo operator role.

The aggregate keeps one appointment and one previsit snapshot. Billing is a separate state within that aggregate, because an insurance result and a media event must not overwrite each other. Individual devices own their transient microphone, camera, and connection observations. The view combines those observations with the durable visit only when rendering, per separate-before-serializing-shared-state.

```ts
// Opaque IDs and instants are constructed by boundary parsers.
type VisitId = string & { readonly visitId: unique symbol };
type OperationId = string & { readonly operationId: unique symbol };
type Instant = string & { readonly instant: unique symbol };
type Revision = number;
type Money = Readonly<{ currency: "USD"; minorUnits: number }>;

type PrevisitAnswers = Readonly<{
	reason: "sample-follow-up" | "sample-first-visit";
	access: "audio-preferred" | "video-preferred" | "text-practice";
	language: "en" | "es";
	caregiverRequested: boolean;
}>;

type DemoConsent = Readonly<{
	documentVersion: "demo-consent-v1";
	acknowledgedAt: Instant;
}>;

type VisitPhase =
	| { kind: "booked" }
	| { kind: "preparing"; previsit: PrevisitAnswers }
	| { kind: "ready"; previsit: PrevisitAnswers; consent: DemoConsent }
	| { kind: "in-demo"; previsit: PrevisitAnswers; consent: DemoConsent; generation: number }
	| { kind: "finished"; summaryFixture: "administrative-summary-v1"; endedAt: Instant }
	| { kind: "cancelled"; cancelledAt: Instant };

type InsuranceScenario =
	| "active-copay"
	| "inactive"
	| "unknown-member"
	| "benefits-unavailable"
	| "prior-authorization-required"
	| "claim-denied";

type Billing =
	| { kind: "unselected" }
	| { kind: "insurance-demo"; scenario: InsuranceScenario; outcomeId: string }
	| { kind: "assistance-demo"; fixtureId: string }
	| { kind: "self-pay-demo"; quoteId: string; amount: Money; payment: DemoPayment };

type DemoPayment =
	| { kind: "quoted" }
	| { kind: "simulated"; receiptId: string; settledAt: Instant }
	| { kind: "failed"; reason: "expired-quote" | "fixture-decline" };

type Visit = Readonly<{
	id: VisitId;
	demoSessionId: string;
	revision: Revision;
	synthetic: true;
	appointment: { slotId: string; startsAt: Instant; timeZone: string; visitLocation: "NY" | "TX" };
	patientFixture: "sample-adult";
	phase: VisitPhase;
	billing: Billing;
	expiresAt: Instant;
}>;

type VisitCommand =
	| { kind: "save-previsit"; answers: PrevisitAnswers }
	| { kind: "choose-insurance"; scenario: InsuranceScenario }
	| { kind: "choose-self-pay" }
	| { kind: "choose-assistance" }
	| { kind: "simulate-payment"; quoteId: string }
	| { kind: "acknowledge-demo-consent"; documentVersion: "demo-consent-v1" }
	| { kind: "start-demo" }
	| { kind: "finish-demo" }
	| { kind: "cancel" };

type VisitView = Readonly<{
	visit: Omit<Visit, "demoSessionId">;
	actions: readonly VisitCommand["kind"][];
	simulationLabel: string;
}>;

type ActionResult =
	| { kind: "saved"; view: VisitView; replayed: boolean }
	| { kind: "conflict"; current: VisitView }
	| { kind: "rejected"; reason: "invalid-transition" | "operation-reused" | "quote-expired" }
	| { kind: "unavailable"; reason: "not-found-or-forbidden" | "expired" };

type ReadResult =
	| { kind: "found"; view: VisitView }
	| { kind: "unavailable"; reason: "not-found-or-forbidden" | "expired" };

// Actor is created from verified session credentials, never tool arguments.
type Actor = Readonly<{ demoSessionId: string; role: "participant" | "caregiver" | "demo-operator" }>;
type BookInput = Readonly<{
	operationId: OperationId;
	slotId: string;
	patientFixture: "sample-adult";
	visitLocation: "NY" | "TX";
	timeZone: string;
}>;

type MediaAccess =
	| { kind: "livekit"; serverUrl: string; token: string; generation: number; expiresAt: Instant }
	| { kind: "practice-only"; reason: "unconfigured" | "unreachable" }
	| { kind: "unavailable"; reason: "not-ready" | "not-found-or-forbidden" | "expired" };

interface Visits {
	book(actor: Actor, input: BookInput): Promise<ActionResult>;
	read(actor: Actor, id: VisitId): Promise<ReadResult>;
	act(actor: Actor, id: VisitId, request: {
		operationId: OperationId;
		expectedRevision: Revision;
		command: VisitCommand;
	}): Promise<ActionResult>;
	openMedia(actor: Actor, id: VisitId, options: { mode: "audio" | "video" }): Promise<MediaAccess>;
}
```

The sketch exposes domain values. MCP JSON-RPC objects, HTTP headers, FHIR resources, LiveKit SDK objects, and storage rows stay inside their owning adapters. `MediaAccess` is the narrow exception for browser connection data; it never enters the model-facing projection or an operation receipt.

### Transitions and retry behavior

`save-previsit` changes `booked` to `preparing`. Acknowledging the versioned demo consent requires saved answers and a selected mock billing path, then changes the phase to `ready`. The server records the acknowledgment time. Editing answers after acknowledgment returns the visit to `preparing` for review. `start-demo` requires `ready` and allocates its media generation. A connection loss leaves the visit in `in-demo`. `finish-demo` accepts an active simulation, writes the fixed summary reference, and closes the generation. Cancellation accepts an unfinished visit. There is no direct command for a client to replace the whole aggregate.

The consent is an acknowledgment of the synthetic demonstration and its media behavior, not clinical informed consent. Device permission remains a separate browser decision. Appointment location is a selected fictional US state, used with the fixture schedule and shown at review; the app does not infer real patient location or licensure eligibility.

Billing fixtures are pure local calculations. Insurance outcome records preserve separate eligibility and claim phases. Finishing a demo can create a mock Claim and ClaimResponse, then an EOB projection. It does not retroactively turn an earlier eligibility response into payment approval. Expired quotes cannot be paid, and selecting a new billing path invalidates its prior quote. Changing billing after consent returns the visit to `preparing`. Intake and billing edits are rejected after the simulation starts. The billing adapter checks the mock x402 envelope before issuing `simulate-payment`; no generic public tool bypasses that check.

After checking the actor's current permissions, the transaction looks up `(demoSessionId, operationId)`. Its request fingerprint includes the target visit, command, and parsed inputs. An identical request returns the original saved receipt. A different request with that key returns `operation-reused`. Only a new operation checks the expected visit revision. Therefore a lost response can be retried after another update without repeating its effect. A stale edit receives the current projection for review; the server does not silently discard concurrent changes. Caregiver grants allow reading and media participation for one invited visit, not booking, billing changes, or completion.

The booking receipt points to its visit and is stored in the same transaction as creation. Fixture slots are scoped to a demo session, so unrelated public demo users cannot exhaust one shared clinician calendar. Within a session, a slot can have at most one active booking.

An external media call cannot share a database transaction. The visit transaction writes an effect with a stable ID, room name, and generation. A retryable runner creates or closes that exact room. Before issuing a token, it rechecks that the visit and generation are still active. A close racing with token issuance can leave a short-lived token for the retired generation; the app must not describe this as immediate self-hosted revocation. Closing the app's visit blocks every new grant even when media cleanup fails. [LiveKit token limits](https://docs.livekit.io/frontends/reference/tokens-grants/).

### Module ownership

The proposed production call chain is transport adapter, visit module, persistence or media adapter. It has no controller/service/repository wrappers that forward the same arguments.

| Proposed path | Knowledge owned |
| --- | --- |
| `src/visit.ts` | Public interface, transition function, simulation fixtures, permitted actions, receipts, and transaction coordination. |
| `src/persistence.ts` | Snapshot schema, atomic commits, unique constraints, effect records, migrations, and expiry. |
| `src/media.ts` | LiveKit grants, room generations, webhook validation, media effects, and private token delivery. |
| `src/billing.ts` | x402 v2 encoding and mock verification, FHIR export validation, and the distinction between eligibility, claim, and payment. |
| `src/mcp.ts` | Tool discovery, boundary schemas, direct MCP Apps resource metadata, and text projections. |
| `src/http.ts` | MCP transport, browser sessions, one-time tickets, origin checks, static assets, and private media endpoints. |
| `src/ui/` | One accessible journey, local device state, host capability detection, browser fallback, and status announcements. |

`billing.ts` owns external representations while `visit.ts` owns when a billing result changes a visit. The module is warranted because it hides protocol encoding and validation. It must not become a second workflow engine. Thin per-stage files such as `load-visit`, `validate-visit`, and `save-visit` are rejected per the shallow-module and temporal-decomposition review.

### The UI resumes one journey

The visible steps are Choose a time, Prepare, Practice the visit, and Review. Selection includes the fictional visit location and named time zone. Prepare includes intake, access preferences, caregiver choice, coverage or cost, and a separate consent review. Every page has the fictional-data banner and a short next action. The VisitView determines which actions are available, and the server still checks the action when it arrives.

Use a light cool-blue background, deep ocean-blue text, and teal actions with measured contrast. A system sans-serif at 18 pixels avoids external font downloads. Large progressive controls replace a dense dashboard. Register one initial rendering tool; subsequent data tools update the existing app view so an intake save does not remount the media panel.

The media panel offers device preview, an audio-only option, and a browser handoff when embedded permissions are unavailable. A denied browser handoff leaves the scripted rehearsal usable. Caregiver invitations provide a scoped demo seat, not silent access to other visits. A disconnected panel says the visit is saved and offers reconnect without marking the visit finished.

The after-visit screen shows the fixed sample summary, separate insurance and payment receipts, and a printable synthetic record with a validated FHIR export. Each artifact identifies the fixture version, source visit, and lack of clinician review. It contains no generated diagnosis, prescription, or clinician signature. A configured LiveKit room changes the media experience only; it never changes those clinical simulation labels.

## Synthesis decision

Pending controller comparison. Recommend this candidate as the base when refresh, concurrent access, and resumable handoff are acceptance requirements. Preserve candidate A's direct standards adapter and small deployable footprint where compatible.

## Tradeoffs accepted

- We accept durable storage and migrations in exchange for visit continuity and reliable operation receipts.
- We accept a single deployment-specific persistence adapter in exchange for atomic visit updates. Building SQLite and Durable Objects together would add work without proving the journey.
- We accept explicit conflicts in exchange for preserving a second device's edits.
- We accept separate transient device state in exchange for avoiding database writes for every connection or microphone event.
- We accept a scripted default call experience in exchange for a demo that runs without media credentials. Actual two-party media is a separate verification requirement.

## Alternatives considered

A signed state token carried by every client removes the database, but exposes state freshness, competing histories, invalidation, and duplicate effects to callers. It is suitable for a resettable single-view sample; it is a weaker fit for a visit that resumes across devices. Reconstructing a visit from an append-only event log hides audit history well but adds event schema evolution and replay to a small synthetic application. A snapshot plus a bounded operation ledger gives the required continuity with fewer moving parts.

## Open questions and risks

Which persistence runtime matches the controller's platform deployment? Which host permits embedded microphone and camera use after actual testing? Do the configured media deployment and test clients support a verified two-party connection? The proposed default retention is 24 hours, with an explicit Start over action that deletes the session's saved fixtures. The controller can select that default without blocking on user input.

## Next implementation step

Implement `Visits` with a transactional snapshot and operation ledger, then prove booking retry, refresh recovery, conflicting edits, rejected transitions, and payment replay before attaching the UI.
