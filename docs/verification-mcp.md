# MCP transport and local host verification

Verified on 2026-09-09 using MCP Apps 1.7.5, MCP SDK 1.30.0, and Bun `1.4.2+744846f84`. The source regression below covers a host serialization behavior found during the controller's account testing. Built browser passes use the independent local host and are bound to their listed artifact hashes; they do not establish ChatGPT or Claude verification.

The current server derives the `ui://virtual-care/visit-v1.<sha256-prefix>.html` resource URI from the origin-substituted HTML and its UI resource metadata (CSP, permissions, and border preference). It uses that same URI in registration, `resources/read`, and `care_render` metadata. This keeps a host's permitted prefetch/cache behavior from reusing an older template after the bytes or CSP change. Historical artifact entries below retain the URI observed in those earlier builds.

## Payment offers and host error promotion

The controller observed ChatGPT turning the mock payment tool's expected `isError: true` challenge into a failed host request, discarding its structured result before the app received it. The app must not recover a payment offer by parsing the host's human-readable error text.

Successful payment-state results now include `_meta["virtual-care/payment-required"]`, an app-specific informational offer validated by `mockPaymentRequiredSchema`. It uses the existing `MockPaymentRequired` type. One adapter helper constructs the resource URL for both this offer and the raw challenge, binding it to the canonical public origin, visit ID, and current quote ID. The offer also binds the mock amount, currency denomination, and quote expiry. Reading an offer does not authorize or settle a payment.

The embedded client validates the offer against the saved quote and public origin, then supplies `_meta["x402/payment"]` when the user explicitly chooses a simulated payment outcome. It retains the original command arguments and proof across uncertain delivery, including a read refresh that reports the consumed quote's later state. A missing offer can be refreshed through `care_resume`. Older notifications cannot replace a newer offer for the same visit.

| Result | Transport behavior |
| --- | --- |
| Missing or mismatched proof | Raw MCP retains the `isError: true` PaymentRequired challenge. Native HTTP retains status 402 and its payment headers. |
| Simulated decline or expired quote | MCP returns a completed call with `isError: false` and an explicit `CareResult` of `kind: "error"`, with code `payment_declined` or `quote_expired`. No settlement is claimed or emitted. Native HTTP behavior is unchanged. |
| Payment option changed elsewhere | The original submission returns a conflict with the authenticated current envelope. It does not switch to another quote or allocate another command. A replacement quote's offer may accompany the conflict for review. |
| Consumed quote replay | The operation history is checked first. The original proof can replay the committed payment after another quote becomes current or the original quote expires, returning the latest envelope without a second receipt. |
| Invalid or unavailable operation | Tool-error behavior remains intact, including changed input for a reused command ID and unavailable execution. |

The protocol suite passes 18 tests with 171 assertions. It verifies that metadata, raw MCP, and native HTTP offer the same requirement; rejects modified origin, visit, quote, amount, denomination, and expiry; and exercises a real App/AppBridge host that promotes tool errors to protocol errors. Separate client fixtures replace a cached quote with assistance or another quote without notifying the app, then prove that the original submission returns a conflict without a receipt or further revision.

The browser harness provides Promote tool errors to protocol errors, Drop next mutation response, and Change payment to assistance without notifying app. The one-shot response loss occurs after execution and clears its checkbox. The evidence panel reports only retry equality booleans, revision, replay status, and receipt count; it does not expose credentials or proof payloads.

A first built recovery pass verified visible decline and an identical-proof replay after a lost committed payment response. It also found that Check saved visit hid the retry controls while a command remained pending. The controller corrected the feedback fallback so pending commands retain their recovery controls after a read refresh. The final focused pass below verifies that correction. Its artifact predates the subsequent visual and content redesign.

## Built payment recovery pass before the visual redesign

The controller's combined stable Bun build passed 73 tests with 503 assertions, plus formatting, lint, and type checking. The independent browser harness copied that supplied build without rebuilding product code. Its build receipt matched the four hashes below, including the 218,405-byte embedded HTML. Older adult, null omission, and tool-error promotion were enabled throughout.

