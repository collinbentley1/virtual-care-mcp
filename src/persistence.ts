import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { commandIdSchema, instantSchema, visitSnapshotSchema } from "./contracts.ts";
import type { CareResult, VisitId } from "./contracts.ts";

export const storedVisitSchema = z.object({
	snapshot: visitSnapshotSchema,
	credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
	expiresAt: instantSchema,
	receipts: z.array(z.object({
		commandId: commandIdSchema,
		inputHash: z.string().regex(/^[a-f0-9]{64}$/),
		appliedRevision: z.number().int().positive(),
	}).strict()).max(256),
}).strict();
export type StoredVisit = z.infer<typeof storedVisitSchema>;
export type VisitMutation = { result: CareResult; next?: StoredVisit };
export interface VisitStore {
	create(record: StoredVisit): Promise<boolean>;
	transact(id: VisitId, update: (current: StoredVisit | null) => VisitMutation): Promise<CareResult>;
	close(): void;
}
export class StoreUnavailable extends Error {
	constructor() { super("The saved visit is temporarily unavailable."); }
}

export function createMemoryStore(): VisitStore {
	const visits = new Map<VisitId, StoredVisit>();
	return {
		async create(record) {
			for (const [id, visit] of visits) if (Date.parse(visit.expiresAt) <= Date.now()) visits.delete(id);
			if (visits.size >= 1000) throw new StoreUnavailable();
			if (visits.has(record.snapshot.visitId)) return false;
			visits.set(record.snapshot.visitId, structuredClone(record));
			return true;
		},
		async transact(id, update) {
			const current = visits.get(id);
			const change = update(current ? structuredClone(current) : null);
			if (change.next) visits.set(id, structuredClone(change.next));
			return change.result;
		},
		close() { visits.clear(); },
	};
}

export async function createSqliteStore(path: string): Promise<VisitStore> {
	if (path !== ":memory:") await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
	const db = new Database(path, { create: true, strict: true });
	if (path !== ":memory:") {
		await chmod(path, 0o600);
		for (const suffix of ["-wal", "-shm"]) {
			try { await chmod(`${path}${suffix}`, 0o600); }
			catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
		}
	}
	db.exec("PRAGMA busy_timeout=5000");
	db.exec("PRAGMA journal_mode=WAL");
	db.exec("CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at TEXT NOT NULL)");
	db.exec("CREATE INDEX IF NOT EXISTS visit_expiry ON visits(expires_at)");
	const find = db.query("SELECT payload FROM visits WHERE id = ?");
	const insert = db.query("INSERT OR IGNORE INTO visits (id, payload, expires_at) VALUES (?, ?, ?)");
	const save = db.query("UPDATE visits SET payload = ?, expires_at = ? WHERE id = ?");
	const rowSchema = z.object({ payload: z.string() });
	const transaction = db.transaction((id: VisitId, update: (current: StoredVisit | null) => VisitMutation) => {
		const row = find.get(id);
		const current = row ? storedVisitSchema.parse(JSON.parse(rowSchema.parse(row).payload)) : null;
		if (current && current.snapshot.visitId !== id) throw new StoreUnavailable();
		const change = update(current);
		if (change.next) save.run(JSON.stringify(change.next), change.next.expiresAt, id);
		return change.result;
	});
	return {
		async create(record) {
			try {
				db.query("DELETE FROM visits WHERE expires_at <= ?").run(new Date().toISOString());
				return insert.run(record.snapshot.visitId, JSON.stringify(record), record.expiresAt).changes === 1;
			} catch { throw new StoreUnavailable(); }
		},
		async transact(id, update) {
			try { return transaction.immediate(id, update); }
			catch { throw new StoreUnavailable(); }
		},
		close() { db.close(); },
	};
}

