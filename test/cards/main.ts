import { AppBridge, McpUiHostContextSchema, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { CallToolResultSchema, ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { cardKindSchema, cardResultSchema, careResultSchema } from "../../src/contracts.ts";

function element(id: string): HTMLElement {
	const found = document.getElementById(id);
	if (!found) throw new Error("A card host control is missing.");
	return found;
}
function checkbox(id: string): HTMLInputElement {
	const found = element(id);
	if (!(found instanceof HTMLInputElement)) throw new Error("A card host checkbox is missing.");
	return found;
}
const fixtureSchema = z.object({ result: CallToolResultSchema, resource: ReadResourceResultSchema });
let bridge: AppBridge | undefined;
let frame: HTMLIFrameElement | undefined;
let kind = cardKindSchema.parse("appointment");
let firstResult: z.infer<typeof CallToolResultSchema> | undefined;
let dropped: string | undefined;
function record(message: string): void {
	const entry = document.createElement("li");
	entry.textContent = message;
	element("events").append(entry);
}
function hostContext() {
	const dark = checkbox("dark").checked;
	return { theme: dark ? "dark" as const : "light" as const, styles: { variables: { "--font-sans": "system-ui, sans-serif", "--font-text-md-size": checkbox("large").checked ? "22px" : "16px", "--color-text-primary": dark ? "#eceeed" : "#202321", "--color-text-secondary": dark ? "#bcc3bf" : "#626963", "--color-background-primary": dark ? "#202321" : "#ffffff", "--color-background-secondary": dark ? "#2c322e" : "#f3f5f3", "--color-border-primary": dark ? "#525c55" : "#d8ddd9" } } };
}
function applyTheme(): void {
	const context = hostContext();
	document.body.style.background = context.styles.variables["--color-background-primary"];
	document.body.style.color = context.styles.variables["--color-text-primary"];
	if (frame) frame.style.colorScheme = context.theme;
	bridge?.setHostContext(McpUiHostContextSchema.parse(context));
}
async function show(): Promise<void> {
	if (bridge) { await bridge.teardownResource({}); await bridge.close(); }
	const fixture = fixtureSchema.parse(await (await fetch(`/fixture?card=${kind}`)).json());
	const html = fixture.resource.contents.find((item) => "text" in item);
	if (!html || !("text" in html)) throw new Error("The built card resource was unavailable.");
	const iframe = document.createElement("iframe");
	iframe.title = "Visit card";
	iframe.id = "visit-card";
	iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
	iframe.setAttribute("allow", "camera 'none'; microphone 'none'");
	element("mount").replaceChildren(iframe);
	const childWindow = iframe.contentWindow;
	if (!childWindow) throw new Error("The card frame was unavailable.");
	frame = iframe;
	const active = new AppBridge(null, { name: "Card UI verification host", version: "1.0.0" }, { serverTools: {}, openLinks: {}, downloadFile: {} }, { hostContext: McpUiHostContextSchema.parse(hostContext()) });
	bridge = active;
	active.onsizechange = ({ height }) => { if (height && frame === iframe) iframe.style.height = `${height}px`; };
	active.onmessage = async ({ content }) => { record(`Conversation: ${content.filter((item) => item.type === "text").map((item) => item.text).join(" ")}`); return {}; };
	active.onupdatemodelcontext = async ({ structuredContent }) => {
		const card = cardResultSchema.parse(structuredContent);
		record(`Model context: ${card.cardKind}, revision ${card.revision}${card.cardKind === "maternal-plan" && card.plan.kind !== "none" ? `, ${card.plan.questions.length} questions` : ""}.`);
		return {};
	};
	active.onopenlink = async () => { record("Link requested; destination not logged. Host returned isError:true."); return { isError: true }; };
	active.ondownloadfile = async ({ contents }) => {
		const entry = contents[0];
		if (!entry || entry.type !== "resource" || !("text" in entry.resource) || entry.resource.text.includes("vcm_")) return { isError: true };
		record("Summary download: text content received, no credential.");
		return {};
	};
	active.oncalltool = async (params) => {
		const response = await fetch("/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
		const result = CallToolResultSchema.parse(await response.json());
		record(`Tool: ${params.name}.`);
		if (checkbox("fail-refresh").checked && params.name.startsWith("care_show_")) {
			checkbox("fail-refresh").checked = false;
			record("Refresh response intentionally dropped after execution.");
			throw new Error("The test host dropped one refresh response.");
		}
		const parsed = careResultSchema.safeParse(result.structuredContent);
		if (parsed.success && parsed.data.kind === "ok") record(`Saved revision ${parsed.data.envelope.snapshot.revision}. Replayed: ${parsed.data.replayed}.`);
		const command = JSON.stringify({ name: params.name, arguments: params.arguments });
		if (dropped) { record(`Identical retry: ${dropped === command}.`); dropped = undefined; }
		if (checkbox("drop").checked && ["care_update_maternal_plan", "care_finish_consultation", "care_begin_consultation"].includes(params.name)) {
			checkbox("drop").checked = false;
			dropped = command;
			record("Save response intentionally dropped after execution.");
			throw new Error("The test host dropped one save response.");
		}
		return result;
	};
	active.oninitialized = () => {
		void (async () => { await active.sendToolResult(fixture.result); firstResult = fixture.result; record(`Rendered ${kind}.`); })();
	};
	await active.connect(new PostMessageTransport(childWindow, childWindow));
	iframe.srcdoc = html.text;
	applyTheme();
}
element("card-kind").addEventListener("change", (event) => {
	if (!(event.target instanceof HTMLSelectElement)) return;
	kind = cardKindSchema.parse(event.target.value);
	void show().catch(() => record("The card could not be shown."));
});
element("reload").addEventListener("click", () => { void show(); });
element("older").addEventListener("click", () => { if (firstResult) void bridge?.sendToolResult(firstResult).then(() => record("Original older card result replayed.")); });
element("dark").addEventListener("change", applyTheme);
element("large").addEventListener("change", applyTheme);
element("narrow").addEventListener("change", () => { element("mount").style.maxWidth = checkbox("narrow").checked ? "320px" : "600px"; });
void show().catch(() => record("The initial card could not be shown."));
