# Care, media, and billing research

Research date: September 9, 2026. Sources below are primary specifications, maintainer documentation, and US government guidance. These findings describe contracts and design choices. They do not establish that this application has implemented or passed any integration.

The recommended path is a durable synthetic visit, LiveKit for an optional real media connection, x402 v2 message simulation, and synthetic insurance records modeled on the HL7® FHIR® standard. The public demo must work without a wallet, payer account, clinician account, or paid media service. A local LiveKit deployment provides a reproducible media test. A deterministic rehearsal provides the care journey when media is unavailable.

## LiveKit provides media, not a clinical visit

LiveKit models rooms, participants, and published tracks. Its room lifecycle does not define appointments, clinical consent, a provider's arrival, or a completed encounter. A room can close when the last participant leaves and its empty timeout expires. Therefore, the application owns visit completion separately from media connection state. [Room concepts](https://docs.livekit.io/intro/basics/rooms-participants-tracks/), [webhook events](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/).

The LiveKit server has an Apache 2.0 license and supports self-hosting. That permits an open deployment path, but the app's MIT license does not replace third-party licenses. The implementation must retain dependency notices. Self-hosting requires a reachable media service and its network configuration. An HTTP application deployment alone does not deploy a WebRTC media server. [Server license](https://github.com/livekit/livekit/blob/master/LICENSE), [self-hosting overview](https://docs.livekit.io/transport/self-hosting/).

LiveKit participant tokens are signed JWTs that identify the participant, room, and permissions. Token expiration does not end an established call. LiveKit refreshes connected clients' tokens for reconnects. Current documentation makes token revocation a Cloud-only feature: removing a participant on a self-hosted server does not invalidate the participant's existing token. [Access tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/).

The proposed app contract accounts for those limits:

- Each media attempt has a random room name and an incrementing generation within its visit. Names and participant metadata contain no health information.
- The server derives participant identity and role from an authorized demo session. A caller cannot obtain administrative grants by supplying a role string.
- Camera and microphone grants are narrow. The patient never receives room administration, recording, or unrestricted publication grants.
- Join tokens have a short lifetime and remain ephemeral. The app does not put tokens in chat content, URLs, durable visit records, or logs.
- Closing a visit stops new join grants, closes its room, and records the closed generation. A later attempt uses a different room. This limits reuse; it does not claim to revoke a self-hosted token. Previously issued tokens may still reach the old room while valid.
- Participant connection events update presence. Only an explicit application action completes the demo visit and releases its fixed after-visit document.

LiveKit webhook requests carry a signed JWT and a hash of the request body. The receiver needs the original body for verification. Delivery is retried but not guaranteed. The implementation should deduplicate by event ID and reconcile room presence when needed. A missing webhook must not leave the user unable to finish or resume a demo. [Webhook verification and delivery](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/).

## The embedded app needs a media fallback

