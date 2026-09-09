# UI verification

Verified locally on September 9, 2026, using the built standalone app and the Codex in-app browser. Only fictional information was entered. This record covers the UI; protocol, deployment, and production-host evidence are separate.

See [the controller's standalone verification](verification-standalone-controller.md) for the newer server's outage recovery and parsed export-file evidence.

## Observed workflows

- Rural sample: chose an appointment, Texas as the fictional location, and America/Chicago as the display time zone. Entered custom fictional reason and goals, requested a sample caregiver, and confirmed those values on the review screen.
- Coverage: inactive coverage, member not found, benefits unavailable, and prior authorization each returned a labeled simulated result and retained a way to choose another payment path.
- Self-pay: selected the declined fixture, observed the decline message, then approved the simulation through the dedicated payment exchange. Review showed the simulated $35 receipt and no real transfer.
- Consent and room: acknowledged all four consent items, entered the practice room, and requested an unconfigured live demo. The UI reported live calling unavailable and kept the scripted conversation usable.
- Older-adult sample: larger text was enabled, sample intake remained editable, and text practice completed without device permission. A scripted message survived a reload. The claim-denied fixture showed the separate simulated denial in the after-visit record.
- Resume: copied the synthetic resume value from its visible field into a separate tab. Keyboard submission reopened the completed visit with the same claim result. The value was not saved in this document.
- Downloads: the in-app browser's high-level download-event wait timed out, but its developer event stream subsequently observed an HTTP 200 FHIR response and a download named `practice-visit-fhir.json`. The controller separately verified actual JSON and FHIR files downloaded in Chrome from the newer port-3091 build and parsed their content.

## Accessibility and presentation

The desktop welcome screen and a 390-by-844 viewport were visually inspected. At 390 pixels with 21-pixel larger text, document width and scroll width were both 390 pixels. The mobile view displayed a horizontal visit-step list and readable single-column content. The temporary viewport override was reset afterward.

Keyboard Tab moved from the resume field to its submit button; Enter submitted the form. Tab moved between export controls. The inspected focused buttons had a visible 3-pixel outline. This is targeted keyboard verification, not a full accessibility audit or screen-reader certification.

The after-visit page retains its scripted, unsigned provenance. Printing expands closed appointment details before the print event and restores them afterward. A completed physical print or PDF export was not observed in this pass.

## Fixes and review boundary

- An actual opaque-sandbox startup check caught invalid empty browser-URL metadata reaching `new URL`. URL validation now rejects values that `URL.canParse` cannot parse; the protocol colleague subsequently observed the MCP Apps initialization and visit hydration succeed.
- Device cleanup invalidates pending preview and LiveKit connection attempts. Leaving the room stops devices; a late `getUserMedia` result has its tracks stopped. These cleanup changes were typechecked and reviewed; no real microphone or camera session was exercised here.
- The controller added standard `App.downloadFile` handling, capability detection, and host-denial fallback; `openLink` now checks `isError`. The final source was reviewed against the installed MCP Apps declarations. Host success and denial require the protocol colleague's separate harness evidence.
- The controller corrected saved-state messaging for pending writes and unsaved forms, and verified recovery through a local server outage and restart in Chrome.

The first port-3089 journeys used the server build loaded when that process started; static UI assets were rebuilt during review. They do not prove later domain changes, including the updated appointment-slot schedule. The review server was subsequently restarted from the final build. The controller's port-3091 verification covered the newer server artifact.

## Final UI source fingerprints

SHA-256 at handoff:

| File | SHA-256 |
| --- | --- |
| `src/ui/client.ts` | `80c331cb9bc18eb21ca82e09c8eca2a162975866defa5d2ac8fa6db6587c7341` |
| `src/ui/main.ts` | `b75f68e1fb1db3f3904a74aaf473d8df6b927829450a760b01e2bcfaa9b0d1c8` |
| `src/ui/media.ts` | `525efa8334d4a99de3f1ac11205ca76689eb51b50ed5dfba65300ab937fc736e` |
| `public/index.html` | `892157266f8e3d92ddc15aa5ff8cee1e4b4430538ed2076aac4408121ef91bbd` |
| `public/styles.css` | `d91e87902123cec817b5e5de62bb97d4cc7d6340059fadacd94c06e325b57c2a` |

The final local build produced a 427,010-byte self-contained MCP Apps document. UI typechecking passed before handoff; the controller reported the broader 66-test, 411-assertion verification run separately. No deployment or real commercial chat-host verification is claimed here. No live clinician, insurer, payment network, interpreter, caption service, or caregiver invitation was involved.
