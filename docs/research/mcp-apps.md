# MCP Apps protocol and host research

Research date: 2026-09-09. Scope: the public synthetic Virtual Care MCP application. Host documentation and release claims below reflect that date. Implementation pins have since been verified locally; browser harness evidence is recorded separately in [MCP verification](../verification-mcp.md). This research does not establish operation in ChatGPT or Claude.

## Recommendation

The implementation uses MCP Apps directly with exact pins `@modelcontextprotocol/ext-apps` 1.7.5, `@modelcontextprotocol/sdk` 1.30.0, and `zod` 4.4.3. On the research date, ext-apps 2.0.0 was the latest release, published one day earlier and below the platform's seven-day minimum package age. Both ext-apps majors use the stable 2026-01-26 wire protocol, so the eligible 1.7.5 pin preserves the standard host integration. The app serves bundled HTML through an explicit render tool and provides text tools for the synthetic visit. It uses neither `window.openai` nor the ChatGPT Apps SDK.

ChatGPT's current official documentation explicitly supports the open MCP Apps bridge. Claude documents interactive connectors on its web, desktop, Cowork, and mobile products. Those statements establish a supported integration route. They do not establish that this application's media flow works on any particular host. [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui), [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).

## Versions and dependency boundary

| Item | Verified state on 2026-09-09 | Implementation consequence |
| --- | --- | --- |
| Installed MCP Apps SDK | Exact 1.7.5; registry publication 2026-07-23. | Meets the package-age requirement and uses the stable MCP Apps protocol. |
| Installed MCP SDK | Exact 1.30.0; registry publication 2026-07-27. | Satisfies ext-apps 1.7.5's SDK ^1.29.0 peer requirement. |
| Installed Zod | Exact 4.4.3; registry publication 2026-05-04. | Compatible with the installed SDKs; shared schemas validate transport boundaries. |
| Latest MCP Apps release at research time | v2.0.0, released 2026-09-08; release commit `352f6ce`. | Below the seven-day minimum age on the research date. Its split client/core/server packages are not installed. |
| MCP Apps protocol | 2026-01-26 is stable; `draft` is development. | Use the stable bridge and negotiated host capabilities. |
| Cross-version interoperability | The v2 release notes report tests against published ext-apps 1.7.5 in both directions. | Host interoperability follows the wire protocol; local and actual-host tests remain separate evidence. |

