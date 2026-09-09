# Public source hygiene review

Reviewed September 9, 2026. Scope was the 74 files then eligible for publication according to Git, excluding `node_modules`, `dist`, `.git`, and `.local`. The repository had no initial commit, and integration was still in progress. This is a source checkpoint, not approval of a final published commit or a deployed service. The changing UI export implementation was excluded from implementation review.

No real credential, private key, JWT, personal home path, binary artifact, or symlink was found in the publication candidates. The credential-literal matches were explicit fictional values in `test/host/server.ts:31-32` and `test/persistence.test.ts:127,132`. The host fixture uses loopback and a deliberately unavailable local media port. None of those values is represented as a usable production credential.

## Findings

### 1. Replace the provisional platform pins before enabling delivery

Priority P2. Locations include `.github/workflows/application.yml:21`, `.github/workflows/deploy-prod.yml:15,29`, `infra/terraform/bootstrap/main.tf:2,12`, and `infra/terraform/prod/main.tf:2`. The other reusable-workflow callers use the same provisional SHA.

The files still reference `d4c1bcf6e5700d2a4f75d96b9e09eb122e4d1672`. That source predates the new repository registration and keeps the canonical scanner's package ceiling at 128. This application's reviewed lock has 135 entries and its mirrors include the new app contract. The checked-in local scanner and newer mirrors therefore cannot establish that the pinned delivery source supports this application. Delivery checks and repository resolution will fail before a usable deployment.

Replace every caller, module reference, and active workflow SHA with the final published, reviewed platform commit, then verify the generated mirrors and exact pin agreement before enabling Actions. `docs/research/platform.md:42-45` already identifies this as a pending integration gate. The independently reviewed local registration candidate is `26db49e7ade09d5e7d97e4aeb0b1a1b414cc7a17`; this report does not claim that it has been published, merged, or activated.

### 2. Correct the origin selection instruction in the deployment runbook

Priority P2. Location `docs/research/platform.md:172-173`.

The instruction says to set `PUBLIC_BASE_URL` from the actual service URI. The reviewed configuration instead binds production to `https://virtual-care-mcp-894875537243.us-east4.run.app` and verifies that origin among the Cloud Run v2 service's advertised `urls`. A service's primary URI can be a different hash-based alias. Substituting that alias would conflict with the exact environment parity check and could break origin-bound app behavior.

Change the instruction to retain the registered canonical origin and verify it in the authenticated service's `urls` before deployment. The correct production and preview rule is already described at `docs/research/platform.md:127-135` and in the independent platform review.

## Publication suitability and limits

The operational research document contains intended public project, repository, registry, state-bucket, and service-account identifiers. Those identifiers are configuration, and no billing-account identifier, human account email, private credential, or unrelated personal operational detail was found. State, plans, variable files, local visits, and environment files are excluded by the repository ignore rules. The runtime image uses explicit copies of the built application.

The README distinguishes simulation, local verification, public deployment, and actual host behavior. The billing report limits its FHIR claim to the published JSON schema and names the checks it does not perform. The media report limits its observed transport evidence to generated tracks in two local browser clients and explicitly excludes final-UI, public-network, and embedded-host verification. The research and architecture candidates are labeled as proposals or research, so their unimplemented alternatives are not completion claims.

No other publication blocker was found within this scope. Existing media and billing evidence was assessed for the accuracy of its stated boundaries; those experiments were not rerun here. Full application verification, live account state, final UI export checks, source publication, and cloud activation remain the controller's integration work. Rescan the final committed file set after integration.


## Final publication review

The final September 9 source review covered all 85 publication candidates. An independent reviewer and a controller scan found no literal scoped visit codes, provider tokens, private keys, personal home paths, or symlinks. The one intentional binary is the labeled fictional clinician clip; its hash, video metadata, provenance, and stated generation-model limits were checked. Private plans, state, local visit stores, temporary credentials, and test infrastructure remain excluded.

The independent reviewer found that media controls lacked stable IDs for keyboard-focus restoration when their panel was detached and reattached. The only corrective product change added unique IDs to those seven buttons. Independent review confirmed the correction, and the built UI then preserved focus on Join call and Preview devices through delayed host updates in both audio and video consulting rooms. The test requested no device permissions. The [UI report](verification-ui-content-revision.md) records the exact build and scope.

Final application verification passed 74 tests and 507 assertions, formatting, lint, types, and build checks. The [account report](verification-host-accounts.md) separates the tested ChatGPT/Claude artifacts from the subsequent media-ID-only correction and records actual delivery, failure, and cleanup boundaries. No additional publication blocker was found within this scope.

The earlier origin-selection finding is corrected. The provisional platform pin remains an explicit delivery gate: initial source publication does not enable delivery or establish production deployment. Every caller and Terraform module must adopt the actual reviewed merged platform commit before delivery activation. GitHub Actions were disabled and the DHI environment was empty during publication preparation.
