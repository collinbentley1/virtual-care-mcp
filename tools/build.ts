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
	entrypoints: [join(root, "src/ui/preview.ts")], outdir: join(dist, "public"),
	naming: "app.js", target: "browser", minify: true, splitting: false,
	drop: ["console", "debugger"],
	external: ["virtual-care-livekit"],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!ui.success) throw new AggregateError(ui.logs, "The visit UI did not build.");
const cards = await Bun.build({
	entrypoints: [join(root, "src/ui/card.ts")], outdir: join(dist, "public"),
	naming: "card.js", target: "browser", minify: true, splitting: false,
	drop: ["console", "debugger"], external: ["virtual-care-livekit"],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!cards.success) throw new AggregateError(cards.logs, "The in-context visit cards did not build.");
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
const cardHtml = (await readFile(join(dist, "public/card.html"), "utf8")).replace(/<script\b[^>]*src=["']\/?card\.js["'][^>]*>/i, (tag) => `${importMap}\n${tag}`);
await writeFile(join(dist, "public/card.html"), cardHtml);
const script = (await readFile(join(dist, "public/card.js"), "utf8")).replace(/<\/script/gi, "<\\/script");
const styles = (await readFile(join(dist, "public/card.css"), "utf8")).replace(/<\/style/gi, "<\\/style");
const embedded = cardHtml
	.replace(/<link\b[^>]*href=["']\/?card\.css["'][^>]*>/i, () => `<style>${styles}</style>`)
	.replace(/<script\b[^>]*src=["']\/?card\.js["'][^>]*>\s*<\/script>/i, () => `<script type="module">${script}</script>`)
	.replace('"/livekit.js"', '"__VIRTUAL_CARE_ASSET_ORIGIN__/livekit.js"');
if (embedded === cardHtml || /(?:src|href)=["']\/(?:card\.js|card\.css)/.test(embedded)) {
	throw new Error("The MCP HTML resource must inline the app script and stylesheet.");
}
await writeFile(join(dist, "mcp-app.html"), embedded);
process.stdout.write(`Built MCP server and self-contained UI (${Buffer.byteLength(embedded)} bytes).\n`);
