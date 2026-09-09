import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { exportFhirRecord } from "../src/billing.ts";
import { createMemoryStore } from "../src/persistence.ts";
import { createCareService } from "../src/visit.ts";

const sourceUrl = "https://hl7.org/fhir/R4/fhir.schema.json.zip";
const expectedSchemaSha256 = "2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01";
const expectedAjvVersion = "8.20.0";
const scenarios = ["active-copay", "inactive", "unknown-member", "benefits-unavailable", "prior-authorization-required", "claim-denied", "self-pay", "assistance"];
const negativeFields = new Map([
	["Coverage", "payor"],
	["CoverageEligibilityRequest", "insurer"],
	["CoverageEligibilityResponse", "request"],
	["Claim", "insurance"],
	["ClaimResponse", "patient"],
	["ExplanationOfBenefit", "provider"],
]);

function successful(result) {
	if (result.kind !== "ok") throw new Error("A synthetic verification fixture failed. Run the domain tests first.");
	return result.envelope;
}

async function fixture(scenario) {
	const store = createMemoryStore();
	try {
		const care = createCareService({ store, now: () => new Date("2026-09-09T12:00:00.000Z") });
		let current = successful(await care.start({ scenarioId: "older-adult" }));
		async function send(command) {
			current = successful(await care.advance({ credential: current.credential, commandId: crypto.randomUUID(), expectedRevision: current.snapshot.revision, command }));
		}
		await send({ kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
		await send({ kind: "save_intake", access: current.snapshot.access, intake: { reason: "Fictional software rehearsal", goals: "", medications: "", allergies: "", communicationNotes: "" } });
		await send({ kind: "select_payment", choice: scenario === "self-pay" || scenario === "assistance" ? { kind: scenario } : { kind: "insurance", scenario } });
		if (current.snapshot.state.kind === "payment") await send({ kind: "simulate_payment", quoteId: current.snapshot.state.quote.id, outcome: "approve" });
		if (current.snapshot.state.kind === "consent") {
			await send({ kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
			await send({ kind: "enter_consultation", mode: "video" });
			await send({ kind: "finish_consultation" });
		}
		return exportFhirRecord(current.snapshot);
	} finally { store.close(); }
}

async function main() {
	const { values } = parseArgs({ options: { schema: { type: "string" }, "ajv-dir": { type: "string" }, help: { type: "boolean" } } });
	if (values.help) {
		process.stdout.write("Usage: bun tools/verify-fhir.mjs --schema /absolute/path/fhir.schema.json [--ajv-dir /path/to/ajv]\nSee docs/verification-billing.md for source hashes and setup. This command does not download files.\n");
		return;
	}
	if (!values.schema) throw new Error("Pass --schema with the official FHIR R4 JSON schema. See docs/verification-billing.md.");
	const schemaBytes = await readFile(resolve(values.schema));
	const schemaSha256 = createHash("sha256").update(schemaBytes).digest("hex");
	if (schemaSha256 !== expectedSchemaSha256) throw new Error("FHIR schema SHA-256 does not match the reviewed R4 source. Do not validate with an unreviewed replacement.");
	const official = JSON.parse(schemaBytes.toString("utf8"));
	const ajvDirectory = values["ajv-dir"] ? resolve(values["ajv-dir"]) : fileURLToPath(new URL("../node_modules/ajv/", import.meta.url));
	const manifest = JSON.parse(await readFile(resolve(ajvDirectory, "package.json"), "utf8"));
	if (manifest.name !== "ajv" || manifest.version !== expectedAjvVersion) throw new Error("Expected the reviewed Ajv 8.20.0 package. Install this repository's exact lockfile or provide --ajv-dir from a verified toolchain.");
	const { default: Ajv } = await import(pathToFileURL(resolve(ajvDirectory, "dist/ajv.js")).href);
	const draft6 = JSON.parse(await readFile(resolve(ajvDirectory, "dist/refs/json-schema-draft-06.json"), "utf8"));
	const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
	ajv.addMetaSchema(draft6);
	const validators = new Map();
	const observations = [];
	let negativeControls = 0;
	for (const scenario of scenarios) {
		const bundle = await fixture(scenario);
		for (const resource of [bundle, ...bundle.entry.map((entry) => entry.resource)]) {
			if (!validators.has(resource.resourceType)) {
				validators.set(resource.resourceType, ajv.compile({ $schema: official.$schema, $ref: `#/definitions/${resource.resourceType}`, definitions: official.definitions }));
			}
			const validate = validators.get(resource.resourceType);
			if (!validate(resource)) {
				const error = validate.errors?.[0];
				throw new Error(`${scenario} ${resource.resourceType} failed ${error?.keyword ?? "validation"} at ${error?.instancePath || "/"}. Fixture values omitted.`);
			}
			const field = negativeFields.get(resource.resourceType);
			if (field) {
				const incomplete = { ...resource };
				delete incomplete[field];
				if (validate(incomplete)) throw new Error(`Negative control failed: ${resource.resourceType} was accepted without its required ${field}.`);
				negativeControls++;
			}
		}
		observations.push({ scenario, resourceCount: bundle.entry.length, valid: true });
	}
	process.stdout.write(`${JSON.stringify({
		sourceUrl, schemaSha256, validator: `Ajv ${manifest.version}`, runtime: `Bun ${Bun.version}`,
		scope: "Published FHIR R4 draft-06 JSON schema. No FHIRPath, terminology, CARIN profile, clinical, payer, or payment validation.",
		negativeControls, observations,
	}, null, 2)}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : "FHIR verification failed."}\n`);
	process.exitCode = 1;
});
