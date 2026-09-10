# Public source hygiene review

The opening section records an initial prepublication checkpoint and is superseded by the final review and pin-closure evidence below. It was reviewed September 9, 2026, when 74 files were eligible for publication according to Git, excluding `node_modules`, `dist`, `.git`, and `.local`. The repository had no initial commit, and integration was still in progress. The changing UI export implementation was excluded from that implementation review.

No real credential, private key, JWT, personal home path, binary artifact, or symlink was found in the publication candidates. The credential-literal matches were explicit fictional values in `test/host/server.ts:31-32` and `test/persistence.test.ts:127,132`. The host fixture uses loopback and a deliberately unavailable local media port. None of those values is represented as a usable production credential.

## Initial findings

### 1. Replace the provisional platform pins before enabling delivery — resolved

Initial priority P2. Locations included `.github/workflows/application.yml:21`, `.github/workflows/deploy-prod.yml:15,29`, `infra/terraform/bootstrap/main.tf:2,12`, and `infra/terraform/prod/main.tf:2`. The other reusable-workflow callers used the same provisional SHA.

At that checkpoint, the files referenced `d4c1bcf6e5700d2a4f75d96b9e09eb122e4d1672`. That source predated the new repository registration and kept the canonical scanner's package ceiling at 128. This application's reviewed lock has 135 entries and its mirrors include the new app contract. The checked-in local scanner and newer mirrors therefore could not establish that the pinned delivery source supported this application.

The final section records this finding's closure against merged platform commit `d0d1a3af340acb712caa5a1c83283a0387c87571`. Delivery activation remains a separate gate.

### 2. Correct the origin selection instruction in the deployment runbook — resolved

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

The earlier origin-selection finding is corrected. Platform PR 79 subsequently passed every required job at reviewed head `31626209e4ff51bf200465f11559fda1fb1b1c9e` and merged as `d0d1a3af340acb712caa5a1c83283a0387c87571`. At that publication checkpoint, every caller, Terraform module, and active-workflow value used that immutable merge SHA. [Platform PR 81](https://github.com/collinbentley1/platform/pull/81) later constrained the recovery nonce's Checkov exception and merged as `72fc2e8c48a07a106cfd040908f5dded2e958e43`; the active callers and Terraform modules now use that commit. The merged platform's canonical doctor accepted the complete application contract and exact repository identity. This closes the provisional-pin source finding; it does not establish production deployment.

The pin-update verification also exposed and corrected a concurrent SQLite startup race: the connection now establishes its busy timeout before asking SQLite to enter WAL mode. The existing process-pair test captured `SQLITE_BUSY_RECOVERY` before the fix and passed 100 consecutive runs afterward. Full verification then passed 74 tests and 507 assertions. GitHub Actions remain disabled and the DHI environment remains empty while the remaining enrollment and credentialless delivery gates are completed.
