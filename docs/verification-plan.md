# Verification plan

## Visit behavior

Exercise a complete fictional US visit through both MCP tools and the built UI. Select an appointment and physical location, save pre-visit information and access needs, inspect a cost estimate, choose a payment route, acknowledge consent, enter the room, complete the simulated consultation, and retrieve the after-visit record. Verify that a reload resumes the same visit and that a second client sees the latest state.

Run separate cases for insurance, simulated x402, financial assistance, caregiver participation, audio-only access, and a connection interruption. Replaying the same command must not duplicate the action. A stale conflicting command must produce a recoverable error.

## MCP Apps

Use the official MCP client to initialize, list tools, call the render tool, read its UI resource, and complete the visit. Check the standard UI metadata, HTML media type, UI message lifecycle, structured tool results, and readable text fallback. No OpenAI-specific runtime bridge is allowed.

Exercise real ChatGPT and Claude developer connections independently. A passing MCP client test does not prove that either host rendered the UI. Record the exact host, entry point, result, and any limitation. Verify the consultation fallback if the host does not permit camera or microphone use.

## UI and records

Inspect the built UI at a narrow chat width and full browser width. Use the keyboard for a complete journey, verify visible focus and announced errors, enlarge text, and check that content remains usable. Confirm print and downloadable records retain simulation labels and note provenance.

## Boundary behavior

Reject unknown visit credentials, expired visits, malformed commands, invalid state transitions, unsupported external origins, and oversized input. Concurrent clients must not overwrite each other's saved progress. Media join credentials must remain outside model-visible content and logs. Payment retries must remain isolated to the intended simulated purchase.

## Delivery

Run the repository's actual verification entrypoints, inspect immutable platform pins and workflow permissions, and record the exact source and deployed revision. Verify the deployed health endpoint and synthetic visit behavior. Public GitHub visibility, deployment, and host testing are separate checks.
