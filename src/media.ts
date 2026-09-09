import { z } from "zod";
import { mediaInputSchema, type CareClient, type MediaInput, type MediaResult } from "./contracts.js";

const liveKitConfigSchema = z.object({
	serverUrl: z.url().refine((value) => {
		const url = new URL(value);
		return !url.username && !url.password && !url.search && !url.hash &&
			(url.protocol === "wss:" || (url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
	}, "LiveKit requires wss, or ws on loopback for a local test."),
	apiKey: z.string().min(1).max(256),
	apiSecret: z.string().min(32).max(1024),
}).strict();
export type LiveKitConfig = z.infer<typeof liveKitConfigSchema>;
export type MediaService = { join(input: MediaInput): Promise<MediaResult> };

// LiveKit's documented JWT contract: https://docs.livekit.io/frontends/reference/tokens-grants/
// WebCrypto implements HS256; this module exposes only participant room-join grants.
export function createMediaService({ care, config, now = () => new Date() }: {
	care: CareClient;
	config?: LiveKitConfig;
	now?: () => Date;
}): MediaService {
	const parsedConfig = config === undefined ? undefined : liveKitConfigSchema.safeParse(config);
	if (parsedConfig && !parsedConfig.success) throw new Error("Invalid LiveKit configuration. Check the server URL and server-side credentials.");
	const liveKit = parsedConfig?.data;
	const key = liveKit ? crypto.subtle.importKey("raw", new TextEncoder().encode(liveKit.apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : undefined;
	return {
		async join(input) {
			const parsedInput = mediaInputSchema.safeParse(input);
			if (!parsedInput.success) return { kind: "error", message: "Media requires a valid demo credential and video or audio mode." };
			const result = await care.resume({ credential: parsedInput.data.credential });
			if (result.kind !== "ok") return { kind: "error", message: "Resume an unexpired synthetic visit before requesting media." };
			const { state } = result.envelope.snapshot;
			if (state.kind !== "consulting") return { kind: "error", message: "Media is available only during an active synthetic consultation." };
			if (state.consultation.mode === "text") return { kind: "practice", reason: "text-mode", message: "Text practice is active. The scripted demo transcript is not a live transcription." };
			if (state.consultation.mode === "audio" && parsedInput.data.mode === "video") return { kind: "error", message: "This consultation is audio-only. Request audio to join." };
			if (!liveKit || !key) return { kind: "practice", reason: "unconfigured", message: "Live calling is unavailable. Continue the practice visit. No clinician is connected." };
			const issuedAt = Math.floor(now().getTime() / 1000);
			const expiresAt = Math.min(issuedAt + 120, Math.floor(Date.parse(result.envelope.expiresAt) / 1000));
			if (expiresAt <= issuedAt) return { kind: "error", message: "This synthetic visit has expired. Start another practice visit." };
			const roomName = `demo-${state.consultation.id}-g${state.consultation.generation}`;
			const participantIdentity = `tester-${crypto.randomUUID()}`;
			const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
			const body = {
				iss: liveKit.apiKey, sub: participantIdentity, iat: issuedAt, nbf: issuedAt, exp: expiresAt,
				video: {
					room: roomName, roomJoin: true, canPublish: true, canSubscribe: true,
					canPublishSources: parsedInput.data.mode === "audio" ? ["microphone"] : ["camera", "microphone"],
					canPublishData: false, canUpdateOwnMetadata: false,
					roomCreate: false, roomList: false, roomAdmin: false, roomRecord: false, ingressAdmin: false,
				},
			};
			const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(body)}`;
			const signature = await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(unsigned));
			const latest = await care.resume({ credential: parsedInput.data.credential });
			if (latest.kind !== "ok" || latest.envelope.snapshot.state.kind !== "consulting" ||
				latest.envelope.snapshot.state.consultation.id !== state.consultation.id ||
				latest.envelope.snapshot.state.consultation.generation !== state.consultation.generation ||
				latest.envelope.snapshot.state.consultation.mode !== state.consultation.mode) {
				return { kind: "error", message: "The consultation changed while media access was prepared. Resume the visit." };
			}
			return { kind: "livekit", serverUrl: liveKit.serverUrl, token: `${unsigned}.${Buffer.from(signature).toString("base64url")}`, roomName, participantIdentity, expiresAt: new Date(expiresAt * 1000).toISOString() };
		},
	};
}
