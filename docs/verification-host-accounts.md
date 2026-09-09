# ChatGPT and Claude account verification

Observed September 9, 2026 using owned developer test connections, fictional information, and a temporary public HTTPS endpoint. This record does not establish permanent deployment or clinical service. No provider, insurer, payment network, camera, or microphone participated.

## Initial Bun 1.4.2 artifact

The built server and UI were copied before testing. The server used an isolated in-memory store with no inherited credentials.

| Artifact | SHA-256 |
| --- | --- |
| Server | `ff1806d1d2b738e88c1ae9a224f9e4a476b1e3cd711d922841de33277ab14d95` |
| MCP app HTML | `e6a0e3cfb4f29981b84d3f6217f7287cf5e36d37761fe44583016650629e90ec` |
| Standalone JavaScript | `2092807112f33b37cba3cad9d03b16a292e218250932a6169672fa14337f903c` |
| Lazy media JavaScript | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

Both hosts discovered seven tools and recognized the interactive MCP Apps resource. Claude classified the media tool as app-only. Its initial empty-tool label cleared when discovery completed.

ChatGPT rendered the older-adult scenario with larger text. Saving the appointment opened intake. The intake save committed at revision 2, but the UI reported that the save was not confirmed. The same-command retry returned revision 2 with `replayed: true`; no duplicate change occurred. The host HTTP response and its observed sandbox adapter established the cause: the adapter recursively removes null-valued object properties, including the required nullable `insuranceCheck` field, before passing the result to the app.

Claude completed the rural-adult scenario through appointment, fictional intake, active demo insurance, consent, a scripted text conversation, and aftercare at revision 7. The displayed insurance estimate was $15, and the aftercare distinguished the simulated claim decision from eligibility. The join screen initially replaced a saved text preference with audio when the low-bandwidth preference was enabled; text was explicitly selected again for this run.

Claude delivered both exports through the standard host download-file confirmation and the native save dialog:

| Export | Bytes | SHA-256 |
| --- | --- | --- |
| Synthetic visit JSON | 6,119 | `5132eae3b556ad9b8d2f8ed8c3931d91149611e53e2c54c13be70e28a9f4baaa` |
| FHIR collection Bundle | 37,023 | `6cff14aed1760c64dbe57431634621a3b7d13ea13b57778b16d62d713f7adad7` |

The visit export parsed as a completed synthetic visit with three transcript entries. The FHIR export contained 15 resources, including separate eligibility, claim, claim-response, and explanation-of-benefit records. Neither contained a resume credential. These checks establish export delivery and contents; the separate FHIR validation report defines the schema-validation scope.

## Intake correction verified in ChatGPT

The two nullable care fields now decode omission as canonical null while preserving their existing output types and other validation. The join screen now honors the saved explicit mode.

The next copied build used SQLite. Its server hash was `4c8939eb08bf39ec9e5f308453b6a7755bcad04f6d53ea60b17907d65ba2b9c3`, MCP HTML hash was `3365bde5fdbeccdb3ae59667d60df284668a1db6c8af061f697f3f7c7d5a82da`, and standalone JavaScript hash was `6c15ebf0946d5f6b4633d8edf87f4094a422bc1cb46d33409382f0cf01f55b41`. The media artifact was unchanged. The JavaScript loaded in ChatGPT's actual app frame matched that build.

ChatGPT saved the appointment at revision 1 and the fictional intake with text mode, low-bandwidth preference, caregiver support, larger text, and captions at revision 2. The coverage screen then rendered successfully. Selecting the unavailable-benefits scenario saved revision 3 and displayed that the sample cost was unknown. Selecting self-pay saved revision 4 and displayed the $35 simulated quote.

Approving that quote exposed another host integration issue: ChatGPT converted the standard MCP `isError: true` payment-required challenge into an HTTP 400 exception, withholding the structured offer from the app. No payment was committed. The later payment-state metadata correction is verified below. The raw MCP challenge and HTTP 402 exchange remain supported.


## Revised UI, payments, and incoming media in ChatGPT

The September 9 account run used this copied Bun 1.4.2 artifact:

| Artifact | SHA-256 |
| --- | --- |
| Server | `c6f4a2be63b4de8f3e01f0fc121ad3019fab3cc7fa16c5e0edb40db787eed8ba` |
| MCP app HTML | `377771e74c4abec7a1a2715af8cfe007816a8ff22882cc5a5a0c5c9a698e65` |
| Standalone JavaScript | `fc8eea7c066747fc601f31c6e3da1f92bb8c68fa644078ef2c5aff68d71f0674` |
| Lazy media JavaScript | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

The inline JavaScript read from ChatGPT's actual embedded frame matched the standalone JavaScript hash. A private integration launcher used the built request handler, the unchanged SQLite service implementation, and a dedicated LiveKit test configuration. This verifies that configured integration path, not the default startup path or a production deployment.

The same SQLite visit survived server restarts and resumed at its prior payment step. ChatGPT displayed the expired-quote result, created a new $35 quote, displayed a simulated decline, and then approved the payment into consent. The successful result contained one simulated receipt. The app supplied its validated offer with the approved proof rather than depending on ChatGPT to forward an error-valued challenge. Consent and selection of video opened the consultation.

The visible app had the compact demo label, host system typography, and no large brand, introductory banner, or footer. At the observed 522-pixel width, body width and scroll width both measured 522 pixels. Larger text measured 20 pixels. The app's embedded root/body rule was transparent; ChatGPT's own `html.chatgptOled.dark` rule supplied the black root canvas and its `html, body` rule supplied the system font. This is host styling rather than an app-owned background.

