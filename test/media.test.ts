import { describe, expect, test } from "bun:test";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { commandIdSchema, credentialSchema, type CareClient, type CareResult, type MediaResult, type VisitCommand } from "../src/contracts.js";
import { createMediaService } from "../src/media.js";
import { createMemoryStore } from "../src/persistence.js";
import { createCareService } from "../src/visit.js";

const at = "2026-09-09T12:00:00.000Z";
const config = () => ({ serverUrl: "ws://127.0.0.1:7880", apiKey: "test-issuer", apiSecret: crypto.randomUUID() + crypto.randomUUID() });
function envelope(result: CareResult) {
	if (result.kind !== "ok") throw new Error("Fixture operation failed.");
	return result.envelope;
}
function grant(result: MediaResult) {
	if (result.kind !== "livekit") throw new Error("Expected a media grant.");
	return result;
}

async function fixture(mode: "audio" | "video" | "text" = "video") {
	const store = createMemoryStore();
	let now = new Date(at);
	const care = createCareService({ store, now: () => now });
	let current = envelope(await care.start({ scenarioId: "older-adult" }));
	const send = async (command: VisitCommand) => {
		current = envelope(await care.advance({ credential: current.credential, expectedRevision: current.snapshot.revision, commandId: commandIdSchema.parse(crypto.randomUUID()), command }));
		return current;
	};
	await send({ kind: "choose_appointment", slotId: "slot-1", locationState: "NY", timeZone: "America/New_York" });
	await send({ kind: "save_intake", access: current.snapshot.access, intake: { reason: "Fictional software rehearsal", goals: "", medications: "", allergies: "", communicationNotes: "" } });
	await send({ kind: "select_payment", choice: { kind: "assistance" } });
	await send({ kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: true, understandsSimulation: true, telehealthAcknowledged: true, locationConfirmed: true });
	return { care, store, send, current: () => current, input: () => ({ credential: current.credential, mode: mode === "text" ? "audio" : mode }), enter: () => send({ kind: "enter_consultation", mode }), now: () => now, setNow: (value: string) => { now = new Date(value); } };
}

const claimSchema = z.object({
	iss: z.string(), sub: z.string(), iat: z.number(), nbf: z.number(), exp: z.number(),
	video: z.object({ room: z.string(), roomJoin: z.literal(true), canPublish: z.literal(true), canSubscribe: z.literal(true), canPublishSources: z.array(z.enum(["camera", "microphone"])), canPublishData: z.literal(false), canUpdateOwnMetadata: z.literal(false), roomCreate: z.literal(false), roomList: z.literal(false), roomAdmin: z.literal(false), roomRecord: z.literal(false), ingressAdmin: z.literal(false) }).strict(),
}).strict();
function decode(token: string) {
	const segments = token.split(".");
	const [header, body, signature] = z.tuple([z.string(), z.string(), z.string()]).parse(segments);
	return { header: z.object({ alg: z.literal("HS256"), typ: z.literal("JWT") }).strict().parse(JSON.parse(Buffer.from(header, "base64url").toString())), body: claimSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString())), signature: Buffer.from(signature, "base64url"), unsigned: `${header}.${body}` };
}

