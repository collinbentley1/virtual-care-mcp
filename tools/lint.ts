import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const forbidden = [
	{ expression: /window\s*\.\s*openai\b|@openai\/apps-sdk-ui/, reason: "Use the standard MCP Apps bridge." },
	{ expression: /\beval\s*\(|new\s+Function\s*\(/, reason: "The UI must run without unsafe-eval." },
	{ expression: /console\.(log|debug)\s*\(/, reason: "Use intentional diagnostics without visit data or credentials." },
];
async function inspect(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) { await inspect(path); continue; }
		if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
		const source = await readFile(path, "utf8");
		for (const rule of forbidden) if (rule.expression.test(source)) throw new Error(`${relative(root, path)}: ${rule.reason}`);
	}
}
await inspect(join(root, "src"));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.license !== "MIT") throw new Error("The project must retain its MIT license.");
