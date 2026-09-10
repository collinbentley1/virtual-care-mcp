# Codex card verification

This report records the September 9, 2026 local verification of the in-context card build. It used the built MCP app HTML with SHA-256 `23dfb68a278582bdb5efee542d904c350c5c52b4c945073044da3b8a9c37dd2b`. Subsequent documentation-only commit amendments did not change those bytes.

## Installed plugin flow

A personal Codex plugin pointed to an HTTP MCP server bound to loopback. The server used an isolated memory store, fictional data, and no configured LiveKit room. A fresh projectless Codex task named `Test installed Virtual Care MCP cards` completed one postpartum flow through the installed plugin.

The task selected the earliest sample slot, September 10 at 9:00 a.m., with New York and `America/New_York` as the fictional location. It saved a postpartum check-in reason while leaving the optional medications and allergies fields empty, selected demo assistance, saved all four required simulation acknowledgments, began a video-mode practice consultation, finished it, and resumed the completed record at revision 6.

The successful workflow calls were:

- `care_start`
- `care_book_appointment`
- `care_save_intake`
- `care_choose_payment`
- `care_accept_demo_consent`
- `care_begin_consultation`
- `care_finish_consultation`
- `care_resume`

All four focused card tools succeeded. The appointment projection contained the booked sample slot, the consultation projection contained the active video-mode visit, the after-visit projection contained the saved scripted summary, and the postpartum projection used the title `Your next care steps`.

This proves that an actual Codex task discovered the installed plugin, completed the model-led workflow, and received schema-valid data for each card. Codex prevents a task from inspecting its own window, so the task could not independently confirm the inline pixels. The run did not test device permissions, a real media room, persistent storage, or a public endpoint.

## AppBridge visual and recovery check

A separate local harness loaded the same built HTML through the real AppBridge and real MCP calls. It displayed all four card kinds at a 320-pixel host width in dark mode and large-text mode without horizontal overflow. The embedded document stayed transparent. A saved large-text preference produced 20-pixel body text; combining it with the harness's larger host font produced 27.5-pixel body text.

The harness also exercised an uncertain-save recovery. A postpartum task update committed as revision 7, and the harness deliberately dropped the first refresh response after execution. The card retained a `Refresh card` action and keyboard focus. Activating that action called the read-only maternal-plan tool, restored revision 7, cleared the recovery message, and returned focus to an enabled control. Replaying the original mutation arguments remained idempotent, and an older result did not replace newer card state.

These checks establish the built card layout and recovery behavior in the local AppBridge harness. They do not establish rendering of this build in hosted ChatGPT or Claude. The earlier shared-visit build has separate [host-account evidence](verification-host-accounts.md); the current cards require fresh hosted verification after deployment.

## Cleanup

The loopback MCP server and card harness were stopped after the checks. The personal plugin remained installed, but its loopback endpoint was offline. No real appointment, clinical service, insurance decision, payment, or patient record was created.