describe("LiveKit participant grants", () => {
	// Source contract: https://docs.livekit.io/frontends/reference/tokens-grants/
	// Independent HMAC verification checks the emitted HS256 bytes, not a copied signer.
	test("authenticates and requires consultation even when media is unconfigured", async () => {
		const f = await fixture();
		try {
			const media = createMediaService({ care: f.care, now: f.now });
			expect((await media.join(f.input())).kind).toBe("error");
			await f.enter();
			expect(await media.join(f.input())).toMatchObject({ kind: "practice", reason: "unconfigured" });
			const wrong = credentialSchema.parse(`vcm_${crypto.randomUUID()}.${"A".repeat(43)}`);
			expect((await media.join({ credential: wrong, mode: "video" })).kind).toBe("error");
		} finally { f.store.close(); }
	});
	test("signs a short opaque room grant and assigns separate identities to two testers", async () => {
		const f = await fixture();
		try {
			await f.enter();
			const settings = config();
			const media = createMediaService({ care: f.care, config: settings, now: f.now });
			const [first, second] = await Promise.all([media.join(f.input()), media.join(f.input())]);
			const a = grant(first), b = grant(second);
			const decoded = decode(a.token);
			const expected = createHmac("sha256", settings.apiSecret).update(decoded.unsigned).digest();
			expect(timingSafeEqual(decoded.signature, expected)).toBeTrue();
			expect(decoded.body.exp - decoded.body.iat).toBe(120);
			expect(decoded.body.nbf).toBe(decoded.body.iat);
			expect(decoded.body.iss).toBe(settings.apiKey);
			expect(decoded.body.video.room).toBe(a.roomName);
			expect(decoded.body.video.canPublishSources).toEqual(["camera", "microphone"]);
			expect(a.roomName === b.roomName).toBeTrue();
			expect(a.participantIdentity !== b.participantIdentity).toBeTrue();
			expect(a.roomName.includes(f.current().snapshot.patientDisplay)).toBeFalse();
			expect(JSON.stringify(decoded.body).includes(f.current().credential)).toBeFalse();
			expect(JSON.stringify(decoded.body).includes(settings.apiSecret)).toBeFalse();
			const saved = envelope(await f.care.resume({ credential: f.current().credential }));
			expect(JSON.stringify(saved.snapshot).includes(a.token)).toBeFalse();
			expect(saved.snapshot.revision).toBe(f.current().snapshot.revision);
		} finally { f.store.close(); }
	});
	test("audio cannot gain a camera grant and text mode remains practice", async () => {
		for (const mode of ["audio", "text"] as const) {
			const f = await fixture(mode);
			try {
				await f.enter();
				const media = createMediaService({ care: f.care, config: config(), now: f.now });
				const result = await media.join(f.input());
				if (mode === "text") expect(result).toMatchObject({ kind: "practice", reason: "text-mode" });
				else {
					expect(decode(grant(result).token).body.video.canPublishSources).toEqual(["microphone"]);
					expect((await media.join({ ...f.input(), mode: "video" })).kind).toBe("error");
				}
			} finally { f.store.close(); }
		}
	});
	test("video can request an audio-only grant", async () => {
		const f = await fixture();
		try {
			await f.enter();
			const media = createMediaService({ care: f.care, config: config(), now: f.now });
			expect(decode(grant(await media.join({ ...f.input(), mode: "audio" })).token).body.video.canPublishSources).toEqual(["microphone"]);
		} finally { f.store.close(); }
	});
	test("caps grant expiry at visit expiry and refuses closed or expired visits", async () => {
		const f = await fixture();
		try {
			await f.enter();
			const media = createMediaService({ care: f.care, config: config(), now: f.now });
			f.setNow("2026-09-10T11:59:30.000Z");
			const issued = grant(await media.join(f.input()));
			expect(issued.expiresAt).toBe(f.current().expiresAt);
			await f.send({ kind: "finish_consultation" });
			expect((await media.join(f.input())).kind).toBe("error");
			// Application completion cannot revoke an already issued self-hosted token.
			expect(decode(issued.token).body.exp > Math.floor(f.now().getTime() / 1000)).toBeTrue();
			f.setNow("2026-09-10T12:00:00.000Z");
			expect((await media.join(f.input())).kind).toBe("error");
		} finally { f.store.close(); }
	});
	test("a finish racing with grant preparation discards the grant", async () => {
		const f = await fixture();
		try {
			await f.enter();
			let reads = 0;
			const racingCare: CareClient = {
				...f.care,
				async resume(input) {
					const result = await f.care.resume(input);
					if (reads++ === 0) await f.send({ kind: "finish_consultation" });
					return result;
				},
			};
			const media = createMediaService({ care: racingCare, config: config(), now: f.now });
			expect((await media.join(f.input())).kind).toBe("error");
			expect(reads).toBe(2);
		} finally { f.store.close(); }
	});
	test("rejects non-loopback plaintext servers, URL credentials, and weak secrets without disclosing values", () => {
		const care = createCareService({ store: createMemoryStore() });
		for (const serverUrl of ["ws://media.example", "https://media.example", "wss://user:password@media.example", "wss://media.example?token=secret"]) expect(() => createMediaService({ care, config: { ...config(), serverUrl } })).toThrow("Invalid LiveKit configuration");
		expect(() => createMediaService({ care, config: { ...config(), apiSecret: "short" } })).toThrow("Invalid LiveKit configuration");
	});
});
