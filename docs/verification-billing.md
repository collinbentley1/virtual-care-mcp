# Billing verification

The billing adapter produces explicit insurance fixtures, a private `mock-exact` x402 payment simulation, and synthetic FHIR R4 exports. Nothing is submitted to a payer, facilitator, wallet, or blockchain.

The normal test suite exercises insurance uncertainty, authorization binding, separate eligibility and claim outcomes, complete snapshot retention, resource references, and required fields in the emitted FHIR subset:

```sh
bun test test/billing.test.ts
```

Those tests use this repository's narrow schemas. The optional check below also validates every exported Bundle and its individual resources against the published HL7 FHIR R4 JSON schema. It runs the real care service with a memory store and all eight billing scenarios. No saved user visit or credential is read or printed.

## Reproduce the published-schema check

Use Bun 1.4.0 and install this repository's reviewed lockfile as described in the README. The existing MCP SDK dependency graph contains Ajv 8.20.0. The verifier uses that installed copy and does not add a package, modify the lockfile, download a validator, or make a network request.

Fetch the published [FHIR R4 JSON schema archive](https://hl7.org/fhir/R4/fhir.schema.json.zip) into a temporary directory outside the repository. These hashes identify the exact source checked on September 9, 2026:

| File | SHA-256 |
| --- | --- |
| `fhir.schema.json.zip` | `75e5560da3cf503895a44c8ca7af17a83b4cca6c2cb5ba1883d2aec0d1cb5ac6` |
| `fhir.schema.json` | `2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01` |

Run these commands from the repository root. `shasum` is included with macOS; on other systems use an equivalent SHA-256 utility.

```sh
VCM_FHIR_DIR=$(mktemp -d)
curl --fail --location --proto '=https' --tlsv1.2 \
  https://hl7.org/fhir/R4/fhir.schema.json.zip \
  --output "$VCM_FHIR_DIR/fhir.schema.json.zip" &&
printf '75e5560da3cf503895a44c8ca7af17a83b4cca6c2cb5ba1883d2aec0d1cb5ac6  %s\n' \
  "$VCM_FHIR_DIR/fhir.schema.json.zip" | shasum -a 256 --check &&
unzip "$VCM_FHIR_DIR/fhir.schema.json.zip" fhir.schema.json -d "$VCM_FHIR_DIR" &&
bun tools/verify-fhir.mjs --schema "$VCM_FHIR_DIR/fhir.schema.json"
```

Check that the archive hash passes before extracting it. The verifier independently checks the extracted schema hash and the Ajv package name and version. It fails on an unreviewed replacement. The exact package bytes and transitive dependencies come from the reviewed `bun.lock` and `bun ci` installation; a matching package version alone is not an integrity check.

If a later MCP SDK update removes Ajv from the app's dependencies, provide the package directory from a separately reviewed validator toolchain:

```sh
bun tools/verify-fhir.mjs \
  --schema "$VCM_FHIR_DIR/fhir.schema.json" \
  --ajv-dir /absolute/path/to/verified-toolchain/node_modules/ajv
```

This alternate directory must contain the reviewed Ajv 8.20.0 installation with its resolved dependencies. The command does not install it. Do not add a production app dependency solely to restore this optional check. For the current repository, the default installed copy already satisfies the requirement.

## Result and limits

The reproduced check passed for all eight scenarios on September 9, 2026:

| Scenario | Resources, excluding the Bundle |
| --- | ---: |
| Active copay | 15 |
| Inactive coverage | 9 |
| Unknown member | 9 |
| Benefits unavailable | 9 |
| Prior authorization required | 9 |
| Claim denied | 15 |
| Self-pay | 8 |
| Financial assistance | 8 |

The verifier also removes required complex fields from the financial resources and checks that the published schema rejects each incomplete copy. These negative controls establish that the check detects missing fields, rather than merely accepting complete fixtures.

This is JSON schema validation against the base R4 resource definitions. It does not run a full FHIR validator, FHIRPath invariants, terminology validation, CARIN profiles, clinical review, payer eligibility checks, claim submission, cryptographic payment verification, or settlement. Ajv's optional `format` validation is disabled to match the original check; the published schema's own patterns and structural constraints still apply. See [FHIR's JSON validation guidance](https://hl7.org/fhir/R4/json.html#schema) for the schema's limits and other validation mechanisms.

The app uses project-owned fictional service and adjudication codes where appropriate. No CPT or X12 tables are bundled. `ClaimResponse.outcome: "complete"` means the mock adjudication completed; its disposition and adjudication amounts distinguish an approved claim from a denied claim. Active eligibility can therefore coexist with a later denied claim. Insurance records and simulated self-pay receipts remain separate.
