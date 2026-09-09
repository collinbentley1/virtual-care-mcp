import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { commandIdSchema } from "../src/contracts.ts";
import type { CareResult, VisitEnvelope } from "../src/contracts.ts";
import { createFirestoreStore, createMetadataTokenProvider, createSqliteStore } from "../src/persistence.ts";
import type { Fetch, VisitStore } from "../src/persistence.ts";
import { createCareService } from "../src/visit.ts";

function saved(result: CareResult): VisitEnvelope {
	if (result.kind !== "ok") throw new Error("Expected a saved visit.");
	return result.envelope;
}
const fieldsSchema = z.object({ payload: z.object({ stringValue: z.string() }), expiresAt: z.object({ timestampValue: z.string() }) });
const writeSchema = z.object({ writes: z.tuple([z.object({
	update: z.object({ name: z.string(), fields: fieldsSchema }),
	currentDocument: z.union([z.object({ exists: z.literal(false) }), z.object({ updateTime: z.string() })]),
})]) });

function firestoreFixture() {
	const documents = new Map<string, { fields: z.infer<typeof fieldsSchema>; updateTime: string }>();
	let sequence = 0;
	let loseCommitResponse = false;
	let blockReads = 0;
	let readsWaiting = 0;
	let release: (() => void) | undefined;
	let barrier: Promise<void> | undefined;
	const writes: unknown[] = [];
	const fetcher: Fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		expect(url.origin).toBe("https://firestore.googleapis.com");
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
		if (url.pathname.endsWith("documents:commit")) {
			if (typeof init?.body !== "string") throw new Error("Commit body must be JSON.");
			const request = writeSchema.parse(JSON.parse(init.body));
			writes.push(request);
			const write = request.writes[0];
			const current = documents.get(write.update.name);
			if ("exists" in write.currentDocument ? Boolean(current) : current?.updateTime !== write.currentDocument.updateTime) return Response.json({ error: { status: "FAILED_PRECONDITION" } }, { status: 409 });
			const updateTime = `2030-09-09T14:00:00.${String(++sequence).padStart(6, "0")}Z`;
			documents.set(write.update.name, { fields: write.update.fields, updateTime });
			if (loseCommitResponse) { loseCommitResponse = false; throw new TypeError("Fixture lost the commit response."); }
			return Response.json({ writeResults: [{ updateTime }], commitTime: updateTime });
		}
		const current = documents.get(url.pathname.slice("/v1/".length));
		const result = current ? Response.json(structuredClone(current)) : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
		if (blockReads > 0) {
			readsWaiting++;
			if (readsWaiting === blockReads) { blockReads = 0; release?.(); }
			await barrier;
		}
		return result;
	};
	return {
		fetcher, writes, documents,
		loseNextCommit: () => { loseCommitResponse = true; },
		raceNextReads: (count: number) => { readsWaiting = 0; blockReads = count; barrier = new Promise<void>((resolve) => { release = resolve; }); },
	};
}

