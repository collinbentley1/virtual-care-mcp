# Independent platform registration review

Reviewed September 9, 2026. Target repository is `collinbentley1/platform`, branch `feat/virtual-care-mcp`. Final source under review is `26db49e7ade09d5e7d97e4aeb0b1a1b414cc7a17`, tree `717621919a8b4cb6804bc52fbef5b3fd1fa2b2a6`, against base `5e4802bc5b373c0a5061b3c89f617ff4600b8218`. The authoring checkout was clean at the final inspection. Final verification runs from a git archive of the exact commit, independent of later working-tree changes.

Verdict: approved for the exact source commit above; no remaining must-fix defect was found. This review does not authorize or claim a cloud apply, state migration, merge, activation, or deployed application.

## Corrected deployment blocker

Initial head `9f5eb15c6afacf9a5a1e2bf8d9a9dabc349416f3` omitted `PUBLIC_BASE_URL` from production and preview configuration. The real app handler then used `http://localhost:8080`. A local reproduction against a simulated deployed host returned `/livez=200`, `/=403`, and `/mcp=403`. Health alone would have missed the broken application.

The reviewed successor fixes the Terraform production configuration, its mirror, both deployment workflows, and the exact parity checks. Production receives `https://virtual-care-mcp-894875537243.us-east4.run.app`; each preview receives its own `pr-N` tagged origin. The production workflow verifies the canonical URL in the exact v2 service's advertised `urls` before and after deployment. It permits the older hash-based primary alias without using that alias as the application's origin. Google's [service URL documentation](https://docs.cloud.google.com/run/docs/triggering/https-request) defines the deterministic tagged format; its [v2 Service reference](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services) defines `urls` as the service's traffic-serving URLs.

Local probes of the actual application handler at both configured origins returned `/=200`, MCP initialization `=200`, and foreign-host requests `=403`. The inspected app server SHA-256 was `eabfafe9dd241b40d45a2262611aae8e5a3d3f5c76b152ba49db6c89e8c428d6`.

## Boundaries checked

- Deployment resolvers bind repository `1362801465` to project `virtual-care-mcp`, number `894875537243`. Unknown IDs fail before operational selection. Terraform mirrors reject project redirection, role expansion, and a substituted platform pin.
- Only that repository receives the 135-package limit. Existing and unknown repositories retain 128. CI compares configuration against the immutable event repository ID before installation; the canonical scanner additionally matches app, project, and service, and scans every package. The seven-day age policy and exact dependency requirements remain unchanged.
- Fresh enrollment has no project/repository selector, uses the same `module.bootstrap` addresses as registered bootstrap, and fixes federation quarantine to true. The runbook requires owner-only state, exact lineage/resource inspection, remote migration, and a no-change bootstrap plan before provisioning production. No live state transfer was performed or proven by this review.
- Production alone receives `roles/datastore.user`. Preview uses a separate identity, memory storage, and no production data configuration. The new preview IAM audit checks only the new project; legacy auditor memberships retain their existing four identities. Firestore Native storage and `visits.expiresAt` TTL are declared, with TTL permissions explicitly scoped.
- `REPOSITORY_NAMES`, the legacy protected bootstrap implementation, and `PRODUCTION_APPLY_ENABLED=false` remain unchanged. No existing consumer pin was changed by this registration.

## Verification and remaining live gates

Final-archive format, lint, and TypeScript checks passed, along with 112 targeted tests and 1,576 assertions across eight files covering registration, dependency scanning, infrastructure preview, preview runtime IAM, waitlist runtime IAM, DHI parity, the preview controller, and preview traffic transactions. Terraform's two enrollment plans passed with a mocked Google provider using cached provider 7.45.0 and Terraform 1.14.5. Those tests ran against archived initial-head bootstrap sources, which are byte-for-byte unchanged at the final head. No cloud credentials or cloud mutations were used.

Live execution still needs the reviewed new-project plan, identity and billing checks, state-transfer equivalence, disabled WIF and effective IAM verification, Firestore TTL observation, protected GitHub environments, and exact caller/module pins before activation. After deployment, verify the advertised origins and actual MCP/UI behavior. Any source change requires review of its new exact commit.
