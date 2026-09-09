import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const extensions = new Set([".ts", ".json", ".md", ".css", ".html", ".tf", ".toml", ".yml", ".yaml"]);
const ignored = new Set([".git", ".terraform", ".local", "node_modules", "dist", "test-results", "playwright-report"]);
const changed: string[] = [];
async function walk(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) { if (!ignored.has(entry.name)) await walk(path); continue; }
		if (!entry.isFile() || (!extensions.has(extname(entry.name)) && !["Dockerfile", ".dockerignore", ".gitignore"].includes(entry.name))) continue;
		const original = await readFile(path, "utf8");
		const formatted = `${original.replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "").trimEnd()}\n`;
		if (original === formatted) continue;
		changed.push(relative(root, path));
		if (Bun.argv.includes("--write")) await writeFile(path, formatted);
	}
}
await walk(root);
if (changed.length && !Bun.argv.includes("--write")) throw new Error(`Formatting drift: ${changed.join(", ")}`);