Selecting Join call connected with microphone and camera off. A separate test participant published the labeled, entirely fictional prerecorded clinician clip and a quiet generated test tone. The actual embedded video reported 960 by 540 pixels, ready state 4, unpaused playback, and advancing playback time from 27.509 to 43.924 seconds. The audio element was unpaused and unmuted with advancing playback time. A screenshot showed the clinician and the burned-in “Fictional clinician · prerecorded demo” label. No device permission prompt appeared and the controls continued to offer turning the microphone and camera on.

A fictional message saved while the stream continued; playback later advanced beyond 110 seconds. Finishing the visit reached revision 10 and removed all embedded video and audio elements. The sender was then disconnected and reported that the clip, generated audio, and published tracks had stopped. The fixture used loopback ICE on the owned Mac; this does not establish media connectivity between remote Internet users. The sender had earlier failed transiently; its final successful run does not establish the cause of those earlier failures.

ChatGPT did not start the requested host download and the app displayed its browser-resume guidance. A browser handoff request also did not produce an observed new tab. Manually opening the public browser app and entering the same resume code loaded the completed record. Both browser downloads arrived on disk, despite the browser automation's download-event wait timing out:

| Export | Bytes | SHA-256 |
| --- | --- | --- |
| Visit JSON, completed revision 10 | 7,484 | `eeef98999949717567fe815c6da8394666f05741249b5543a9e9c21b277fe05c` |
| FHIR collection Bundle, 8 resources | 19,779 | `aed6bafbd6a3674bcce6755b7ee5e7db825386f3e920311878e09239b46dbcd9` |

Both files parsed and neither contained a resume credential. The downloads establish the manual browser fallback; they do not establish successful native ChatGPT download or link opening.

A fresh Claude chat resumed the same consulting visit, but rendered the earlier UI and CSP cached under the fixed resource URI. The immutable resource identity and final Claude refresh are verified below. The keyboard-focus and resource-version corrections that followed this account run are not covered by the hashes above.


## Final resource refresh and cross-host export

The final copied build passed 74 tests and 507 assertions plus formatting, lint, types, and build checks. It includes the keyboard-focus correction and immutable resource identities:

| Artifact | SHA-256 |
| --- | --- |
| Server | `9a74eea121b961389bf3af621a1219faed81125a714ba8f9e3e601d8bab9253d` |
| MCP app HTML | `3de6b0a7d2bf93a16478c7fb294ef1363ebb7320e53c366fac5f731776f07992` |
| Standalone JavaScript | `ab6fcddbaa3f09712d35ce0724325e4ed0f99bdc4a8cca1a0bf25f91b89d314a` |
| Lazy media JavaScript | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

The server restarted while preserving the same SQLite store. ChatGPT's Manage → Refresh discovered `ui://virtual-care/visit-v1.e5e48e79908ec839.html` for this particular HTML and test-origin/CSP configuration. A new chat rendered the completed visit at revision 10. The JavaScript read directly from its versioned app frame matched the final JavaScript hash.

Claude's connector menu → Refresh tools list, followed by a new chat, rendered the compact final UI, completed state, and the current LiveKit CSP. The old banner and branding were absent. Its native download confirmation and save dialog delivered both the visit JSON and FHIR JSON. Their bytes and hashes exactly matched the browser exports in the preceding section: completed revision 10, one simulated payment record, eight FHIR resources, and no resume credential.

These results establish continuity between ChatGPT, Claude, and the browser across process restarts; correct discovery of changed UI resources; and actual export delivery through Claude and the browser. They do not establish native ChatGPT download support, physical printing, a production Firestore deployment, or remote-network LiveKit connectivity. The separate UI report records the final focused keyboard regression checks.


## Test cleanup

After verification, the temporary Claude connector was removed and the ChatGPT development connection was uninstalled; ChatGPT returned to its Install plugin state. The isolated app servers, app HTTPS tunnel, prerecorded sender, LiveKit container, and LiveKit tunnel were stopped. A final controller check found no listeners on their test ports. The media worker removed the private temporary LiveKit configuration and credentials, retaining sanitized verification evidence and the public labeled clip. Exported synthetic records remain available locally. Permanent deployment and permanent host connections are separate remaining work.


## Subsequent media-control focus correction

A final publication review found that the reused media panel's seven buttons lacked the stable IDs used to restore focus after a background render. The only subsequent product edit added those IDs; no media transport, payment, persistence, or host protocol logic changed. The next build again passed 74 tests and 507 assertions plus format, lint, type, and build checks. Its server and lazy media hashes were unchanged; MCP HTML was `ee9b34728c8579b979a0b0284f2b2307572ca9c2af00b4a99473979b1eb2efb5` and JavaScript was `6138b473bdb99b9fd6787ce59fb04a0a9963e019a5f32bd957549d99b7b8dd42`. The account evidence above remains scoped to its recorded artifact. The UI verification report records the separate built focus regression for this final edit.

## Subsequent concurrent SQLite startup correction

Verification after adopting the merged platform pin exposed an existing multi-process startup race. A new SQLite connection attempted to enable WAL before setting its five-second busy timeout, so one of two processes opening the same database could exit with `SQLITE_BUSY_RECOVERY`. The existing writer-contention test reproduced the failure and now preserves child stderr when startup fails. Setting the busy timeout before enabling WAL fixes the startup boundary without changing visit transactions or stored data.

The focused contention test passed 100 consecutive process-pair runs after the correction. Full Bun 1.4.2 verification then passed 74 tests and 507 assertions plus format, lint, type, and build checks. The resulting server hash is `7368ff823940c905830d98a6e9caed841feb0fb44fc1ef198b19037453a099c2`; the HTML, standalone JavaScript, and lazy media hashes remain the values recorded in the preceding section. The account evidence remains scoped to its recorded server artifact. Permanent host verification will use the deployed Firestore-backed service rather than this local SQLite fallback.
