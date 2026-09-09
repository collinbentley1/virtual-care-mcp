# Architecture decision

Use a durable visit aggregate with direct MCP Apps messaging. The independent comparison scored candidate B 20/25 and candidate A 18/25. B preserves one current visit across hosts and devices. A contributes the narrow `start`, `resume`, and `advance` interface, explicit state variants, and a separate UI render tool.

## Public use

The server creates a fictional visit draft and returns a random resume credential. The assistant or UI uses that credential to read the latest visit and submit typed commands. The standard MCP render tool opens the same UI in supported hosts. A standalone browser uses the same service through JSON endpoints.

`src/contracts.ts` is the shared schema and client contract. `src/visit.ts` owns transitions, allowed actions, expiry, and operation receipts. `src/persistence.ts` owns SQLite transactions locally and Firestore compare-and-swap in Cloud Run. `src/mcp.ts` and `src/server.ts` adapt that service to MCP and HTTP. `src/ui/` owns presentation and transient device state. `src/billing.ts` owns external mock x402 and FHIR representations. `src/media.ts` owns optional LiveKit access.

The resume credential is a capability for one fictional visit, not a patient login. It is available to model tools for text-only recovery and can be pasted into another host. The store retains only a cryptographic hash. Media join tokens remain separate and app-only. The public demo has no real patient identity, payer connection, or clinician service.

## State and retry decisions

The visit progresses through appointment, intake, coverage, optional simulated payment, consent, ready, consulting, and complete. Cancellation preserves the prior state. Changing an appointment or intake invalidates dependent coverage and consent. Closed visits retain their record until their original 24-hour expiry.

Creation allocates a new draft and is explicitly non-idempotent. A lost creation response may leave an unused draft that expires. Appointments are fictional choices scoped to that draft; there is no global clinician-slot reservation or session-wide booking claim. Commands on an existing visit use a random command ID and expected revision. Identical replay returns the latest snapshot with `replayed: true`, so an old retry cannot regress the UI. Reusing a command ID with different input fails. Concurrent new edits yield one commit and one conflict with the current snapshot.

The record and bounded operation receipts are one transaction. Firestore uses the exact observed update time as a write precondition, retries conflicts within a finite limit, and checks application expiry on every request. SQLite implements the same transaction contract. Preview uses memory with a separate identity and no production data access.

## Media and billing

The consultation is saved independently from its media connection. A disconnected camera or browser does not finish the visit or erase intake. The default consultation is a scripted rehearsal. An optional LiveKit adapter supports real media between testers, without claiming clinician participation. Host permission denial offers a browser continuation and a text rehearsal. Room credentials are short-lived and excluded from transcripts and saved visit data.

Insurance uses explicit FHIR R4 simulation records, including separate eligibility and claim adjudication. Self-pay rehearses x402 v2's native MCP binding through a dedicated simulated-payment tool. The app never asks for a wallet signature or submits a claim. After-visit notes are scripted and identify that no clinician reviewed them.

## Alternatives rejected

Signed snapshots cannot guarantee one latest visit, global command deduplication, or revocation across hosts. A browser-only store loses the text workflow. Event sourcing and a general session authorization system add complexity that this fictional visit does not need. Cloudflare Durable Objects do not match the chosen platform. No provider backend is introduced.

## Verification

The independent review is [architecture-review.md](architecture-review.md). Implementation must prove retry and conflict behavior, persistence after restart, expiry, rejected transitions, and a complete built UI journey. Deployed MCP and actual ChatGPT and Claude tests remain separate evidence. See [the verification plan](../verification-plan.md).