describe("Firestore REST contract, synthetic transport fixture", () => {
	test("creates with an absence precondition and atomically commits state with its receipt", async () => {
		const fixture = firestoreFixture();
		const store = createFirestoreStore({ projectId: "virtual-care-mcp", getToken: async () => "fixture-token", fetcher: fixture.fetcher });
		const care = createCareService({ store, now: () => new Date("2030-09-09T14:00:00.000Z") });
		const initial = saved(await care.start({ scenarioId: "rural-adult" }));
		const current = saved(await care.advance({ credential: initial.credential, expectedRevision: 0, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" } }));
		expect(current.snapshot.revision).toBe(1);
		expect(fixture.writes).toHaveLength(2);
		const create = writeSchema.parse(fixture.writes[0]);
		const update = writeSchema.parse(fixture.writes[1]);
		expect(create.writes[0].currentDocument).toEqual({ exists: false });
		expect(update.writes[0].currentDocument).toEqual({ updateTime: "2030-09-09T14:00:00.000001Z" });
		const payload = JSON.parse(update.writes[0].update.fields.payload.stringValue);
		expect(payload.snapshot.revision).toBe(payload.receipts[0].appliedRevision);
		expect(update.writes[0].update.fields.expiresAt.timestampValue).toBe(initial.expiresAt);
		expect(JSON.stringify(fixture.writes)).not.toContain(initial.credential);
	});

	test("a lost commit response rereads the receipt without a duplicate write", async () => {
		const fixture = firestoreFixture();
		const store = createFirestoreStore({ projectId: "virtual-care-mcp", getToken: async () => "fixture-token", fetcher: fixture.fetcher });
		const care = createCareService({ store, now: () => new Date("2030-09-09T14:00:00.000Z") });
		const initial = saved(await care.start({ scenarioId: "rural-adult" }));
		fixture.loseNextCommit();
		const result = await care.advance({ credential: initial.credential, expectedRevision: 0, commandId: commandIdSchema.parse(randomUUID()), command: { kind: "cancel_visit" } });
		expect(result.kind === "ok" && result.replayed).toBe(true);
		expect(saved(result).snapshot.revision).toBe(1);
		expect(fixture.writes).toHaveLength(2);
	});

	test("competing service instances preserve expected revision across CAS retries", async () => {
		const fixture = firestoreFixture();
		const options = { projectId: "virtual-care-mcp", getToken: async () => "fixture-token", fetcher: fixture.fetcher };
		const first = createCareService({ store: createFirestoreStore(options) });
		const second = createCareService({ store: createFirestoreStore(options) });
		const initial = saved(await first.start({ scenarioId: "older-adult" }));
		fixture.raceNextReads(2);
		const request = { credential: initial.credential, expectedRevision: 0, command: { kind: "set_access", access: initial.snapshot.access } } satisfies Omit<Parameters<typeof first.advance>[0], "commandId">;
		const results = await Promise.all([
			first.advance({ ...request, commandId: commandIdSchema.parse(randomUUID()) }),
			second.advance({ ...request, commandId: commandIdSchema.parse(randomUUID()) }),
		]);
		expect(results.filter((result) => result.kind === "ok")).toHaveLength(1);
		expect(results.filter((result) => result.kind === "conflict")).toHaveLength(1);
		expect(saved(await first.resume({ credential: initial.credential })).snapshot.revision).toBe(1);
	});

	test("malformed remote records fail closed with a generic recoverable error", async () => {
		const store = createFirestoreStore({ projectId: "virtual-care-mcp", getToken: async () => "fixture-token", fetcher: async () => Response.json({ fields: {} }) });
		const fixture = firestoreFixture();
		const initial = saved(await createCareService({ store: createFirestoreStore({ projectId: "virtual-care-mcp", getToken: async () => "fixture-token", fetcher: fixture.fetcher }) }).start({ scenarioId: "rural-adult" }));
		const result = await createCareService({ store }).resume({ credential: initial.credential });
		expect(result.kind === "error" && result.code).toBe("temporarily_unavailable");
	});
});

test("metadata token provider checks the metadata response and caches a short window", async () => {
	let requests = 0;
	const provider = createMetadataTokenProvider(async (input, init) => {
		requests++;
		expect(String(input)).toBe("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token");
		expect(new Headers(init?.headers).get("Metadata-Flavor")).toBe("Google");
		return Response.json({ access_token: "fixture-token", expires_in: 3600 }, { headers: { "Metadata-Flavor": "Google" } });
	});
	expect(await provider()).toBe("fixture-token");
	expect(await provider()).toBe("fixture-token");
	expect(requests).toBe(1);
	const untrusted = createMetadataTokenProvider(async () => Response.json({ access_token: "fixture-token", expires_in: 3600 }));
	await expect(untrusted()).rejects.toThrow("temporarily unavailable");
});

test("SQLite reserves its writer before reading and returns a conflict to another process", async () => {
	const directory = await mkdtemp(join(tmpdir(), "virtual-care-contention-"));
	const path = join(directory, "visits.sqlite");
	const initialStore = await createSqliteStore(path);
	const initial = saved(await createCareService({ store: initialStore }).start({ scenarioId: "rural-adult" }));
	initialStore.close();
	const childSource = `
import { Database } from "bun:sqlite";
import { readSync } from "node:fs";
import { createSqliteStore } from ${JSON.stringify(new URL("../src/persistence.ts", import.meta.url).pathname)};
import { createCareService } from ${JSON.stringify(new URL("../src/visit.ts", import.meta.url).pathname)};
function signal() {
	let line = "";
	const byte = Buffer.alloc(1);
	while (readSync(0, byte, 0, 1, null)) {
		if (byte[0] === 10) return line;
		line += byte.toString();
	}
	throw new Error("The parent closed the synchronization pipe.");
}
const config = JSON.parse(signal());
const store = await createSqliteStore(config.path);
const probe = config.role === "second" ? new Database(config.path) : null;
probe?.exec("PRAGMA busy_timeout=0");
process.stdout.write("ready\\n");
signal();
if (probe) {
	let locked = false;
	try { probe.exec("BEGIN IMMEDIATE"); probe.exec("ROLLBACK"); }
	catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY") throw error;
		locked = true;
	}
	process.stdout.write(locked ? "locked\\n" : "unlocked\\n");
	signal();
}
const activeStore = config.role === "first" ? {
	...store,
	transact(id, update) {
		return store.transact(id, (current) => {
			process.stdout.write("read\\n");
			signal();
			return update(current);
		});
	},
} : store;
const result = await createCareService({ store: activeStore }).advance({
	credential: config.credential, commandId: crypto.randomUUID(), expectedRevision: 0,
	command: { kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" },
});
process.stdout.write(JSON.stringify({ kind: result.kind, revision: "envelope" in result ? result.envelope.snapshot.revision : null }) + "\\n");
probe?.close();
store.close();
`;
	const spawn = (role: "first" | "second") => {
		const child = Bun.spawn([process.execPath, "-e", childSource], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		child.stdin.write(`${JSON.stringify({ path, role, credential: initial.credential })}\n`);
		const reader = child.stdout.getReader();
		const decoder = new TextDecoder();
		let buffered = "";
		const line = async () => {
			while (!buffered.includes("\n")) {
				const chunk = await reader.read();
				if (chunk.done) throw new Error("The child exited before its synchronization message.");
				buffered += decoder.decode(chunk.value, { stream: true });
			}
			const newline = buffered.indexOf("\n");
			const value = buffered.slice(0, newline);
			buffered = buffered.slice(newline + 1);
			return value;
		};
		return { child, line };
	};
	const first = spawn("first");
	const second = spawn("second");
	try {
		expect(await first.line()).toBe("ready");
		expect(await second.line()).toBe("ready");
		first.child.stdin.write("advance\n");
		expect(await first.line()).toBe("read");
		second.child.stdin.write("probe\n");
		expect(await second.line()).toBe("locked");
		first.child.stdin.write("commit\n");
		expect(await first.line()).toBe('{"kind":"ok","revision":1}');
		second.child.stdin.write("advance\n");
		expect(await second.line()).toBe('{"kind":"conflict","revision":1}');
		expect(await first.child.exited).toBe(0);
		expect(await second.child.exited).toBe(0);
	} finally {
		for (const { child } of [first, second]) { child.stdin.end(); child.kill(); }
		await Promise.all([first.child.exited, second.child.exited]);
		await rm(directory, { recursive: true, force: true });
	}
}, 10000);

test("SQLite protects new and existing sidecars in an already traversable directory", async () => {
	const directory = await mkdtemp(join(tmpdir(), "virtual-care-modes-"));
	await chmod(directory, 0o755);
	const path = join(directory, "visits.sqlite");
	const store = await createSqliteStore(path);
	let reopened: VisitStore | null = null;
	try {
		saved(await createCareService({ store }).start({ scenarioId: "rural-adult" }));
		const files = [path, `${path}-wal`, `${path}-shm`];
		for (const file of files) expect((await stat(file)).mode & 0o777).toBe(0o600);
		for (const file of files) await chmod(file, 0o644);
		reopened = await createSqliteStore(path);
		for (const file of files) expect((await stat(file)).mode & 0o777).toBe(0o600);
	} finally {
		reopened?.close();
		store.close();
		await rm(directory, { recursive: true, force: true });
	}
});