| Check | Observed result |
| --- | --- |
| Expected decline | Try a declined payment displayed the explicit simulation decline, remained at payment revision 3, and retained zero receipts. The host did not promote it to a protocol failure. |
| Lost approval response | Drop next mutation response executed the approval, then discarded delivery. The host showed consent revision 4 and exactly one receipt; the app showed an unconfirmed save. |
| Refresh while pending | Check saved visit loaded the committed consent state. The pending-save message and Retry the same save control remained visible. Reading the state did not claim to confirm the original command. |
| Original proof replay | Retry used the identical tool arguments and proof, returned `replayed: true`, stayed at revision 4 with one receipt, and cleared the pending-save UI. |
| Unannounced option change | The app created another quote at revision 5. The independent host selected assistance without notifying the app, advancing saved state to consent revision 6 while the app still showed the cached quote. |
| Stale approval | Approving that cached quote returned the current-state conflict. Saved state remained at revision 6 with one receipt; no additional payment occurred and no retry lock remained. |
| Further action | Saving the consent acknowledgments then succeeded at ready revision 7, demonstrating that the conflict did not leave the UI stuck. |
| Diagnostics | Captured browser logs were empty. No host error promotion occurred on the ordinary result paths; response loss was the explicit fixture action. |

Quote expiry, replacement by another self-pay quote, proof tampering, and native MCP/HTTP challenges were verified by the protocol tests, not repeated in this focused browser pass. This pass did not cover the later visual redesign, generated video, exports, or live calling. The supplied product artifacts were unchanged during verification.

## Host null-omission regression

The controller observed ChatGPT committing the fictional intake at revision 2 while the embedded app displayed an uncertain-save message. The captured HTTP response contained the canonical coverage state, including `insuranceCheck: null`. Inspection of the captured public host assets, `main-BrxRrRo1.js` and `adapter-BFGEbLte.js`, explained the difference: the adapter applies the main module's exported result decoder before delivering `tools/call` results. That decoder recursively removes null-valued object properties from `content`, `structuredContent`, and `_meta`, while preserving null array elements.

This removes the required nullable `insuranceCheck` property from coverage results. It also removes an unknown `patientEstimateCents` inside an insurance check. A raw-response hypothesis involving null content annotations was superseded: the host decoder removes those annotations before the SDK sees them. Appointment results have neither affected domain field, which explains their successful rendering.

The two existing nullable field schemas now default omitted input to null. Parsed output retains explicit null and its original inferred types. Other required fields, value constraints, and strict object checks remain enforced. No general recursive normalizer was added to product code.

Two tests in `test/mcp.test.ts` connect a real MCP Apps `App` and `AppBridge` over the SDK's `InMemoryTransport`, then forward tool calls through the official MCP client and request handler. The host fixture applies the observed recursive omission immediately before response delivery. They verify:

- Older-adult intake with the built-in fictional example, text mode, larger text, captions requested, and the sample caregiver advances to coverage at revision 2.
- The delivered result omits `insuranceCheck`; parsing restores explicit null. An unchanged retry reports `replayed: true` without another revision, and resume returns the same saved snapshot.
- Cancellation preserves a coverage state with a restored null check under `previous`.
- A benefits-unavailable insurance check restores its unknown estimate, including under a cancelled visit's previous state.
- Missing intake reason, an invalid check, negative or nonnumeric estimates, and unexpected state properties still fail validation. A supplied numeric estimate remains unchanged.

The selectable browser fixture in `test/host/index.html` applies the same omission to both tool responses and tool-result notifications. The host retains canonical saved state for comparison. The regression source passed 12 protocol tests with 93 assertions, type checking, lint, and formatting checks. The controller's combined build passed 68 tests with 429 assertions. The focused built browser pass below covers the decoder change and the corrected text-mode default.

## Focused built browser pass after the nullable-field fix

