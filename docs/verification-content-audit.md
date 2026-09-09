# Embedded UI and content review

September 9, 2026. Three independent Astra reviewers examined a fixed copy of the UI before the visual cleanup. This was a source review; rendered verification of the resulting build is recorded separately.

The intended experience is a visit inside the host chat, using its typography and appearance. The current task and next action should take precedence over branding, repeated explanations, and implementation details. Appointment, intake, coverage, consent, consultation, aftercare, accessibility preferences, and recovery remain functional.

## Accepted findings

| Finding | Independent agreement | Decision |
| --- | --- | --- |
| Fixed light colors and an outer page/card ignore host appearance. | 3 of 3 | Apply standard MCP Apps host styling initially and on changes. Use transparent outer surfaces and system fallbacks. |
| Branding, banners, footers, and mandatory introductory copy repeat the demo context. | 3 of 3 | Keep one compact demo context. Make supporting text optional; keep only information needed for the current decision and provenance on exported records. |
| Optional intake and support preferences lengthen the main path; several preparation screens appear as one static step. | 3 of 3 | Group optional inputs in accessible disclosures, retain their values, reuse the selected mode, and show the current task accurately. |
| Text mode keeps an empty media stage above the conversation. | 3 of 3 | Omit the device panel in text mode. Make media connection state and actions clear when media is selected. |
| Replacing navigation buttons loses keyboard position. | 2 of 3 | Focus the new task after explicit navigation; preserve input focus during background updates. |
| Small-screen layout hides the only preparation-time path to visit details and cancellation, and squeezes progress labels. | 1 of 3 | Keep details and resume reachable at every width. Use readable progress navigation. |

These are concrete changes to the existing experience. No reviewer proposed an additional disclaimer as a condition of approval. The original font stack already used system fonts; the identified gap was following the host's supplied typography and sizing.

## Verification requirements

Verify the actual built UI in an MCP Apps host with light and dark host styling, a narrow viewport, larger text, and keyboard navigation. Complete the visit and retain the existing payment recovery proof: a lost response followed by a read refresh must leave the exact-command retry available, and a stale quote changed by another client must return the current visit without applying a payment.

This review does not establish final visual verification, public deployment, real care, or completion of the separate generated-video streaming test.
