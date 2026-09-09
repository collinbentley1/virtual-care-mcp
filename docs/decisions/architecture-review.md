# Independent architecture review

Reviewed September 9, 2026 against [the rubric](rubric.md), [experience direction](experience.md), and [platform constraints](../research/platform.md). Scores assess proposed contracts; neither candidate establishes host execution or deployment.

Choose **B's durable visit aggregate**, with **A's narrow start/resume/advance interface, separate render tool, and explicit text projection**. Cross-device continuity requires one authoritative visit. A's signed branches cannot satisfy that requirement, even when each branch validates correctly.

| Criterion | A | B | Assessment |
| --- | ---: | ---: | --- |
| Portability | 5 | 4 | A specifies bridge and text behavior. B leaves session establishment and text recovery unresolved. |
| Visit continuity | 2 | 5 | B defines canonical revisions, atomic receipts, conflicts, and expiry. A cannot retrieve the latest branch. |
| Inclusive access | 4 | 4 | Both support progressive controls, audio/text choices, and browser fallback. Neither proves accessibility or host media support. |
| Protocol correctness | 3 | 4 | B separates billing, consent, and media and defines stronger replay behavior. A leaves x402/FHIR behavior largely unspecified. |
| Maintainability | 4 | 3 | A has fewer operations. B adds session, handoff, media effects, and deployment alternatives beyond the immediate demonstration. |
| Total | **18/25** | **20/25** | B wins the required continuity contract; apply the corrections below before implementation. |

1. **Adopt the selected persistence contract.** B's SQLite volume and Cloudflare alternatives do not match the documented Cloud Run/Firestore deployment. Use one Firestore visit document with state and receipts committed under an `updateTime` precondition; use SQLite locally with the same behavioral tests. Preserve preview's lack of production data access. Keep the client revision unchanged across internal CAS retries so competing user edits produce a visible conflict.

2. **Make recovery concrete and small.** B assumes verified sessions while hiding its only resume credential from model output. It never explains how a fresh text-only ChatGPT or Claude conversation obtains access. For this synthetic scope, define one high-entropy, expiring, visit-scoped bearer capability and a deliberate copy/resume flow. A text workflow needs a model-usable capability unless actual host authentication is implemented. Store only its hash and keep it out of URLs and logs. Possession grants access to synthetic data; it does not identify a patient. Defer session exchange, operator roles, and single-use tickets unless a demonstrated use case requires them. A restricted caregiver invitation requires its own enforced scope; a presence checkbox grants no access.

3. **Resolve creation and receipt boundaries.** B promises a session-wide operation ledger and unique active booking per slot. Those guarantees exceed one-document-per-visit CAS. Remove shared fixture-slot reservation, or explicitly design the extra transaction. Specify how an initial create retries after its response is lost. Check authorization and expiry, then an identical operation receipt, then revision for new operations. Bound retained receipts without allowing an evicted payment command to execute again. Return a current projection alongside any historical receipt so replay cannot roll the UI backward.

4. **Preserve the completed record.** B's `finished` and `cancelled` phase variants discard intake and acknowledged consent, although its export promises an understandable visit record. Keep the accepted preparation snapshot and consent version/time in terminal records. Keep eligibility, claim outcome, and simulated payment separate, including in FHIR projections.

5. **Keep media independent.** Permission, connection, and reconnection do not advance or finish the visit. A scripted default needs no room-effects runner. Add that machinery only with an actual media adapter, then verify finish/token races and retired generations. Preserve access choices, caregiver presentation, and the current visit when media fails. Finishing still produces clearly sourced fictional aftercare.

Acceptance should demonstrate a full text journey and a built UI journey, retry after a lost creation/mutation response, two clients editing one revision, resume after server restart, expiry on reads and writes, retained aftercare/consent, mock payment replay, and denied-media completion. Verify ChatGPT and Claude separately. Resolve the exact SDK version against the platform's release-age policy before treating the rubric's MCP Apps 2.0 requirement as met.