The supplied build was copied without rebuilding product code and run with Bun `1.4.2+744846f84`. The browser's build receipt matched all four supplied hashes listed below. The embedded HTML was 217,000 bytes. Older adult and Omit null object fields from host results were selected before initialization.

| Check | Observed result |
| --- | --- |
| Intake and access preferences | The built-in fictional example used text mode, low bandwidth, larger text, captions requested, English, and the sample caregiver. Appointment saving and intake validation succeeded. |
| Committed but unconfirmed save | Browser network interception paused only the intake tool fetch response after HTTP 200. The response contained `kind: ok`, coverage revision 2, `replayed: false`, and explicit `insuranceCheck: null`. Deliberately failing delivery produced the uncertain-save message and retry controls. |
| Same-command replay | Retry the same save sent the identical tool arguments, command ID, and expected revision. It returned `replayed: true` at revision 2, then rendered coverage after the host omitted null fields. Per-request protocol metadata was not required to be identical. |
| Resume | The app's resume form reopened the same saved coverage state successfully. The resume credential was used only in the local fixture and was excluded from the record. |
| Unknown estimate | Benefits information unavailable advanced to coverage revision 3 and displayed that the sample cost was unknown. |
| Teardown and initial delivery | Teardown was acknowledged; reconnect initialized a new app and delivered the unknown-estimate state through a null-omitted tool-result notification. Coverage and the unknown-cost message remained at revision 3. |
| Text mode with low bandwidth | After choosing assistance and saving acknowledgments, Text practice remained selected by default. Entering the practice room reached consulting at revision 6 with zero optional media asset requests. |
| Diagnostics | Captured browser logs were empty after the focused flow. Temporary response interception was cleared before the remaining steps. |

This focused run did not repeat exports, x402 settlement, external-link refusal, or live media testing. Their earlier results remain bound to the older artifacts below. All four shared `dist` hashes were unchanged after this pass; only this verification record was edited during the focused run.

## Bun 1.4.2 full host pass before the nullable-field fix

The supplied `dist` was copied without rebuilding or changing product source. The harness and copied server ran directly with the verified Bun `1.4.2+744846f84` executable. The browser's build receipt matched all four supplied hashes; the embedded HTML was 217,006 bytes.

| Check | Observed result |
| --- | --- |
| Resource and initialization | Exact public-origin import-map substitution and resource CSP passed. The separate-origin sandbox exchange, `ui/initialize`, initialized notification, and initial tool-result rendering completed at revision 0. |
| Host update | A host-originated access change arrived through a tool-result notification; the app enabled larger text and showed the updated saved revision. |
| Self-pay and completion | The app sent two `care_simulate_payment` calls for the x402 challenge/proof exchange, displayed simulated settlement, and completed the fictional visit at revision 8. |
| Downloads | The host accepted a valid JSON record of 6,435 UTF-8 bytes and FHIR bundle of 18,721 bytes, with the continuation credential absent from each. Returning `isError: true` for a subsequent download produced the explicit download-not-started recovery message. These are validated host receipts, not files saved to disk. |
| Browser handoff refusal | Returning `isError: true` from `ui/open-link` produced the browser-did-not-open message and resume path. |
| Teardown and reopening | Teardown was acknowledged. A second initialization and tool-result delivery reopened the completed visit at the unchanged revision 8. |
| Lazy media and failure | The passive observer counted zero optional media requests through consultation entry, then one after Connect live demo. The deliberately closed signaling endpoint produced an honest connection-failed message while retaining the saved visit. |
| Diagnostics | Fresh captured browser logs were empty after the entire flow, including media, exports, refusal paths, and reconnect. |

Camera and microphone permissions remained denied. This run did not test live calling or actual ChatGPT/Claude accounts. Only this record file changed; the current product artifact hashes remained unchanged after verification.

## Earlier Bun 1.4.0 stable artifact smoke

