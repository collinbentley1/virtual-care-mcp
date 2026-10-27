# Virtual Care MCP

This is a public MIT project. Use Model Context Protocol and MCP Apps directly. Do not add the ChatGPT Apps SDK, `window.openai`, or a provider backend.

All current visits, clinician participation, after-visit notes, eligibility decisions, and payments are explicit simulations. Use fictional data in tests and screenshots. Keep patient information, credentials, video-room tokens, and payment authorizations out of logs and repository artifacts.

The controller coordinates colleagues using the model requested for the current work. Keep file ownership distinct and integrate through shared typed contracts. Do not change other platform consumers or dirty platform worktrees.

Use exact dependency and platform pins. Validate external data at transport boundaries. Verify actual built UI and MCP behavior, including retries and rejected transitions. Report local, pushed, deployed, and host-verified state separately.

<!-- platform-review-rules -->
## Code Review Rules

- Keep the frontend custom. Put reusable authentication, origin enforcement, and security behavior in the platform runtime; keep domain routes and UI here. Do not edit .platform files directly: consume a reviewed platform upgrade.
- Check actual user ownership and isolation on every protected operation. Account deletion and session revocation require recent authentication. Emulator authentication must never reach Cloud Run. Keep logs free of credentials, email addresses, request bodies, and action codes.
- Prefer the existing managed provider, CodeQL, Socket, and Playwright to additional custom gates. Preserve scale-to-zero and budget limits. Flag consequential defects; leave formatting and lint to CI.
<!-- /platform-review-rules -->
