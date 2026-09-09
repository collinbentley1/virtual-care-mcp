# UI content and host appearance revision

This revision follows the user's request to remove decorative embedded styling and repeated explanatory copy, plus the independent review summarized in [the content audit](verification-content-audit.md). It changes presentation and navigation, while preserving the visit commands, payment controls, and pending-save recovery path.

## Implemented decisions

| Issue | Revision |
| --- | --- |
| Prominent logo, page banner, footer warnings, and duplicate section labels displaced the task. | Replace them with one compact Demo visit label. Keep action-specific explanations where they affect a choice. |
| The fixed blue background and broad white card were separate from the host's appearance. | Use host font, color, border, and type-size variables with system defaults. Embedded page and shell backgrounds are transparent, with no surrounding card or shadow. The controller applies standard MCP Apps host context in the client. |
| Self-pay repeated price and no-transfer warnings across several blocks. | Show the amount, expiry, one no-transfer explanation, and the existing approval/decline/payment-option controls. Keep the resulting test receipt distinct from a real transfer. |
| Aftercare repeated provenance and billing details. | Keep the unsigned demo-summary label and the actual summary. Remove the duplicate warning box and repeated billing section from appointment details. Exported records retain their original provenance fields. |
| The intake screen exposed every optional field. | Group additional visit details and language/support preferences in native disclosures. Keep reason, goals, visit mode, larger text, and low-data preferences immediately accessible. Closed disclosures still submit their values. |
| Narrow navigation was difficult to read and hid the only route to cancellation during preparation. | Use a readable current-task label with an expandable Visit steps menu. Keep Visit details in the header at all sizes, leading to the existing cancellation action. |
| Explicit navigation could lose keyboard focus. | Focus the new main region after edit, return, step, and resume navigation. Background renders preserve the focused field and open intake disclosures. |
| Text mode displayed a large empty device area. | Mount the media panel only for audio or video. Text mode shows the conversation directly. The controller owns media-panel internals. |

The four consent fields, current payment command IDs, same-save retries, available-action checks, and the fallback that keeps Retry/Check visible while a save is pending remain in place. The saved visit-mode correction is preserved.

## Built-app browser verification

On September 9, 2026, the actual compiled MCP App ran in the independent standard AppBridge host on port 4321, with the copied backend on 4322 and a separate sandbox-proxy origin on 4324. These observations came from browser interactions and rendered DOM, with the host's safe protocol evidence used to check receipt counts and retry identity. The visit used fictional information only. The initial workflow enabled both null-field omission and promotion of tool errors to protocol errors.

| Check | Observed result |
| --- | --- |
| Narrow layout and larger text | A 430px browser viewport produced a 390px app viewport. App client width and scroll width both remained 390px through appointment, review, payment, ready, and the text room. The default larger-text size was 20px. |
| Optional intake disclosures | Reason and goals, medications, allergies, communication instructions, Spanish, interpreter preference, caregiver preference/name, text mode, and low-data preference all appeared correctly in the saved review after both optional disclosures had been closed before submission. |
| Keyboard navigation and cancellation | Enter on the compact header's Visit details button focused `main-content`; Return also focused the main region. In a second visit, the same header route exposed Cancel demo appointment at 390px and Enter saved a canceled state. |
| Uncertain payment save | The host executed approval, then dropped its response. Check saved visit showed the saved consent stage while retaining Retry same save and Check saved visit. Retry replayed the same tool, identical arguments, and identical proof. The receipt count stayed at one. |
| Stale cached payment quote | After the host silently changed payment to assistance, approving the old quote showed the current assistance result and a conflict explanation. No extra receipt appeared. Consent then saved normally and reached ready. |
| Saved text mode | Ready retained Text practice after consent. Entering the room showed the conversation with zero `.media-panel` elements and zero media-asset requests. A practice message saved and the visit completed. |
| Aftercare and downloads | The completed record retained the unsigned demo-summary provenance and showed assistance as the current payment path. The host validated and acknowledged the visit JSON and FHIR payloads with no resume credential included. A denied FHIR download produced browser/resume recovery guidance. These are host receipts; the fixture does not save files. |
| Initial host appearance | The light host supplied Arial, 17px, text `#3b2410`, and background `#fff8ed`. The app used that font, size, text color, and control colors. Computed HTML and body backgrounds were transparent. |
| Live host-context change | Switching to dark changed the app to Verdana, 19px, text `#e4f0f6`, dark color scheme, and the supplied control colors without recreating the visit. HTML and body remained transparent. Larger text scaled to 23.75px in dark and 21.25px in light; width and scroll width stayed 390px. Keyboard navigation still focused the main region. |
| Visible transparent background | After correcting only the fixture's nested iframe color schemes, dark initialization and live light/dark updates retained the host's background through the transparent app. The dark screenshot showed the host's dark blue canvas, with readable controls and no surrounding app card. |

The safe build panel confirmed the same artifact hashes before and after adding the host-theme fixture. Product source and compiled artifacts were not changed during this browser pass.

| Artifact | SHA-256 |
| --- | --- |
| `src/ui/main.ts` | `d46fd6a62dd13154e0667825a9eb44996ea6f6f785c2a17c23311fcac43a4d9b` |
| `public/styles.css` | `2b7ab1c32c887e1de5b3ea4d443e241c6a384bcbfc772e1ec9247cd4a802c5c5` |
| `dist/server.js` | `c6f4a2be63b4de8f3e01f0fc121ad3019fab3cc7fa16c5e0edb40db787eed8ba` |
| `dist/mcp-app.html` | `377771e74c4abec7a1a2715af8cfe007816a8ff22882cc5a5a0c5c5c9a698e65` |
| `dist/public/app.js` | `fc8eea7c066747fc601f31c6e3da1f92bb8c68fa644078ef2c5aff68d71f0674` |
| `dist/public/livekit.js` | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