The controller's current `dist` was copied and tested without rebuilding it. The copied artifact's hashes matched the stable build listed below, including the 426,719-byte HTML resource. The harness and copied server were launched directly with the verified Bun `1.4.0+34cbb9a40` executable.

The separate-origin sandbox completed the standard proxy exchange and app initialization. The app rendered revision 0, saved the appointment through AppBridge, and completed an assistance visit at revision 6 through six app mutations. The host accepted a valid JSON record wrapper of 5,078 bytes and a valid FHIR bundle of 17,557 bytes; neither contained the continuation credential. These are validated host receipts, not filesystem downloads. An explicit `isError: true` download refusal produced the browser/resume fallback. Teardown was acknowledged; a new initialization restored the completed visit at the unchanged revision 6. Captured browser logs were empty.

This abbreviated stable-artifact run did not repeat the earlier host-originated update, x402 browser exchange, refused external link, or lazy media-request checks. Those observations remain bound to the earlier artifact below.

## Earlier full harness run

This run used a 427,010-byte HTML artifact. Although the outer build command used stable Bun, the package script invoked a nested `bun` from the ambient PATH: `1.4.0-canary.1+2629789a2`. An isolated package-script probe reproduced that resolution. The runtime and host harness used stable Bun, but this artifact was not the final stable-bundled output.

The actual built app completed initialization, rendered a server tool result, saved visit changes through `tools/call`, received a subsequent host-originated result, acknowledged teardown, and reopened its saved state through a new AppBridge. Standard host download acceptance and refusal, refused browser handoff, and the optional media request behaved as described below.

| Check | Observed result |
| --- | --- |
| Built resource | The server returned `ui://virtual-care/visit-v1.html` with `text/html;profile=mcp-app`. Its import map resolved to the exact configured public origin. The placeholder was absent and that origin was present in resource CSP. |
| Sandbox initialization | A separate-origin proxy sent `ui/notifications/sandbox-proxy-ready`; AppBridge delivered `ui/notifications/sandbox-resource-ready`. The app sent `ui/initialize` and `ui/notifications/initialized`. |
| Initial hydration | Host tool-input and tool-result notifications rendered the appointment screen at revision 0. |
| App mutations | Appointment, fictional intake, payment choice, acknowledgments, consultation entry, and completion saved through the standard AppBridge tool proxy. The assistance visit in this earlier run reached `complete` at revision 7. |
| Simulated x402 | An earlier built run completed the self-pay challenge and proof retry through AppBridge, then rendered the simulated receipt and consent screen. The dedicated SDK/HTTP tests also cover proof binding and replay. |
| Host-originated update | The host saved a changed access preference and sent another tool-result notification. The app reflected larger text and the new saved revision. |
| Teardown and reconnect | The app acknowledged `ui/resource-teardown`. After removal and recreation, a second initialization and tool-result notification restored the same completed visit at revision 7. A prior run also reopened an active consultation without advancing it. |
| Accepted host download | `ui/download-file` delivered a valid synthetic FHIR bundle containing 17,669 UTF-8 bytes. The harness validated the bundle, checked that the continuation credential was absent, and returned success. This is a host receipt, not a file saved to disk. |
| Refused host download | With the host returning `isError: true`, the UI said the download did not start and offered browser/resume recovery. |
| Refused browser handoff | The host returned `isError: true` from `ui/open-link`. The UI said the browser did not open and displayed the resume path. No destination credential was logged. |
| Lazy media asset | A passive Resource Timing observer reported zero `livekit.js` requests through consultation entry, then one after the user clicked Connect live demo. The existing HTTP test independently checks cross-origin public asset delivery. |
| Media failure | The fixture signaling endpoint was deliberately closed. The app reported that the connection could not start and retained the saved visit. Camera and microphone permissions were denied throughout; no device access or live media session was tested here. |
| Browser diagnostics | The fresh browser's captured logs were empty after the visit, media request, exports, refusal paths, and reconnect. This confirms that the tested flow emitted no SDK message payload logs. |

