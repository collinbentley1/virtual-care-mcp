import { resolve, sep } from "node:path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import {
	advanceInputSchema,
	careResultSchema,
	mediaInputSchema,
	mediaResultSchema,
	resumeInputSchema,
	startInputSchema,
	type CareResult,
} from "./contracts.js";
import { exportFhirRecord, syntheticFhirBundleSchema } from "./billing.js";
import { createMediaService } from "./media.js";
import { createMcpServer, paymentInputSchema, simulatePayment, type McpOptions } from "./mcp.js";
import { createStoreFromEnv } from "./persistence.ts";
import { createCareService } from "./visit.ts";

const maximumBodyBytes = 65_536;

export type RequestHandlerOptions = McpOptions & {
	browserHtml?: string;
	publicDirectory?: string;
	deploymentNonce?: string;
};

type JsonRead =
	| { kind: "ok"; value: unknown }
	| { kind: "error"; status: number; code: number; message: string };

async function readJson(request: Request): Promise<JsonRead> {
	if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
		return { kind: "error", status: 415, code: -32600, message: "Content-Type must be application/json." };
	}
	const contentLength = request.headers.get("content-length");
	if (contentLength !== null && Number(contentLength) > maximumBodyBytes) {
		return { kind: "error", status: 413, code: -32600, message: "Request exceeds the size limit." };
	}
	if (!request.body) {
		return { kind: "error", status: 400, code: -32700, message: "A JSON request body is required." };
	}
	const reader = request.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0;
	let text = "";
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > maximumBodyBytes) {
				await reader.cancel();
				return { kind: "error", status: 413, code: -32600, message: "Request exceeds the size limit." };
			}
			text += decoder.decode(part.value, { stream: true });
		}
		text += decoder.decode();
		const value: unknown = JSON.parse(text);
		return { kind: "ok", value };
	} catch {
		return { kind: "error", status: 400, code: -32700, message: "Invalid JSON request body." };
	} finally {
		reader.releaseLock();
	}
}

function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		},
	});
}

function invalidInput(): CareResult {
	return { kind: "error", code: "invalid_input", message: "Check the request fields and try again." };
}

function protocolError(status: number, code: number, message: string): Response {
	return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);
}

function methodNotAllowed(allow: string): Response {
	return new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });
}

