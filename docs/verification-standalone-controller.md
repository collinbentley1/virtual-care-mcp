# Standalone browser verification

Observed September 9, 2026 in Chrome against the built local server, using SQLite and fictional information only. These checks ran independently of the UI author's browser review. They do not establish public deployment or ChatGPT/Claude rendering.

The preceding `verify:ci` run used stable Bun 1.4.0 (`34cbb9a40`) and passed formatting, lint, types, 66 tests with 411 assertions, and the production build. UI copy was refined after that build; final source and deployment checks are recorded separately.

| Check | Observed result |
| --- | --- |
| Complete visit | Rural sample, West Virginia, fictional intake, text practice, financial assistance, consent, scripted message, and aftercare completed at revision 7. |
| Interrupted save | The controller stopped its own local server before saving an appointment. The page retained the answers, showed `Save not confirmed`, and offered the same-request retry. |
| Service restart | Restarting the server against the same SQLite database and retrying that request saved the appointment and opened intake. |
| Conversation continuity | A reload retained the submitted fictional message before completion. |
| Visit export | Chrome saved a 5,823-byte JSON record at 15:34:28 UTC. It parsed as a synthetic completed visit and retained the nonclinical notice. |
| FHIR export | Chrome saved an 18,285-byte JSON collection Bundle at 15:34:28 UTC. It contained eight resources for the same visit. Neither export contained a resume credential. |
| Browser handoff | Opening the visible resume code in a new tab restored the completed visit. The UI removed the fragment from the address bar. |

The assistance Bundle contained Patient, Organization, Appointment, QuestionnaireResponse, Consent, Encounter, and two DocumentReference resources. Insurance fixtures and their separate financial resources are covered by the billing verification record.

The initial in-app browser review did not receive a download event. The downloaded file and later browser diagnostics established that at least one of those downloads had completed; absence of that automation event was not proof of a failed export.

The source now uses standard `ui/download-file` when embedded and respects both download and open-link `isError` responses. Standalone file delivery was observed above; the host harness separately verifies the embedded request and denial behavior.