The browser's resource observer establishes that the optional asset was requested after the explicit action. It does not prove a WebRTC connection. The harness denies camera and microphone access and makes no claim about permissions granted by ChatGPT or Claude.

## Reproduce

From the repository root, use the verified stable Bun executable. For package scripts that invoke another `bun`, put that executable's directory first in PATH. Check `--revision`, not only `--version`.

```sh
bun --revision
bun test test/mcp.test.ts
bun test/host/server.ts
```

The expected current revision is `1.4.2+744846f84`. The harness copies the existing `dist` and does not rebuild the product. To create a new artifact before a new verification run, invoke `bun tools/build.ts` with the verified executable; the build rejects a different Bun revision before changing `dist`.

Open `http://localhost:4321/`. The harness serves the host on 4321, a copied built MCP server on 4322, and the sandbox proxy on 4324. Its synthetic media configuration targets the deliberately closed port 4323. `MCP_HARNESS_PORT` changes the base port; reserve the base, base + 1, and base + 3. The copied build is isolated under `.local/mcp-host-harness-<port>/artifact` and uses an in-memory visit store. Child processes receive only explicit fixture configuration.

Use Start synthetic visit and complete a fictional visit in the inner frame. Deliver host update verifies incoming result notifications. Teardown app and Reconnect app verify lifecycle handling. The host accepts validated record requests by default; Deny host download requests changes its response to an explicit refusal. The host always refuses external links. Accepted download requests are acknowledged without saving files.

To reproduce the host serialization case, select Older adult and enable Omit null object fields from host results before starting. Save an appointment, choose Fill in a fictional example, select Text practice, and save the intake. The host should record coverage at revision 2 and the app should show the coverage screen. Benefits unavailable exercises an omitted unknown estimate. Teardown and reconnect exercise the same omission during initial result delivery. The fixture preserves null array entries; it does not delete arbitrary fields or alter the built app.

For payment recovery, also enable Promote tool errors to protocol errors and choose simulated self-pay. Try a declined payment, then enable Drop next mutation response before approving. Use Check saved visit followed by Retry the same save; verify identical arguments/proof, unchanged revision, and one receipt in the evidence panel. To check stale state, create another self-pay quote, use Change payment to assistance without notifying app, then approve the still-visible old quote. The app should show a conflict with the current assistance state and permit a subsequent valid action without another payment.

