# Virtual Care MCP

A virtual-care visit that can follow you between an MCP Apps chat and a browser. Prepare an appointment, save access needs and questions, rehearse a consultation, and take the after-visit record with you.

This MIT-licensed project implements MCP and MCP Apps directly. It has no ChatGPT Apps SDK or host-specific runtime bridge.

**This is a working software demonstration using fictional data.** It is not HIPAA compliant and does not provide medical care. Appointments, clinician responses, insurance decisions, payments, and after-visit notes are simulated. There is no provider backend, payer connection, wallet transaction, or CIN integration.

## Try it locally

Install the official stable **Bun 1.4.2**, then:

```sh
git clone https://github.com/collinbentley1/virtual-care-mcp.git
cd virtual-care-mcp
bun ci --no-env-file --ignore-scripts --registry=https://registry.npmjs.org
bun run build
bun start
```

Open [localhost:3000](http://localhost:3000) for the standalone developer preview. The MCP endpoint is `http://localhost:3000/mcp`. Saved fictional visits use SQLite in `.local/visits.sqlite` and expire after 24 hours. The server listens on loopback during local development.

The standalone preview offers older adult, rural adult, and uninsured adult scenarios. Its full-page journey includes:

- Appointment time, US physical location, and time zone.
- Editable fictional intake, medication and allergy notes, and questions for the care team.
- Large text, audio-first and text options, low-bandwidth preferences, and caregiver, language, interpreter, and caption requests.
- Simulated insurance eligibility, a $35 self-pay x402 exchange, or financial assistance.
- Consent review, a scripted consultation, and a clearly attributed sample after-visit note.
- Resume codes, browser continuation, printable records, and a downloadable FHIR R4 collection Bundle.

Access requests are saved preferences. They do not arrange an interpreter, invite a caregiver, translate the interface, or provide live captions. You can finish the practice visit without a camera or microphone.

To inspect the four MCP card surfaces locally, run `bun run test/cards/server.ts` in another shell and open [127.0.0.1:4335](http://127.0.0.1:4335). This isolated AppBridge harness adds the postpartum scenario, including preparation tasks and patient-entered questions. It uses memory-only synthetic fixtures; see its [test instructions and limits](test/cards/README.md).

## Connect an MCP Apps host

Deploy the server at a public HTTPS origin and add its `/mcp` URL as a custom remote connection in a host that supports MCP Apps. Hosted ChatGPT and Claude connections need an externally reachable endpoint; your computer's localhost URL is insufficient.

Use this starter prompt after enabling the connection:

> Use Virtual Care MCP to start a fictional postpartum practice visit. Help me prepare in this conversation, and show the relevant care cards as we go. Use made-up information only.

The assistant handles the visit in the conversation: it reuses known context, asks only for required missing information, and calls focused tools for each saved action. It shows compact in-context cards only when they add useful interaction: a booked appointment, active consultation, after-visit summary, or postpartum plan. The cards do not replace the conversation or expose the scoped resume credential. The same visit can continue in another host by supplying its resume code and asking to resume it. Text tools remain available when the host cannot render a card.

The earlier shared-visit UI was tested in owned ChatGPT and Claude developer connections, including saved-state continuity and a prerecorded LiveKit participant. Claude and the browser delivered the record downloads. ChatGPT did not start the tested native download or browser handoff; manual browser resume remains available. See the [account verification record](docs/verification-host-accounts.md) for its exact builds and limits. The current card build completed a full postpartum flow through an installed local Codex plugin, and all four card tools returned their expected saved projections. Codex cannot inspect its own task window, so that run does not independently establish the rendered pixels; see the separate [Codex and AppBridge card report](docs/verification-codex-cards.md).

After deploying an updated build, refresh the connection's tool metadata and open a new chat: **Manage → Refresh** in ChatGPT, or **Refresh tools list** in Claude's connector menu. Each HTML/CSP version has an immutable resource URI; existing embeds can retain their previously loaded UI.

| Tool | Purpose |
| --- | --- |
| `care_start` | Create a new fictional visit. Each call creates a new draft. |
| `care_resume` | Read the latest saved visit using its scoped resume code. |
| `care_book_appointment` | Book a chosen sample appointment. |
| `care_save_intake`, `care_set_access` | Save fictional visit context and access preferences gathered in conversation. |
| `care_check_insurance`, `care_choose_payment`, `care_demo_payment` | Rehearse simulated insurance, assistance, or self-pay decisions. |
| `care_accept_demo_consent` | Save the explicit fictional-data, simulation, telehealth, and location acknowledgments. |
| `care_begin_consultation`, `care_finish_consultation` | Start or finish the scripted practice consultation. |
| `care_cancel_visit` | Cancel the fictional visit while retaining its readable record until expiry. |
| `care_update_maternal_plan` | Complete or reopen postpartum preparation tasks and save patient-entered questions. |
| `care_show_appointment` | Show the read-only appointment card after booking. |
| `care_show_consultation` | Show the consultation card; only this card can request camera or microphone access. |
| `care_show_after_visit` | Show the read-only scripted summary after the consultation finishes. |
| `care_show_maternal_plan` | Show the postpartum appointment, preparation tasks, and saved questions. |
| `care_export` | Export the synthetic visit and financial record as FHIR R4 JSON. |

Card controls and refreshes call the same focused mutation and read-only card tools available to the assistant. Legacy generic update and payment-exchange plumbing, and temporary LiveKit access, use app-only tools that stay out of the model's normal tool list.

Anyone with a resume code can read the fictional visit until expiry and change it while it remains open. Codes are available to the connected assistant for text continuity; they are not patient authentication. Browser handoff uses a URL fragment, which the UI removes after reading it. The database retains a hash of the code. Media tokens stay separate from the saved record and model-visible tool content.

## Media and billing

The optional media adapter uses the official LiveKit client and the documented LiveKit JWT contract. Configure a separate self-hosted LiveKit server to exchange real audio and video between demo participants. The default deployment supports the scripted visit without a media server. See [setup, transport evidence, and lifecycle limits](docs/media.md).

Self-pay implements x402 v2's MCP binding and a separate HTTP 402 binding. Its private `mock-exact` scheme validates a fixed mock authorization and records simulated settlement; it cannot sign a wallet transaction or move funds. Insurance fixtures keep eligibility and claim adjudication separate. The FHIR export includes linked coverage, eligibility, claim, response, and explanation-of-benefit resources where applicable. See the [standards research](docs/research/care-and-billing.md) and [published FHIR JSON-schema validation](docs/verification-billing.md).

## Configuration

| Variable | Default / use |
| --- | --- |
| `PORT` | `3000` locally; the platform supplies the production port. |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>`; set the exact public HTTPS origin when deploying. |
| `VISIT_STORE` | `sqlite`; also accepts `memory` or `firestore`. |
| `VISIT_DATABASE_PATH` | `.local/visits.sqlite` for SQLite. |
| `FIRESTORE_PROJECT_ID` | Required for Firestore; credentials come from the service identity. |
| `FIRESTORE_DATABASE_ID` | `(default)`. |
| `FIRESTORE_COLLECTION` | `visits`. |
| `LIVEKIT_URL` | Optional signalling endpoint; remote servers require `wss:`. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Set together with `LIVEKIT_URL` through private server configuration. |

Use fictional data even in a public deployment. The app checks expiry on every read and mutation. Firestore TTL handles eventual cleanup when configured; SQLite and memory prune expired visits when another visit is created. Expiry enforcement does not depend on cleanup. A completed or cancelled visit remains readable until its original expiry.

## Development and deployment

```sh
bun run verify
```

Verification installs the exact lockfile, checks formatting, lint and types, exercises the domain and protocol, and builds the actual server and UI. Tests cover SQLite persistence, cross-client conflicts, retries, expiry, payment proof binding, FHIR fixtures, and media grant scope. Firestore transport fixtures are separate from live cloud verification.

The implementation uses `@modelcontextprotocol/ext-apps` 1.7.5 with stable MCP Apps protocol `2026-01-26`. SDK 2.0 was released September 8, 2026 and uses the same wire protocol; it is deferred until it meets this platform's seven-day dependency age policy. See [protocol and host research](docs/research/mcp-apps.md).

The repository adopts the [shared platform](https://github.com/collinbentley1/platform) for Cloud Run, Firestore, immutable workflow pins, image verification, and protected deployment. Its Dockerfile requires the platform's verified named OCI build contexts. Follow the [platform adoption record](docs/research/platform.md) for that deployment path; a plain `docker build` does not supply those contexts.

Architecture and verification records live in [docs/decisions/architecture.md](docs/decisions/architecture.md) and [docs/verification-plan.md](docs/verification-plan.md). Actual host rendering and public deployment are recorded independently from local tests.

## License

[MIT](LICENSE). Contributions should preserve the direct MCP Apps interface, explicit simulation labels, portable visit state, and the separation between consultation state and media transport.
