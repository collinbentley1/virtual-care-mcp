import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (Bun.version !== "1.4.2" || Bun.revision !== "744846f844374847c902b5e7fd59b4342a51ef99") {
	throw new Error("Build with the official stable Bun 1.4.2 release (744846f84). Use the exact runtime selected for the platform update.");
}

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "public"), { recursive: true });
await cp(join(root, "public"), join(dist, "public"), { recursive: true });

const ui = await Bun.build({
	entrypoints: [join(root, "src/ui/main.ts")], outdir: join(dist, "public"),
	naming: "app.js", target: "browser", minify: true, splitting: false,
	drop: ["console", "debugger"],
	external: ["virtual-care-livekit"],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!ui.success) throw new AggregateError(ui.logs, "The visit UI did not build.");
const media = await Bun.build({
	entrypoints: [join(root, "tools/livekit-entry.ts")], outdir: join(dist, "public"),
	naming: "livekit.js", target: "browser", minify: true,
	drop: ["console", "debugger"],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!media.success) throw new AggregateError(media.logs, "The optional LiveKit client did not build.");
const server = await Bun.build({
	entrypoints: [join(root, "src/server.ts")], outdir: dist, target: "bun", minify: false,
});
if (!server.success) throw new AggregateError(server.logs, "The MCP server did not build.");

const sourceHtml = await readFile(join(dist, "public/index.html"), "utf8");
const importMap = `<script type="importmap">${JSON.stringify({ imports: { "virtual-care-livekit": "/livekit.js" } })}</script>`;
const html = sourceHtml.replace(/<script\b[^>]*src=["']\/?app\.js["'][^>]*>/i, (tag) => `${importMap}\n${tag}`);
await writeFile(join(dist, "public/index.html"), html);
const script = (await readFile(join(dist, "public/app.js"), "utf8")).replace(/<\/script/gi, "<\\/script");
const styles = (await readFile(join(dist, "public/styles.css"), "utf8")).replace(/<\/style/gi, "<\\/style");
const embedded = html
	.replace(/<link\b[^>]*href=["']\/?styles\.css["'][^>]*>/i, () => `<style>${styles}</style>`)
	.replace(/<script\b[^>]*src=["']\/?app\.js["'][^>]*>\s*<\/script>/i, () => `<script type="module">${script}</script>`)
	.replace('"/livekit.js"', '"__VIRTUAL_CARE_ASSET_ORIGIN__/livekit.js"');
if (embedded === html || /(?:src|href)=["']\/(?:app\.js|styles\.css)/.test(embedded)) {
	throw new Error("The MCP HTML resource must inline the app script and stylesheet.");
}
await writeFile(join(dist, "mcp-app.html"), embedded);
process.stdout.write(`Built MCP server and self-contained UI (${Buffer.byteLength(embedded)} bytes).\n`);