## Verification boundary

UI typechecking passed before the combined build. These results verify the built app in a local standard MCP Apps host; they do not establish actual ChatGPT or Claude account behavior. Initial dark inspection exposed a fixture issue: its nested iframe color schemes differed, causing the browser to paint an opaque default canvas as required by the [CSS Color Adjustment specification](https://www.w3.org/TR/css-color-adjust-1/#color-scheme-effect). The protocol owner corrected the outer iframe, proxy root, and inner iframe color schemes without modifying the product document. Browser inspection then confirmed visible host backgrounds in both themes with the same product artifact hashes.

This pass did not request camera or microphone access, connect live media, print a physical page, or save a file through the host. Actual host/account and media verification are recorded separately by their owners. Historical verification documents retain their original artifact boundaries.

## Background-update focus correction

The subsequent source review found that an open Visit steps disclosure and keyboard focus were not retained when a same-visit host update rerendered the app. The initial immediate-control reproduction showed the menu closing and focus moving to the body; an optional intake summary remained open but lost focus, and the Text practice radio also lost focus. The focus part of that observation was confounded because clicking the immediate update control first moved focus into the host. It is not used as a clean before/after focus result. The missing stable focus identities and omitted progress disclosure were independently established in source, and the delayed fixture below verifies the corrected behavior while focus remains inside the app.

The correction in `src/ui/main.ts` records open disclosures throughout the app, gives progress and disclosure controls stable IDs, derives radio IDs from name/value, and assigns task action and form-submit buttons stable IDs. Recovery buttons also have stable IDs. Explicit navigation continues to focus the main region. The redundant consulting-body Visit details button was removed; the header retains that action.

The corrected source hash is `6553fdfb2dde730db351fcd82a9f8e52b751da05e5beca2ed841fb10665832f3`. Typechecking, formatting, lint, and the independent narrow source review passed. The stylesheet is unchanged.

The coordinated build was then copied into the same independent host. The protocol owner added a visible three-second delayed host-update control so the update could arrive while the user remained focused inside the app. This avoids the focus change caused by clicking an immediate host control. With null-field omission enabled, seven delayed same-visit updates preserved these rendered focus targets:

| Focus target | After the host update |
| --- | --- |
| Progress step | `visit-step-0`; progress disclosure remained open |
| Progress summary | `visit-steps-summary`; progress disclosure remained open |
| Appointment submit button | `appointment-form-submit` |
| Optional visit-details summary | `intake-other-summary`; disclosure remained open |
| Language/support summary | `intake-access-summary`; disclosure remained open |
| Text practice radio | `radio-mode-text`; still checked |
| Fictional-example action | `task-action-sample-intake` |

Enter on the step button, header Visit details, and Return to your visit each focused `main-content` with the requested screen visible. Saving the appointment also focused the main region. The host recorded eight tool-result notifications including initialization, one app mutation, saved intake at revision 8, and zero media-asset requests. No product changes were made during this check.

| Corrected compiled artifact | SHA-256 from the host build receipt |
| --- | --- |
| `server.js` | `9a74eea121b961389bf3af621a1219faed81125a714ba8f9e3e601d8bab9253d` |
| `mcp-app.html` | `3de6b0a7d2bf93a16478c7fb294ef1363ebb7320e53c366fac5f731776f07992` |
| `public/app.js` | `ab6fcddbaa3f09712d35ce0724325e4ed0f99bdc4a8cca1a0bf25f91b89d314a` |
| `public/livekit.js` | `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b` |

The focused corrected-build regression check passed. The earlier full-flow and appearance checks above retain their separate artifact boundary.

## Media-panel focus follow-up

The publication review found that the media panel's Join call and Preview devices buttons were recreated without stable identities when a background visit update reattached the panel. The root added stable IDs to all seven media controls without changing media behavior. On the final copied build, I ran a bounded audio visit and a bounded video visit with fictional information. I did not request camera or microphone access and did not attempt a real call.

| Check | Observed result |
| --- | --- |
| Audio consulting room | Join call and Preview devices were visible. A delayed same-visit host update arrived while Join call had focus; focus remained `media-join`, and both media controls remained present. The host recorded one media-asset request from the earlier attempted availability check; no device permission was requested in this focus pass. |
| Video consulting room | The saved Video mode opened the same visible call/device controls without device access. A delayed update while Join call had focus preserved `media-join`; a second delayed update while Preview devices had focus preserved `media-preview`. |
| Media IDs | The final video DOM contained `media-join`, `media-preview`, `media-microphone`, `media-camera`, `media-sound`, `media-stop`, and `media-browser`, with no duplicate IDs. |

The final media-ID build receipt reported `server.js` `9a74eea121b961389bf3af621a1219faed81125a714ba8f9e3e601d8bab9253d`, `mcp-app.html` `ee9b34728c8579b979a0b0284f2b2307572ca9c2af00b4a99473979b1eb2efb5`, `public/app.js` `6138b473bdb99b9fd6787ce59fb04a0a9963e019a5f32bd957549d99b7b8dd42`, and `public/livekit.js` `f03bec9888a204d73dc03702d8bebe416f1c31217661f04ff4ce9b690b37ba1b`. The corresponding `src/ui/media.ts` source hash is `bcda9611454c650d43b3ea0da41842f3889e42188ec2f279eb6fbf9d8d4d5003`. This later build supersedes the earlier corrected-build hashes only for this media-ID follow-up; earlier records retain their original artifact boundaries.
