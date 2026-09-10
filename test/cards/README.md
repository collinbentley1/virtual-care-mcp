# Visit card browser checks

Run `bun run build`, then `bun test/cards/server.ts`. Open `http://127.0.0.1:4335`.

This local test page displays the actual built MCP HTML through `AppBridge`. Its appointment, active consultation, completed summary, and postpartum plan come from real MCP calls against an isolated memory store. It does not use live patient data or a configured media room. Camera and microphone permissions are denied in the test iframe.

Use the card selector to inspect each card. Dark, large text, and 320 px controls exercise host-context and layout changes. The completed summary and maternal-plan fixtures also carry the visit's saved large-text preference, independent of the host control.

To check persistence and retries:

1. Open the maternal plan and complete a preparation task.
2. Add a fictional question, select “Drop next save response,” and save it.
3. Confirm the draft remains present. Choose “Retry save.”
4. Expand verification events. The same command should replay without adding a second question.
5. Replay the original older card result. The saved task and question should remain.
6. Reload the card to read the current backend state.

To check refresh recovery, select “Drop next refresh response” before changing a task. The save should succeed and leave a “Refresh card” action. That action should clear the old error after the next refresh succeeds.

The appointment action, consultation completion, summary export, and follow-up action record the messages and context they send to the test host. Messages are recorded locally instead of generating a model turn, and export records a receipt instead of saving a file. These checks do not establish rendering, device permissions, or live calls in Codex or another installed host. Test those separately after installing the app.