Sources: [v1.7.5 manifest](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/package.json), [v2.0.0 release](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v2.0.0), [v2.0.0 manifest](https://github.com/modelcontextprotocol/ext-apps/blob/v2.0.0/package.json), [SDK upstream assessment](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3268), [Zod 4.4.3 release](https://github.com/colinhacks/zod/releases/tag/v4.4.3), [protocol documentation](https://apps.extensions.modelcontextprotocol.io/api/).

Delivery verified the exact registry publications and installed pins. The current application graph has 133 entries under the platform's installed-package counting rule and 135 total lockfile entries, including the optional LiveKit client. The application-specific allowance is tracked in [platform research](platform.md); the existing platform default of 128 remains unchanged. Package compatibility, source approval, and deployed policy are separate states.

The implementation uses Bun's bundler, HTTP server, and SQLite support. It does not add a frontend build framework, HTTP framework, or database wrapper. The optional LiveKit browser module is loaded separately when a live demo connection is requested.

For a later v2 migration, replace `@modelcontextprotocol/sdk` imports with the split client/core/server packages, use the Node adapter only on Node, use complete `z.object` schemas, require Zod >=4.2, and replace handler `extra.signal`/`extra.requestId` with `extra.mcpReq.signal`/`extra.mcpReq.id`. Keep tool metadata and the `ui/*` bridge unchanged. Rerun host and protocol tests after migrating. [v2 migration release notes](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v2.0.0).

## Protocol path and source trace

The public contract is a tool plus an HTML resource. The resource URI uses `ui://`; the content MIME type is `text/html;profile=mcp-app`. Put the resource URI in tool `_meta.ui.resourceUri`. Put CSP and browser permission requests in `_meta.ui` on the corresponding `resources/read` content item. Tool `visibility` can include `model`, `app`, or both. A UI-only tool is still subject to server authorization. The stable specification requires hosts to fetch the referenced URI and permits prefetching and caching; UI-only resources may be omitted from resource-list update notifications. This implementation therefore derives an immutable URI from the final HTML and resource metadata at server creation, so changed UI bytes or CSP produce a new cache key. A host may still require an explicit connector metadata refresh to discover the new tool URI. [Stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

The inspected implementations explain the boundary:

| Entry point | What the inspected source does | Repo usage |
| --- | --- | --- |
| `registerAppTool` | Delegates registration to the MCP server and normalizes nested `ui.resourceUri` with legacy `ui/resourceUri`. The legacy key is not `openai/outputTemplate`. | Use nested metadata. Use complete Zod objects rather than deprecated raw shapes. |
| `registerAppResource` | Supplies the MCP Apps MIME default and delegates the resource callback. | Return the bundled HTML with content-item metadata. Do not mistake registration for an HTTP HTML route. |
| `App` and `connect()` | Initialize the transport, negotiate `ui/initialize`, capture host capabilities/context, and send `ui/notifications/initialized`. The API says to register handlers first. | Register result, context, teardown, and error handlers before connecting. |
| Host capability access | `getHostCapabilities()` exposes tool proxy, link opening, context updates, and sandbox grants. Host context contains presentation information. | Inspect capabilities; do not infer permission from a host's name. |

Sources: [installed-version server helpers](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/src/server/index.ts), [app implementation inspected on main](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/app.ts), [App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html), [host capabilities](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostCapabilities.html).

The UI receives `ui/notifications/tool-input` and `ui/notifications/tool-result`; it calls tools with `app.callServerTool`, opens approved links with `app.openLink`, and can provide a concise selection summary through `app.updateModelContext`. Parse tool results using the same repository-owned schemas used by the server. Partial tool-input notifications are draft input, not a committed visit transition. Initialize all handlers before `connect()` so an early result is not lost. [App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html).

Use one render tool to open the visit UI, then let the UI invoke data tools and render their returned snapshots. Attaching UI resources to every mutation can remount the component. Temporary focus, expanded sections, and unsent input belong to the current UI instance; visit state belongs to the domain service. [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

Treat `content` and `structuredContent` as potentially model-visible. OpenAI documents both as model inputs, even though a best-practices sentence in the inspected MCP Apps specification describes `structuredContent` differently. Never place room credentials or payment authorization material in either. Use result `_meta` for UI-only ephemeral material where needed, and still treat it as data delivered to the host, not a private storage system. [OpenAI reference](https://developers.openai.com/plugins/reference).

## Camera, microphone, CSP, and fallback

MCP Apps defines camera and microphone permission requests. The host may honor them by granting iframe permissions; browser and operating-system permission still apply. A requested permission does not prove device access. The negotiated grant location is `app.getHostCapabilities()?.sandbox?.permissions`, not host context. [Permission type](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiResourcePermissions.html), [host capabilities](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostCapabilities.html).

The implementation requests camera and microphone capabilities, allows its exact public origin for the optional media module, and adds configured media signaling origins:

```ts
const uiPolicy = {
  permissions: { camera: {}, microphone: {} },
  csp: {
    connectDomains: configuredMediaOrigins,
    resourceDomains: [publicOrigin],
    frameDomains: [],
  },
};
```

`connectDomains` covers fetch and WebSocket requests; `resourceDomains` covers external assets; `frameDomains` permits selected nested frames. Bundle the UI and fonts locally where practical. A declared WebSocket origin alone does not prove that a WebRTC connection, ICE path, or TURN fallback will succeed. [CSP and CORS guidance](https://apps.extensions.modelcontextprotocol.io/api/documents/csp-and-cors.html).

CSP and CORS are separate controls. The HTML resource executes at a host sandbox origin, so relative fetches do not reach the MCP server. Prefer host-proxied tool calls for visit data. `_meta.ui.domain` is host-specific; the SDK guidance includes a Claude-derived sandbox domain, while OpenAI documents its own resource-domain behavior. Omit a custom domain until a demonstrated direct-network requirement needs it; never hardcode a Claude-specific domain for all hosts. [CSP and CORS guidance](https://apps.extensions.modelcontextprotocol.io/api/documents/csp-and-cors.html), [OpenAI reference](https://developers.openai.com/plugins/reference).

The following behavior is an application design recommendation:

1. Present video, audio-only, and text simulation choices before requesting device access.
2. Request `getUserMedia` only after a direct user gesture. Request only the devices the chosen mode needs.
3. Separate host denial, browser denial, missing device, and network failure in the UI. Provide one actionable next step for each.
4. Offer a top-level browser continuation through standard `ui/open-link`, plus text instructions when link opening is unavailable. Do not assume any host supports picture-in-picture or persistent background media.
5. Stop local tracks and disconnect media on leave and teardown. A displayed camera preview must not be described as a clinician connection.
6. Preserve captions, keyboard controls, large targets, explicit connection state, and a low-bandwidth path. Do not require video to finish the demonstration.

Actual ChatGPT and Claude camera/microphone behavior remains unverified. Public docs read in this assignment do not establish that both grant these capabilities across every device. Record an actual host/device matrix before claiming embedded calling works.

## Authentication and transport

Use a public HTTPS `/mcp` endpoint with Streamable HTTP. The MCP transport can reply to requests with JSON or SSE, while notification acceptance uses HTTP 202. An endpoint that does not offer a standalone SSE stream may return HTTP 405 to GET. Validate supplied origins and negotiated protocol headers. Do not use a process-local session map as visit persistence. [MCP 2025-11-25 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

The installed SDK 1.30.0 supplies `WebStandardStreamableHTTPServerTransport`. The Bun server creates a server and transport per request, returns JSON responses, and stores visits separately from the transport. Stdio may serve local developer clients; actual cloud-host verification requires a reachable remote endpoint. [SDK 1.x source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src/server).

Claude supports Streamable HTTP and is deprecating legacy HTTP+SSE. Its hosted remote connections originate from Anthropic's infrastructure, including when the user opens Claude Desktop. The server and OAuth discovery endpoints must be externally reachable. Claude's current building guide lists resource subscriptions as unsupported; do not make visit progress depend on them. [Claude building guide](https://claude.com/docs/connectors/building), [remote connector requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

MCP authorization belongs between the host and MCP server. The UI should call protected tools through the host without handling the host's access token. For protected requests, verify issuer, audience, expiry, and scopes. Publish protected-resource metadata and authorization-server metadata. The portable challenge is HTTP 401 plus `WWW-Authenticate` with a `resource_metadata` pointer. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [MCP Apps authorization guide](https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html).

Both hosts document authorization-code flow with S256 PKCE and discovery. Claude selects CIMD when the authorization server advertises CIMD and public-client token authentication using `none`; otherwise its other supported registration paths apply. Its resource identifier must match the entered MCP URL, including the path. [Claude authentication reference](https://claude.com/docs/connectors/building/authentication).

OpenAI currently supports CIMD, DCR, predefined clients, and PKCE. It also documents per-tool `securitySchemes` and a tool-result `_meta["mcp/www_authenticate"]` challenge. Those host-specific metadata conventions do not replace HTTP 401 for cross-host authorization. Match imports to the selected SDK major; some host examples still use SDK 1.x. [OpenAI authentication reference](https://developers.openai.com/plugins/build/auth).

For this synthetic demonstration, an unauthenticated entry path plus an opaque, scoped continuation can avoid a login requirement. That is a demo design decision, not a patient identity or medical authorization system. Actual patient accounts, revocation, and shared caregiver access require a separate authorization design.

## Streaming and payment boundaries

MCP SSE carries protocol messages, not teleconference media. The consultation adapter separates scripted simulation from an optional LiveKit/WebRTC connection. It must expose explicit connecting, connected, reconnecting, ended, and failed states. Network reconnection does not itself complete a visit or settle a payment. This research record supplies no evidence of a deployed LiveKit service or a successful media connection inside ChatGPT or Claude.

Claude currently states that purchases through third-party interactive connectors are unsupported. OpenAI's current UI guidance limits approved commerce to enabled categories and describes external checkout as the general route. Consequently, the x402 flow here must visibly simulate payment-required, approval, and settlement outcomes without accepting wallets, authorizing a transfer, or claiming a real receipt. Insurance eligibility, copays, claims, and after-visit documents remain fictional. [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude), [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

## Required implementation evidence

| Check | Evidence required |
| --- | --- |
| Package and protocol | Exact lockfile; SDK client performs initialize, tools/list, resources/read, tools/call, and error cases against the actual server. |
| Resource and bridge | Built HTML loads under a restrictive sandbox; input/result notifications hydrate the UI; UI calls use the standard bridge. |
| Host portability | The same resource opens in actual ChatGPT and Claude; typed mutations and text fallback complete the synthetic journey. |
| Media boundary | Record host/device permissions, denied-device path, audio-only behavior, external-browser fallback, and teardown. |
| Continuity | Reload, duplicate action, dropped response, expired continuation, and concurrent UI instances produce documented outcomes. |
| Claims | Label evidence as local, deployed, or host-verified. Do not infer one from another. |

All linked pages were inspected on 2026-09-09. Recheck mutable host documentation when performing account tests or adding authenticated and media-backed flows.
