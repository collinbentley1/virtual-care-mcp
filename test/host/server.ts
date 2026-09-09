import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { getVisitResourceUri } from "../../src/mcp.ts";

const root = join(import.meta.dir, "../..");
const port = Number(process.env.MCP_HARNESS_PORT ?? "4321");
if (!Number.isInteger(port) || port < 1024 || port > 65_532) throw new Error("Choose a local harness port between 1024 and 65532.");
const work = join(root, `.local/mcp-host-harness-${port}`);
const artifact = join(work, "artifact");
const origin = `http://localhost:${port}`;
const appOrigin = `http://localhost:${port + 1}`;
const sandboxOrigin = `http://localhost:${port + 3}`;
await mkdir(work, { recursive: true });
await mkdir(artifact, { recursive: true });
await cp(join(root, "dist"), join(artifact, "dist"), { recursive: true });
const build = await Bun.build({ entrypoints: [join(import.meta.dir, "main.ts")], outdir: work, naming: "host.js", target: "browser", minify: false, drop: ["console"] });
if (!build.success) throw new AggregateError(build.logs, "The MCP host harness did not build.");
const proxyBuild = await Bun.build({ entrypoints: [join(import.meta.dir, "proxy.ts")], outdir: work, naming: "proxy.js", target: "browser", minify: true, drop: ["console", "debugger"] });
if (!proxyBuild.success) throw new AggregateError(proxyBuild.logs, "The sandbox proxy did not build.");
const hashes: Record<string, string> = {};
for (const file of ["server.js", "mcp-app.html", "public/app.js", "public/livekit.js"]) {
	hashes[file] = new Bun.CryptoHasher("sha256").update(await readFile(join(artifact, "dist", file))).digest("hex");
}
const child = Bun.spawn([process.execPath, "dist/server.js"], {
	cwd: artifact,
	env: {
		PORT: String(port + 1), PUBLIC_BASE_URL: appOrigin, VISIT_STORE: "memory", K_SERVICE: "",
		LIVEKIT_URL: `ws://127.0.0.1:${port + 2}`, LIVEKIT_API_KEY: "synthetic-host-harness",
		LIVEKIT_API_SECRET: "public-synthetic-host-harness-secret-not-for-live-use",
	},
	stdout: "ignore", stderr: "pipe",
});
const deadline = Date.now() + 5000;
for (;;) {
	try { if ((await fetch(`${appOrigin}/livez`)).ok) break; } catch {}
	if (Date.now() > deadline || child.exitCode !== null) {
		child.kill();
		process.stderr.write(await new Response(child.stderr).text());
		throw new Error("The copied built server did not become ready for the host harness.");
	}
	await Bun.sleep(50);
}
const client = new Client({ name: "Virtual Care independent host harness", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${appOrigin}/mcp`)));
const resourceUri = getVisitResourceUri({
	uiHtml: await readFile(join(artifact, "dist/mcp-app.html"), "utf8"),
	publicOrigin: appOrigin,
	mediaConnectOrigins: [`ws://127.0.0.1:${port + 2}`, `http://127.0.0.1:${port + 2}`],
});
const html = await readFile(join(import.meta.dir, "index.html"), "utf8");
const server = Bun.serve({
	hostname: "127.0.0.1", port,
	async fetch(request) {
		const url = new URL(request.url);
		const suppliedOrigin = request.headers.get("origin");
		if (url.host !== new URL(origin).host || (suppliedOrigin && suppliedOrigin !== origin)) return new Response(null, { status: 403 });
		if (request.method === "GET" && url.pathname === "/") return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
		if (request.method === "GET" && url.pathname === "/host.js") return new Response(Bun.file(join(work, "host.js")), { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
		if (request.method === "GET" && url.pathname === "/host/build") return Response.json({ appOrigin, sandboxOrigin, hashes });
		if (request.method === "GET" && url.pathname === "/host/resource") return Response.json(await client.readResource({ uri: resourceUri }));
		if (request.method === "POST" && url.pathname === "/host/tool") {
			if (request.headers.get("content-type") !== "application/json") return new Response(null, { status: 415 });
			try {
				const input: unknown = await request.json();
				const parsed = CallToolRequestSchema.safeParse({ method: "tools/call", params: input });
				if (!parsed.success || !parsed.data.params.name.startsWith("care_")) return new Response(null, { status: 400 });
				const result = CallToolResultSchema.parse(await client.callTool(parsed.data.params));
				return Response.json(result, { headers: { "Cache-Control": "no-store" } });
			} catch { return Response.json({ error: "The harness could not complete the MCP request." }, { status: 502 }); }
		}
		return new Response(null, { status: 404 });
	},
});
const sandboxServer = Bun.serve({
	hostname: "127.0.0.1", port: port + 3,
	fetch(request) {
		const url = new URL(request.url);
		if (request.method !== "GET" || url.host !== new URL(sandboxOrigin).host) return new Response(null, { status: 403 });
		if (url.pathname === "/sandbox") return new Response(`<!doctype html><html><head><meta name="host-origin" content="${origin}"><style>html,body{height:100%;margin:0}</style></head><body><script type="module" src="/proxy.js"></script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
		if (url.pathname === "/proxy.js") return new Response(Bun.file(join(work, "proxy.js")), { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
		return new Response(null, { status: 404 });
	},
});
process.stdout.write(`MCP Apps host harness: ${origin}\nCopied built MCP server: ${appOrigin}\nSynthetic media intentionally targets a closed local port; no device access is needed.\n`);
let closing = false;
const close = async () => {
	if (closing) return;
	closing = true;
	await Promise.all([server.stop(), sandboxServer.stop()]);
	await client.close();
	child.kill();
	await child.exited;
};
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