The outer iframe uses `allow-scripts allow-same-origin allow-forms` on a different origin from the host. The inner iframe remains opaque with `allow-scripts allow-forms`. Its CSP comes from the resource metadata, blocks ordinary form submission and nested frames, and excludes `unsafe-eval`. Form permission enables the app's intercepted submit events. A test-only passive observer reports only the optional asset's filename; it does not inspect visit content or modify the built application JavaScript. This follows the [standard sandbox-proxy exchange](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#sandbox-proxy).

The transport suite passes 18 tests and 171 assertions. It exercises the real App/AppBridge null-omission and payment-error regressions and the official SDK client against the request handler, including strict inputs, Apps metadata, full synthetic visit/export, app-only media results, revision conflicts, immutable resource URI derivation, payment proof tampering and replay, native 402 headers, asset CORS, malformed/oversized requests, origin rejection, and Cloud Run startup refusal without `PUBLIC_BASE_URL`.

## Verified built artifacts

### Bun 1.4.2 payment recovery build before the visual redesign

The final payment recovery pass used these supplied artifacts. The embedded HTML size was 218,405 bytes.

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `c6f4a2be63b4de8f3e01f0fc121ad3019fab3cc7fa16c5e0edb40db787eed8ba` |
| `dist/mcp-app.html` | `e39b295f231f9b5d8cbececd0187cc90c0e79bf850ad644c5cb656d7af0f7a39` |
| `dist/public/app.js` | `d3027e780df2b2ddc6871313f68713c939b4d80b0aeab71c2f3d9d3b2b1694fb` |
| `dist/public/livekit.js` | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

### Bun 1.4.2 build with nullable-field decoding and retained text mode

The focused browser pass used these exact supplied artifacts without a product rebuild. The embedded HTML size was 217,000 bytes.

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `4c8939eb08bf39ec9e5f308453b6a7755bcad04f6d53ea60b17907d65ba2b9c3` |
| `dist/mcp-app.html` | `3365bde5fdbeccdb3ae59667d60df284668a1db6c8af061f697f3f7c7d5a82da` |
| `dist/public/app.js` | `6c15ebf0946d5f6b4633d8edf87f4094a422bc1cb46d33409382f0cf01f55b41` |
| `dist/public/livekit.js` | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

### Bun 1.4.2 build before the nullable-field fix

The full host pass used these exact supplied artifacts without a product rebuild. The embedded HTML size was 217,006 bytes.

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `ff1806d1d2b738e88c1ae9a224f9e4a476b1e3cd711d922841de33277ab14d95` |
| `dist/mcp-app.html` | `e6a0e3cfb4f29981b84d3f6217f7287cf5e36d37761fe44583016650629e90ec` |
| `dist/public/app.js` | `2092807112f33b37cba3cad9d03b16a292e218250932a6169672fa14337f903c` |
| `dist/public/livekit.js` | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

### Earlier Bun 1.4.0 stable build

The abbreviated smoke used these SHA-256 values without rebuilding the supplied artifact. The embedded HTML size was 426,719 bytes.

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `384f2c9b40fd1f0db3c296f75a3afa602bf309d56a34c4ce4ed184d8f120fd5b` |
| `dist/mcp-app.html` | `89a95b8254ec77ab8c829295935ec457bfc5a42318ffa865ca6de2ed78edb39f` |
| `dist/public/app.js` | `b45d88d029a59f58c696ff19d8f83a73333d747a7437937f465cadd730ec5723` |
| `dist/public/livekit.js` | `2696ca02194085097cf7cb97b4cd2dabf9e3ad0cf89a8323c7dbcca5522eb053` |

### Earlier artifact

The fuller run used the following SHA-256 values and a 427,010-byte HTML resource. These hashes must not be presented as the stable build's receipt.

| Artifact | SHA-256 |
| --- | --- |
| `dist/server.js` | `38d0ce126903369ffafee975cdcbf1e9504ae57124b28840f88c1c4b0f889e97` |
| `dist/mcp-app.html` | `28e46a0243c14616d80844c747bb81c2a5cf9e95a0f850b7aa90b004ebbac76c` |
| `dist/public/app.js` | `b8581ed8d50f150292d35ba12ec8b0cc82464f8f38642768c7fceb60e680d03f` |
| `dist/public/livekit.js` | `3eeaba7d4a6deb00647a4893837d60d9ed3990c25a2d92167675ad204d57e716` |

## Corrections found during verification

The first embedded run failed before initialization because the optional empty browser-URL metadata reached a URL constructor inside a schema refinement. The UI now rejects values that cannot be parsed before constructing a URL; the rebuilt iframe initialized successfully.

The installed MCP Apps transport logged complete protocol objects through dependency console calls. Browser builds now remove those calls; the optional LiveKit entry also uses its supported silent logging setting. Fresh browser verification produced no message payload logs.

A harness-only record validator initially expected a bare snapshot, while the app exports `{ mode, notice, snapshot }`. The harness now accepts that documented wrapper. The later stable-artifact smoke observed acceptance of both JSON and FHIR requests. Neither acceptance establishes a file saved to disk.

A nested build script also resolved the global canary Bun instead of the explicitly selected stable executable. The build now checks the exact stable revision before modifying its output. The earlier evidence remains attached to its original hashes; the Bun 1.4.0 stable artifact has a separate smoke receipt and Bun 1.4.2 has the current full host receipt.

Actual ChatGPT/Claude installation, embedded device permissions, live calling, and a host saving a downloaded file require their own evidence. See [UI verification](verification-ui.md) for separate native-browser results.
