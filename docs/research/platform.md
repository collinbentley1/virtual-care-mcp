# Platform adoption

Source contract checked on 2026-09-09. Platform registration and Bun 1.4.2
merged through [PR #79](https://github.com/collinbentley1/platform/pull/79) as
[`d0d1a3af340acb712caa5a1c83283a0387c87571`](https://github.com/collinbentley1/platform/commit/d0d1a3af340acb712caa5a1c83283a0387c87571).
The reviewed source head passed every required CI job before the squash merge.

The source subsequently advanced through [PR #81](https://github.com/collinbentley1/platform/pull/81) as
[`72fc2e8c48a07a106cfd040908f5dded2e958e43`](https://github.com/collinbentley1/platform/commit/72fc2e8c48a07a106cfd040908f5dded2e958e43).
That change preserves the protected recovery correlation nonce while constraining its single Checkov exception to the exact reconcile caller, where the nonce can label only the run name.

[Platform PR #83](https://github.com/collinbentley1/platform/pull/83) declared the DHI token as an optional reusable-workflow secret and refreshed the verified Grype database. Its required PR and post-merge checks passed at S2, [`dbf956f3f9c2bbad252e2899e198ecf25c1cb64f`](https://github.com/collinbentley1/platform/commit/dbf956f3f9c2bbad252e2899e198ecf25c1cb64f). The [first S2 production attempt](https://github.com/collinbentley1/virtual-care-mcp/actions/runs/34545012179) then failed closed during DHI prefetch: the username was present and the token was empty. The build was skipped, the run was subsequently cancelled, and no application deployment occurred.

A [seven-case hosted probe](https://github.com/collinbentley1/virtual-care-mcp/actions/runs/34546519288) resolved an environment sentinel through the exact named caller expression. An optional declaration without a caller mapping, an omitted declaration, and an explicit empty mapping failed to resolve it. Broad inheritance also worked in the probe but remains forbidden by the delivery contract. This establishes the caller-mapping behavior; a successful production DHI login requires separate evidence.

[Platform PR #84](https://github.com/collinbentley1/platform/pull/84), merged as [`f857a58e3ecac63b2b3882809efbfb7136bfa6c3`](https://github.com/collinbentley1/platform/commit/f857a58e3ecac63b2b3882809efbfb7136bfa6c3), adds the exact named DHI mapping to five lifecycle jobs: production deploy, preview invalidation, preview deploy, cleanup, and reconciliation. Parser and lint checks bind each job to its approved reusable workflow and reject missing, empty, extra, or inherited secret mappings. Its [PR checks](https://github.com/collinbentley1/platform/actions/runs/34547827612) passed. The post-merge platform check, application pin activation, WIF transition, native production delivery, and live verification each require their own evidence.

## Registered identities

| Resource | Registered identity |
| --- | --- |
| Public repository | [`collinbentley1/virtual-care-mcp`](https://github.com/collinbentley1/virtual-care-mcp) |
| GitHub repository ID | `1362801465` |
| GitHub owner ID | `16823277` |
| Google Cloud project | `virtual-care-mcp` |
| Google Cloud project number | `894875537243` |
| Region and service | `us-east4`, `virtual-care-mcp` |

Keep GitHub Actions disabled throughout initial enrollment and environment setup.
The source contract requires a standalone project with billing enabled.

The registered source specifies production registry `site`, preview registry
`site-preview`, state buckets `virtual-care-mcp-tfstate` and
`virtual-care-mcp-tfstate-bootstrap`, and distinct production, preview, and
bootstrap runtime identities. The initial public entry point is the registered
Cloud Run HTTPS origin, verified through the authenticated service API before
deployment. The source contract requires no existing domain change.

## Immutable platform source

The predecessor platform main was
[`d4c1bcf6e5700d2a4f75d96b9e09eb122e4d1672`](https://github.com/collinbentley1/platform/commit/d4c1bcf6e5700d2a4f75d96b9e09eb122e4d1672).
Its Grype database expired on September 8. The registration branch incorporates
the original maintenance commit from
[PR #77](https://github.com/collinbentley1/platform/pull/77),
`5e4802bc5b373c0a5061b3c89f617ff4600b8218`, whose database was built September 8
at 06:30:10 UTC. That snapshot also expires after 48 hours; recheck it immediately
before image verification. The maintenance commit is now incorporated in the
merged platform source. This does not claim a successful application deployment.

The merged platform commit replaces the provisional platform pin in every
new-app workflow and Terraform module. Actions remain disabled until the
credentialless delivery gates and enrollment are complete.
Existing consumer pins and the four-project protected recovery group are outside
this enrollment. Their existing production-apply freeze remains in place.

The reviewed combined registration and Bun source head was
[`31626209e4ff51bf200465f11559fda1fb1b1c9e`](https://github.com/collinbentley1/platform/commit/31626209e4ff51bf200465f11559fda1fb1b1c9e),
which produced the squash commit named above.
The enrollment root requires explicit confirmation of independent storage
access and orders the preview auditor grant after its service account exists.
Each permitted project scope checks every registered preview identity, including
identities from the other audit group. The two new child-resource regression
cases fail against the prior helper and pass with the correction.

## Delivery contract

The platform registers the immutable repository ID in all deployment resolvers,
Terraform deployment roots, mirror validation, and Cloud Run policy helpers.
Scaffold generation renders registered apps from the reviewed Terraform contract:

```sh
bun --no-env-file tools/platform.ts scaffold virtual-care-mcp <reviewed-platform-sha> 1362801465 <absent-target-directory>
```

The generated contract includes:

- `.platform/config.json` with exact app, repository ID, project, region,
  service, and registry values.
- Eight callers for application checks, dependency updates, Socket, Terraform,
  deployment, and preview lifecycle. Every reusable workflow and Terraform
  module is pinned to the same full platform SHA.
- Byte-matched `Dockerfile`, `.dockerignore`, `bunfig.toml`, platform verification
  runner, Socket scanner, and provider locks. Docker uses verified local OCI
  contexts named `platform.invalid/*`; these are supplied by the platform build.
- Reviewed bootstrap and production Terraform mirrors. Privileged execution
  uses the platform-owned roots, not app-controlled Terraform.
- A server bundle at `dist/server.js`, static files in `dist/public`, and `/livez`
  returning `ok: true` plus the exact `PLATFORM_DEPLOY_NONCE` as `deployment` when
  configured.
- Terraform ignore rules that exclude state, saved plans, variable files, CLI
  configuration, and overrides while retaining provider lockfiles.

Developer scripts preserve the platform composition:

```text
verify = bun ci --no-env-file --ignore-scripts --registry=https://registry.npmjs.org && bun --no-env-file run verify:ci
verify:ci = bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build
```

The combined source requires Bun `1.4.2`, executable revision
`744846f844374847c902b5e7fd59b4342a51ef99`. The canonical container rejects a
different version or revision. The merged platform contract determines every
runtime and workflow pin before activation.
TypeScript is `7.0.2`, with wrapper and native lock entries matched to the
platform's reviewed lockfile.

## Dependency policy

The selected direct runtime pins are `@modelcontextprotocol/ext-apps@1.7.5`,
`@modelcontextprotocol/sdk@1.30.0`, `zod@4.4.3`, and `livekit-client@2.22.2`.
Official npm publication metadata placed all four outside the seven-day
resolution window at installation. MCP Apps 1.7.5 supports the selected
2026-01-26 wire contract; the September 8 release of 2.0.0 was unnecessary for
this app. No minimum-age exclusion was introduced.

The initial graph had 121 lockfile packages. Adding the official LiveKit client
produced 135. The registration therefore defines a 135-package ceiling solely
for repository ID `1362801465`; all existing and unknown repositories retain
128. Credentialless CI selects the ceiling from the immutable GitHub event and
rejects an app configuration that claims another ID. The local canonical scanner
recognizes the same exact app/project/service identity. It has no general cap
override. The Docker dependency stage receives only that non-secret config.

The frozen installation passed canonical public Socket scanning of 133 submitted
unique package resolutions and installed the 135-entry lock under the unchanged
seven-day policy. Three lock entries resolve to the same `content-type@2.1.0`
package, accounting for the difference. Required
external Socket checks, exact registry resolutions, SHA-512 integrity checks,
and the canonical scanner remain part of delivery verification.

## Durable synthetic visits

Production configuration is `VISIT_STORE=firestore`,
`FIRESTORE_PROJECT_ID=virtual-care-mcp`, `FIRESTORE_DATABASE_ID=(default)`, and
`FIRESTORE_COLLECTION=visits`. The registered database is Firestore Native in
`us-east4`; the `visits.expiresAt` field has a TTL policy. The production runtime
receives `roles/datastore.user`. Previews use `VISIT_STORE=memory` and have no
production data role. The new project's preview IAM auditor is scoped to its
own project; legacy auditor memberships are preserved.

Production `PUBLIC_BASE_URL` is the registered deterministic origin
`https://virtual-care-mcp-894875537243.us-east4.run.app`. The deployment controller
requires this exact origin in the authenticated Cloud Run v2 service's `urls`
before deploying and after readback. Each preview uses its exact
`https://pr-<number>---virtual-care-mcp-preview-894875537243.us-east4.run.app`
origin. Runtime parity rejects another PR's URL or localhost. These origins
follow Google's documented URL format; their actual live availability remains
a provisioning check.
[Cloud Run service URLs](https://docs.cloud.google.com/run/docs/triggering/https-request).

Cloud Run service identity supplies Google credentials to the server. Browser
code receives no Google service credential. Visit transitions use the observed
Firestore `updateTime` and bounded conflict retries. Persisting the state and
command result together supports idempotent retries after a lost response.
[Cloud Run service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity),
[Firestore preconditions](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition).

Resume capabilities and synthetic visit state remain bounded and expire in the
application. Firestore TTL provides eventual storage cleanup; it does not make
an expired document immediately unreadable. The server must reject expired
visits before returning or mutating them.
[Firestore TTL behavior](https://docs.cloud.google.com/firestore/native/docs/ttl).

The initial cloud contract provisions no provider, payment, or LiveKit secrets.
Optional real-media configuration requires its own bounded credential setup and
verification before being represented as available.

## Provisioning and live gates

The platform's fixed-identity `terraform/deployments/virtual-care-enrollment`
root uses the reviewed bootstrap module with federation disabled. Its inputs
are the reviewed platform SHA and explicit confirmation of verified independent
storage access. The corresponding README defines the owner-run plan, collision
checks, partial-state recovery, and transfer into the registered remote backend.

1. Finish exact registration review, platform verification, and app verification.
   Merge through the platform's required review process and freeze the final SHA.
2. Configure required app checks and protected environments before enabling
   Actions. External Socket checks must belong to GitHub App `156372`.
   Production and publication require owner review and no administrator bypass.
3. Review and apply the fixed new-project enrollment plan with owner-only local
   state. If a partial state exists, inspect it and prepare a fresh residual
   plan. After full convergence, transfer the same
   `module.bootstrap` resource addresses into bucket
   `virtual-care-mcp-tfstate-bootstrap`, prefix `virtual-care-mcp/bootstrap`.
   Require a no-change registered bootstrap plan while federation remains disabled.
4. Review and apply the registered production root against the new project only.
   Verify registries, Firestore TTL, separated runtime roles, and the no-role
   bootstrap revision. Keep `PUBLIC_BASE_URL` fixed to
   `https://virtual-care-mcp-894875537243.us-east4.run.app` and verify that exact
   origin appears in the registered service's authenticated v2 `urls` before
   final app deployment.
5. Review the separate new-project activation change. Require the active WIF SHA
   to equal all app workflow/module pins. Verify protected environments, exact
   provider claims and roles, and the no-role WIF canary before operational auth.
6. Deploy a verified image digest and record caller/platform SHA, workflow run
   and attempt, digest, Cloud Run revision, and matching `/livez` nonce. Verify
   MCP HTTP behavior, durable resume across a process or revision restart, and
   host UI behavior separately.

The ordinary infrastructure workflow verifies convergence; it cannot perform
first-time provisioning. Local tests, mirror validation, source publication,
cloud activation, and successful host interaction are separate evidence gates.