const firestoreDocumentSchema = z.object({
	fields: z.object({ payload: z.object({ stringValue: z.string() }) }),
	updateTime: z.string().min(1),
});
const metadataTokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createMetadataTokenProvider(fetcher: Fetch = fetch): () => Promise<string> {
	let cached: { token: string; until: number } | null = null;
	return async () => {
		if (cached && Date.now() < cached.until) return cached.token;
		const response = await fetcher("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
			headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000), redirect: "error",
		});
		if (!response.ok || response.headers.get("Metadata-Flavor") !== "Google") throw new StoreUnavailable();
		const token = metadataTokenSchema.parse(await response.json());
		cached = { token: token.access_token, until: Date.now() + Math.max(0, Math.min(300, token.expires_in - 60)) * 1000 };
		return token.access_token;
	};
}

export function createFirestoreStore(options: {
	projectId: string;
	databaseId?: string;
	collection?: string;
	getToken?: () => Promise<string>;
	fetcher?: Fetch;
}): VisitStore {
	const project = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/).parse(options.projectId);
	const database = z.string().regex(/^(\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/).parse(options.databaseId ?? "(default)");
	const collection = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).parse(options.collection ?? "visits");
	const fetcher = options.fetcher ?? fetch;
	const getToken = options.getToken ?? createMetadataTokenProvider(fetcher);
	const databaseName = `projects/${project}/databases/${database}`;
	const documentName = (id: VisitId) => `${databaseName}/documents/${collection}/${id}`;
	const fields = (record: StoredVisit) => ({
		payload: { stringValue: JSON.stringify(record) },
		expiresAt: { timestampValue: record.expiresAt },
	});
	const request = async (path: string, init: RequestInit = {}) => fetcher(`https://firestore.googleapis.com/v1/${path}`, {
		...init,
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
		signal: AbortSignal.timeout(8000), redirect: "error",
	});
	return {
		async create(record) {
			try {
				const response = await request(`${databaseName}/documents:commit`, {
					method: "POST",
					body: JSON.stringify({ writes: [{
						update: { name: documentName(record.snapshot.visitId), fields: fields(record) },
						currentDocument: { exists: false },
					}] }),
				});
				if (response.status === 409 || response.status === 412) return false;
				if (!response.ok) throw new StoreUnavailable();
				return true;
			} catch { throw new StoreUnavailable(); }
		},
		async transact(id, update) {
			for (let attempt = 0; attempt < 5; attempt++) {
				try {
					const response = await request(documentName(id));
					if (response.status === 404) return update(null).result;
					if (!response.ok) throw new StoreUnavailable();
					const document = firestoreDocumentSchema.parse(await response.json());
					const current = storedVisitSchema.parse(JSON.parse(document.fields.payload.stringValue));
					if (current.snapshot.visitId !== id) throw new StoreUnavailable();
					const change = update(current);
					if (!change.next) return change.result;
					const committed = await request(`${databaseName}/documents:commit`, {
						method: "POST",
						body: JSON.stringify({ writes: [{
							update: { name: documentName(id), fields: fields(change.next) },
							currentDocument: { updateTime: document.updateTime },
						}] }),
					});
					if (committed.ok) return change.result;
					if (committed.status !== 409 && committed.status !== 412 && committed.status < 500) throw new StoreUnavailable();
				} catch {
					// A lost commit response may have saved the operation. Read its receipt before retrying.
					if (attempt === 4) throw new StoreUnavailable();
				}
			}
			throw new StoreUnavailable();
		},
		close() {},
	};
}

export async function createStoreFromEnv(env: Record<string, string | undefined> = process.env): Promise<VisitStore> {
	switch (env.VISIT_STORE ?? "sqlite") {
		case "memory": return createMemoryStore();
		case "sqlite": return createSqliteStore(env.VISIT_DATABASE_PATH ?? ".local/visits.sqlite");
		case "firestore": return createFirestoreStore({
			projectId: z.string().min(1).parse(env.FIRESTORE_PROJECT_ID),
			databaseId: env.FIRESTORE_DATABASE_ID,
			collection: env.FIRESTORE_COLLECTION,
		});
		default: throw new Error("VISIT_STORE must be memory, sqlite, or firestore.");
	}
}