MCP Apps defines camera and microphone permission requests and reports host-granted permissions. An app cannot assume its requested permissions were granted. The standard also defines `ui/open-link` for a browser handoff, which the host may deny. These mechanisms support a portable design but do not prove that either ChatGPT or Claude currently permits a call inside its embedded view. [MCP Apps specification, permissions and external links](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

The product should offer these distinct experiences:

| Experience | Visible label | What it proves |
| --- | --- | --- |
| Deterministic visit rehearsal | `Practice visit. No clinician is connected.` | Appointment, intake, handoff, and summary behavior with fixtures. |
| Local camera and microphone preview | `Your device preview. You have not joined a call.` | Local device permission and preview only. |
| Two authorized browser participants in LiveKit | `Live demo connection. Participants are testing the app, not providing care.` | Actual media transport when tested in both directions. |
| A host blocks embedded media | `Open the demo call in your browser` | A fallback path only after the external browser flow is tested. |
| Media is unconfigured or unreachable | `Live calling is unavailable. Continue the practice visit.` | Honest degraded behavior. |

The handoff uses a short-lived, single-use application ticket exchanged for a browser session. The ticket grants one visit and one demo role. It is separate from a LiveKit token, expires after use, and is removed from browser history after exchange. The external page obtains its media token from the server. A connection screen must not impersonate an available clinician.

## Low bandwidth and accessible interaction

HHS identifies device and internet availability as practical limits on telehealth and notes that a phone visit may be an option when video is unavailable. Whether audio is clinically appropriate depends on the actual visit. This demo cannot make that determination. Its audio-only mode is a technology demonstration, and it must not claim a telephone connection when it only uses browser audio over the internet. [HHS patient device guidance](https://telehealth.hhs.gov/patients/what-do-i-need-use-telehealth), [HHS rural internet guidance](https://telehealth.hhs.gov/providers/best-practice-guides/telehealth-for-rural-areas/access-to-internet-and-other-telehealth-resources).

LiveKit adaptive stream selects video quality using attached elements' size and visibility, and pauses delivery to hidden elements. The JavaScript SDK requires `Track.attach()` for that behavior. Disabling a received track also stops incoming media for that track. Use this support with modest video settings and an explicit audio-only control. Hiding a video element alone is not a complete implementation of an audio-only mode. [Track subscriptions and adaptive stream](https://docs.livekit.io/transport/media/subscribe/).

The following are proposed acceptance criteria, not achieved measurements:

- Load the appointment and previsit UI before downloading the media client. Use system fonts, text-first layouts, and no autoplay promotional media.
- Keep a saved draft after refresh. Distinguish `Saved` from `Waiting for connection`. Never claim an offline edit reached the server.
- Show one primary action per step, retain a visible Back action, and allow review before booking or simulated payment.
- Use at least 44 CSS pixels for primary controls as a product choice. WCAG 2.2 AA's target-size criterion specifies 24 by 24 CSS pixels with exceptions; 44 is not the AA minimum.
- Support keyboard operation, visible focus, 200% text resize, narrow-screen reflow, adequate contrast, labels, and announced status changes. Test the whole journey with a screen reader.
- Display the appointment's date, time, and named time zone. Offer caregiver participation as an explicit invitation to a separate demo role.
- Test an audio-only session, camera refusal, microphone refusal, a dropped network, and a reconnect. Use throttled test profiles such as 256 kbit/s throughput and 300 ms latency as engineering probes, not guaranteed minimum bandwidth claims.

The accessibility baseline is [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Authentication must also avoid unnecessary memory and transcription tasks; allow paste and password-manager assistance when authentication is present. [Accessible authentication guidance](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html).

Caption availability needs a precise label. W3C's explanation of SC 1.2.4 distinguishes broadcasts from two-way calls; it does not require every web call to be captioned regardless of users' needs. For this audience, caption support remains a product requirement to evaluate. A fixture transcript must say `Scripted demo transcript`. It must never appear as a transcription of the user's live speech. If live captions are absent, say so and retain a usable text practice journey. [W3C live-caption guidance](https://www.w3.org/WAI/WCAG22/Understanding/captions-live.html).

## x402 v2 can be rehearsed without moving money

The x402 v2 core separates payment data, schemes, and transports. `PaymentRequired` contains `x402Version: 2`, a resource, and accepted requirements. Requirements use a CAIP-2 network ID and an atomic-unit amount string. A submitted `PaymentPayload` includes the selected `accepted` requirement and a scheme-specific payload. Verification and settlement are different operations. The default authorization flow verifies, executes the resource, settles, then responds; other schemes can declare different ordering. [x402 v2 core specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

HTTP uses base64-encoded JSON in `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers. The canonical payment requirement is in the response header. A response body alone does not implement this transport. [x402 v2 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md).

MCP has a separate binding. A payment requirement is a tool result with `isError: true`. Both `structuredContent` and JSON in `content[0].text` contain the same `PaymentRequired`. The retry carries the payload in `params._meta["x402/payment"]`, and settlement metadata uses `result._meta["x402/payment-response"]`. An HTTP 402 applied to the whole MCP endpoint is not this binding. [x402 v2 MCP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md).

The demo should implement those envelopes behind one explicit simulated-payment tool. It should use fixed fixture requirements and a local mock verifier and settlement ledger. The visible amount is a made-up demo price, not a market estimate. The app records `verification: "simulated"`, `settlement: "simulated"`, and a local receipt ID in its own result metadata. An x402 settlement record must not invent a transaction hash; use an empty transaction value when no transaction was broadcast, and keep the simulation label visible in the app.

There is no wallet connection, signature request, chain RPC, facilitator network call, testnet transfer, or real payment. Shape validation of an artificial authorization is not cryptographic verification. Describe this as an `x402 v2 protocol simulation`, not a production x402 integration. The current x402 repository uses Apache 2.0; preserve its license if code is reused. [x402 license](https://github.com/x402-foundation/x402/blob/main/LICENSE).

An application operation ID binds the simulated payment to the visit, quote version, amount, and selected fixture requirement. Repeating that operation returns its saved receipt. Reusing its ID with different inputs fails. This application rule prevents duplicate demo effects; it does not assert that a resource URL in every real payment scheme is cryptographically bound to a payment signature.

Booking, help, cancellation, and the after-visit document remain usable without a wallet. The UI offers equally visible `Use demo insurance`, `Try a simulated self-pay payment`, and `Use demo financial assistance` choices. All three are fixtures. Insurance approval does not produce an x402 settlement, and a payment receipt does not prove insurance coverage.

## FHIR is the open model; payer access is a separate integration

FHIR R4 4.0.1 is a suitable initial exchange model because the published CARIN Blue Button 2.2.0 guide remains based on R4. R4 is a deliberate interoperability target, not a claim that it is the newest FHIR release. CARIN describes consumer access to payer data. It does not establish a universally available, anonymous eligibility or claim-submission endpoint. [CARIN published guide](https://hl7.org/fhir/us/carin-bb/), [CARIN introduction and R4 lineage](https://hl7.org/fhir/us/carin-bb/STU2.1/index.html).

Keep these records distinct in fixtures and in UI state:

| Record | Meaning in the simulation |
| --- | --- |
| `Coverage` | The fictional member's plan and identifiers. |
| `CoverageEligibilityRequest` | A request about coverage or benefits for a service date. |
| `CoverageEligibilityResponse` | Coverage status, benefit details, or prior-authorization requirements returned by the mock payer. |
| `Claim` | The synthetic request for adjudication. Creating it is separate from mock submission and acceptance. |
| `ClaimResponse` | The mock payer's adjudication response. |
| `ExplanationOfBenefit` | The patient-facing explanation of the mock claim and its adjudication. It is not a bill or proof of money movement. |

Eligibility describes coverage and requested benefits. Claim adjudication answers a different question. FHIR explicitly distinguishes these resource responsibilities. [Coverage eligibility response](https://hl7.org/fhir/R4/coverageeligibilityresponse.html), [claim boundaries](https://hl7.org/fhir/R4/claim.html), [EOB scope](https://hl7.org/fhir/R4/explanationofbenefit.html).

The FHIR specification uses CC0, but third-party terminologies can have separate terms. Avoid copying licensed X12 implementation content or CPT tables into an MIT repository. Initial fixtures can use a project-owned synthetic service code such as `demo-virtual-visit`, with an explicitly fictional code-system URI. A base FHIR export must include its required fields and pass validation. An incomplete FHIR-shaped object must be labeled as a domain projection, not a conformant FHIR resource or a CARIN-conformant profile. [FHIR licensing and third-party artifacts](https://hl7.org/fhir/R4/license.html).

US administrative transactions remain a separate boundary. CMS identifies eligibility, claims, and payment/remittance among adopted transactions for applicable covered entities. X12's licensing program and IP rules constrain use and redistribution of its work products. An open JSON representation does not remove those requirements or create a payer connection. [CMS transaction overview](https://www.cms.gov/priorities/key-initiatives/burden-reduction/administrative-simplification/transactions), [X12 licensing](https://x12.org/products/licensing-program), [X12 IP use](https://x12.org/products/ip-use).

Medicare HETS is a concrete example. It uses real-time 270 requests and 271 responses, and access is intended for Medicare providers, suppliers, or authorized billing agents. CMS explicitly states that a 271 response is not a payment guarantee. A demo with no provider backend cannot claim a real eligibility check merely by producing a CoverageEligibilityResponse. [HETS overview](https://www.cms.gov/data-research/cms-information-technology/hipaa-eligibility-transaction-system), [authorized eligibility inquiry](https://www.cms.gov/medicare/coding-billing/electronic-billing/eligibility-inquiry), [HETS companion guide disclosure](https://www.cms.gov/files/document/current-hets-270-271-companion-guide.pdf).

Recommended insurance scenarios are active coverage with a fictional copay, inactive coverage, unknown member, benefits unavailable, prior authorization required, and mock claim denial. A response should retain the service date, the fixture scenario, and its simulation label. Unknown coverage stays unknown. None of these outcomes is a financial recommendation or a statement about a person's real plan.

## Exact simulation language and proof boundaries

Use these strings consistently in the UI and generated artifacts:

| Location | Label |
| --- | --- |
| Persistent demo banner | `Practice with fictional information. This app does not provide medical care.` |
| Appointment confirmation | `Demo appointment saved. No real appointment has been booked.` |
| Previsit form | `Use the sample patient. Do not enter personal health information.` |
| Provider handoff | `Simulated handoff. No clinician has received this information.` |
| Insurance outcome | `Simulated insurance result. Coverage and costs have not been verified.` |
| Payment confirmation | `Simulated payment complete. No money moved.` |
| Claim state | `Demo claim processed locally. Nothing was sent to an insurer.` |
| After-visit document | `Sample after-visit summary. No clinician reviewed or signed this document. It contains no personalized medical advice.` |

The fixtures contain administrative facts and fixed sample text. Do not generate a diagnosis, prescription, treatment recommendation, or clinician signature to make the simulation look complete. A real media connection remains a demonstration between testers. Future clinical services, insurer transactions, and a clinically integrated network require separate work and are outside this design.

Completion evidence must distinguish a fixture journey, local device preview, two-party media, protocol-envelope validation, and actual ChatGPT and Claude host testing. The presence of a Join button or a successful token response does not prove any audio or video crossed between participants.