export function createRequestHandler(options: RequestHandlerOptions): (request: Request) => Promise<Response> {
	const publicUrl = new URL(options.publicOrigin);
	if (!/^https?:$/.test(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
		throw new Error("publicOrigin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.");
	}
	const publicDirectory = options.publicDirectory ? resolve(options.publicDirectory) : undefined;
	const htmlHeaders = {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
		"Content-Security-Policy": [
			"default-src 'none'",
			"script-src 'self' 'unsafe-inline'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob:",
			"font-src 'self'",
			"media-src 'self' blob:",
			`connect-src 'self' ${(options.mediaConnectOrigins ?? []).join(" ")}`,
			"frame-src 'none'",
			"frame-ancestors 'none'",
			"base-uri 'none'",
			"form-action 'none'",
		].join("; "),
	};

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname === "/livez") {
			if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
			const body = options.deploymentNonce
				? { ok: true, deployment: options.deploymentNonce }
				: { ok: true };
			return request.method === "HEAD" ? new Response(null, { status: 200 }) : json(body);
		}
		if (url.pathname === "/livekit.js" && publicDirectory) {
			if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
			const file = Bun.file(resolve(publicDirectory, "livekit.js"));
			if (!await file.exists()) return json({ error: "Route not found." }, 404);
			return new Response(request.method === "HEAD" ? null : file, {
				headers: {
					"Content-Type": "text/javascript; charset=utf-8",
					"Access-Control-Allow-Origin": "*",
					"X-Content-Type-Options": "nosniff",
					"Cache-Control": "no-cache",
				},
			});
		}
		const suppliedOrigin = request.headers.get("origin");
		if ((suppliedOrigin !== null && suppliedOrigin !== publicUrl.origin) || url.host !== publicUrl.host) {
			return json({ error: "Request origin is not allowed." }, 403);
		}
		if (url.search) return json({ error: "Query parameters are not supported." }, 400);
		if (request.method === "OPTIONS" && (url.pathname === "/mcp" || url.pathname.startsWith("/api/visits/"))) {
			return new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Origin": publicUrl.origin,
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, MCP-Session-Id, PAYMENT-SIGNATURE",
					Vary: "Origin",
				},
			});
		}
		if (url.pathname === "/") {
			if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
			return new Response(request.method === "HEAD" ? null : options.browserHtml ?? options.uiHtml, { headers: htmlHeaders });
		}
		if (url.pathname === "/mcp") {
			if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
			const body = await readJson(request);
			if (body.kind === "error") return protocolError(body.status, body.code, body.message);
			const message = JSONRPCMessageSchema.safeParse(body.value);
			if (!message.success || Array.isArray(body.value)) {
				return protocolError(400, -32600, "Invalid JSON-RPC message.");
			}
			const mcp = createMcpServer({ ...options, publicOrigin: publicUrl.origin });
			const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
			try {
				await mcp.connect(transport);
				const response = await transport.handleRequest(request, { parsedBody: message.data });
				response.headers.set("Cache-Control", "no-store");
				response.headers.set("X-Content-Type-Options", "nosniff");
				return response;
			} catch {
				return protocolError(500, -32603, "The request could not be completed.");
			} finally {
				await mcp.close();
			}
		}
		if (url.pathname.startsWith("/api/visits/")) {
			if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
			const body = await readJson(request);
			if (body.kind === "error") return json({ error: body.message }, body.status);
			try {
				switch (url.pathname) {
					case "/api/visits/start": {
						const input = startInputSchema.safeParse(body.value);
						return input.success ? json(careResultSchema.parse(await options.care.start(input.data))) : json(invalidInput(), 400);
					}
					case "/api/visits/resume": {
						const input = resumeInputSchema.safeParse(body.value);
						return input.success ? json(careResultSchema.parse(await options.care.resume(input.data))) : json(invalidInput(), 400);
					}
					case "/api/visits/advance": {
						const input = advanceInputSchema.safeParse(body.value);
						if (!input.success) return json(invalidInput(), 400);
						if (input.data.command.kind === "simulate_payment") {
							return json({ kind: "error", code: "invalid_input", message: "Use the dedicated simulated-payment endpoint." }, 400);
						}
						return json(careResultSchema.parse(await options.care.advance(input.data)));
					}
					case "/api/visits/payment": {
						const input = paymentInputSchema.safeParse(body.value);
						if (!input.success) return json(invalidInput(), 400);
						const signature = request.headers.get("PAYMENT-SIGNATURE");
						let proof: unknown;
						if (signature) {
							if (signature.length > 16_384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) return json(invalidInput(), 400);
							try { proof = JSON.parse(Buffer.from(signature, "base64").toString("utf8")); }
							catch { return json(invalidInput(), 400); }
						}
						const payment = await simulatePayment(options.care, publicUrl.origin, input.data, proof);
						if (payment.kind === "payment-required") {
							const response = json(payment.required, 402);
							response.headers.set("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(payment.required)).toString("base64"));
							return response;
						}
						const response = json(payment.result);
						if (payment.settlement) response.headers.set("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(payment.settlement)).toString("base64"));
						return response;
					}
					case "/api/visits/export": {
						const input = resumeInputSchema.safeParse(body.value);
						if (!input.success) return json(invalidInput(), 400);
						const result = careResultSchema.parse(await options.care.resume(input.data));
						return result.kind === "ok"
							? json(syntheticFhirBundleSchema.parse(exportFhirRecord(result.envelope.snapshot)))
							: json(result);
					}

					case "/api/visits/media": {
						const input = mediaInputSchema.safeParse(body.value);
						if (!input.success) return json({ kind: "error", message: "Check the media request fields." }, 400);
						const current = await options.care.resume({ credential: input.data.credential });
						if (current.kind !== "ok" || current.envelope.snapshot.state.kind !== "consulting") {
							return json({ kind: "error", message: "Media is available only during an active synthetic consultation." }, 403);
						}
						const media = options.media
							? await options.media(input.data)
							: { kind: "practice", reason: "unconfigured", message: "The scripted visit is ready. Live media is not configured." };
						return json(mediaResultSchema.parse(media));
					}
					default:
						return json({ error: "Route not found." }, 404);
				}
			} catch {
				return json({ kind: "error", code: "temporarily_unavailable", message: "The visit service is temporarily unavailable. Retry the same request." }, 503);
			}
		}
		if (publicDirectory && (request.method === "GET" || request.method === "HEAD")) {
			let path: string;
			try {
				path = resolve(publicDirectory, `.${decodeURIComponent(url.pathname)}`);
			} catch {
				return json({ error: "Invalid resource path." }, 400);
			}
			if (!path.startsWith(`${publicDirectory}${sep}`)) return json({ error: "Route not found." }, 404);
			const file = Bun.file(path);
			if (await file.exists()) {
				return new Response(request.method === "HEAD" ? null : file, {
					headers: { "Content-Type": file.type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" },
				});
			}
		}
		return json({ error: "Route not found." }, 404);
	};
}

if (import.meta.main) {
	const port = Number(process.env.PORT ?? "3000");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
	if (process.env.K_SERVICE && !process.env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required for a Cloud Run service.");
	const publicOrigin = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
	const publicDirectory = resolve(process.cwd(), "dist/public");
	const [uiHtml, browserHtml, store] = await Promise.all([
		Bun.file(resolve(process.cwd(), "dist/mcp-app.html")).text(),
		Bun.file(resolve(publicDirectory, "index.html")).text(),
		createStoreFromEnv(),
	]);
	const care = createCareService({ store });
	const serverUrl = process.env.LIVEKIT_URL;
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;
	if ((serverUrl || apiKey || apiSecret) && !(serverUrl && apiKey && apiSecret)) {
		throw new Error("Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET together to enable demonstration media.");
	}
	const media = createMediaService({ care, config: serverUrl && apiKey && apiSecret ? { serverUrl, apiKey, apiSecret } : undefined });
	const mediaOrigin = serverUrl ? new URL(serverUrl).origin : undefined;
	const mediaConnectOrigins = mediaOrigin ? [mediaOrigin, mediaOrigin.replace(/^ws/, "http")] : [];
	const server = Bun.serve({
		port,
		hostname: process.env.K_SERVICE ? "0.0.0.0" : "127.0.0.1",
		maxRequestBodySize: maximumBodyBytes,
		fetch: createRequestHandler({
			care,
			uiHtml,
			browserHtml,
			publicOrigin,
			publicDirectory,
			media: media.join,
			mediaConnectOrigins,
			deploymentNonce: process.env.PLATFORM_DEPLOY_NONCE,
		}),
	});
	process.stdout.write(`${JSON.stringify({ event: "server_started", port: server.port })}\n`);
	const shutdown = async () => { await server.stop(); store.close(); };
	process.once("SIGTERM", () => { void shutdown(); });
	process.once("SIGINT", () => { void shutdown(); });
}
