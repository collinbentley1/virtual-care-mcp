# Independent domain and persistence review

Reviewed September 9, 2026. Scope was `src/contracts.ts`, `src/visit.ts`, `src/persistence.ts`, `test/visit.test.ts`, and `test/persistence.test.ts`. The initial review made no code edits. The follow-up added two regression tests in `test/persistence.test.ts`; the controller corrected application code and added appointment-expiry coverage. Finding locations below refer to the original source.

The targeted suite passed under Bun `1.4.0+34cbb9a40`: **26 tests, 0 failures, 118 assertions**. Additional local probes used a temporary database, which was removed afterward. No network request or cloud verification ran.

## Correction status

**All three findings are corrected in the inspected local source.** The follow-up targeted run passed **30 tests, 0 failures, 144 assertions** under the same Bun runtime. The repository format check also passed.

- SQLite now invokes `transaction.immediate` before reading. The new regression starts two actual Bun child processes. The first pauses after its transaction reads the visit. The second uses a zero-timeout write-lock probe, which confirms that the first already holds the write reservation. Explicit stdin/stdout signals then release the first writer and submit the second editor's stale command. The results are one save and one conflict, both at revision 1. No synchronization sleep is used.
- Slot 3 is now eight hours after the first slot. The controller's memory and SQLite tests assert that all offered appointments end before expiry.
- The database is changed to mode `0600` before WAL initialization, and existing sidecars are tightened on reopen. The new test uses an existing `0755` directory and verifies all three files both on creation and after reopening deliberately loosened `0644` files.

The whole-project typecheck at this checkpoint reported only `test/host/main.ts:52`, where a local `document` declaration shadows the browser global before its declaration. There were no errors in the reviewed domain files or new persistence tests. That concurrent integration issue is outside this review's file ownership.

## Must fix

### 1. SQLite returns an availability error for a recoverable concurrent edit

Status: corrected and verified by the separate-process regression.

Location: [`src/persistence.ts:60`](../src/persistence.ts#L60), transaction invocation at line 76. Priority P2.

The default SQLite transaction begins deferred. Another process can commit after the first transaction reads its snapshot but before it upgrades to a writer. Its subsequent `UPDATE` fails with the stale snapshot, and the catch converts that into `StoreUnavailable`. The application returns `temporarily_unavailable` instead of the promised `conflict` with the latest visit. The existing SQLite concurrency test uses two synchronous callbacks in one process, so it does not exercise this interleaving.

Reproduction used two actual Bun processes sharing one SQLite file:

1. Start one visit at revision 0.
2. Let the first store transaction execute its `SELECT` and pause in the supplied synchronous update callback.
3. In a second process, call the real care service with another command at expected revision 0. That command commits successfully.
4. Resume the first callback and attempt its update at revision 0.

Observed output was `child: {kind:"ok"}` and `parent: {kind:"error",code:"temporarily_unavailable"}`. Use an immediate write transaction before the initial read, or another bounded transaction strategy that rereads after this conflict. Add separate-process contention coverage; the resulting loser must receive the latest revision in a conflict response.

### 2. The third appointment always occurs after the visit expires

Status: corrected and verified for both memory and SQLite visits.

Location: [`src/visit.ts:173`](../src/visit.ts#L173), slot construction at line 177 and expiry at line 186. Priority P2.

`firstSlot` is at least one hour after creation. Slot 3 adds another 24 hours, while the credential expires 24 hours after creation. The app therefore offers an appointment whose saved visit is already inaccessible when that appointment starts.

A normal `start` call produced slot 3 at `2026-09-10T16:30:00.000Z` and visit expiry at `2026-09-10T15:03:42.817Z`. No manipulated clock or database was needed. Keep every offered time within the explicit retention period with room for aftercare, or change and display the retention contract. Verify that each appointment's end precedes expiry.

## Optional local hardening

### 3. SQLite's sidecars do not inherit the final private database permissions

Status: corrected and verified for new and existing sidecars.

Location: [`src/persistence.ts:50`](../src/persistence.ts#L50), WAL initialization at line 52 and database chmod at line 55. Priority P2 when the configured database directory is already traversable by other local users.

WAL and shared-memory files are created before the database is changed to mode `0600`. Creating a database inside an existing `0755` directory produced `database=0600`, `database-wal=0644`, and `database-shm=0644`. The WAL contains the serialized visit text. The default newly created directory is `0700`, which protects that path; an existing parent is not tightened by recursive `mkdir`.

Create the database privately before enabling WAL and verify existing sidecar permissions when reopening. Test inside an existing traversable directory while the connection remains open. This concerns local saved text; no plaintext resume capability was found in the stored records, and production Firestore is unaffected by this local filesystem issue.

## Verified behavior and limits

Credential hashes have fixed validated length before timing-safe comparison. Authorization precedes expiry, revision checks, and receipt replay. Credentials for another visit do not open the selected record. Care errors use fixed messages without echoing credentials or submitted text.

Completed visits retain intake, billing, consent, consultation, and aftercare. Cancellation wraps the complete prior open state. Terminal states reject further transitions. Receipts remain in the aggregate instead of being evicted; bounded update limits preserve replay protection. Replaying a successful payment returns the current snapshot and its original payment history after quote expiry or a later billing choice.

The Firestore transport fixture verifies an absence precondition on creation, exact `updateTime` on writes, state and receipt in one commit, recovery after a lost mutation response, and conflicts between service instances. These are local contract tests, not proof against live Firestore. Creation is explicitly non-idempotent in the accepted architecture, so an orphaned draft after a lost creation response is an accepted limitation, not an additional finding.

Inspected source SHA-256 values:

```text
9728a117df92f52c5038dc62e36021e5e38d50a023feff1efb42667b7fa7e0e5  src/contracts.ts
7be4c70190099151b84fe58c793be78eadfeb2a4aecb784562b997adf84da2e5  src/visit.ts
4046e7faf6210988af45bf907445a97b4dab4791cbc5fa6324d6220904a078df  src/persistence.ts
6c677dc105ab6bde5aa9e48392dc8f6438a445e31075bb698c3f2a8a31a613a6  test/visit.test.ts
86a950dc16287fc4324d927ce2c2a4aaa6cc034e0df73883023f71d6e4dbd2d0  test/persistence.test.ts
```

Correction verification SHA-256 values, with `src/contracts.ts` unchanged:

```text
bdd311ddbcecc574ac241390e1d7d1fa31ac9170e1e49c5a253dd34beee1d956  src/visit.ts
09eb4bdc28dc800fc81a40188398d9b2d078c5f2e8371b1a48e87fada99f3152  src/persistence.ts
873dbdb10a591c48d965a5ed46e1d28bcf4cf8b7e447f06947430f8b1d8d7236  test/visit.test.ts
a88738c7f35601d516f0acdcef69ac315d02e3e0857997ed478e128e119081ba  test/persistence.test.ts
```
