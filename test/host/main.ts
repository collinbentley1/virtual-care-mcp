import { AppBridge, McpUiHostContextSchema, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { CallToolResultSchema, ReadResourceResultSchema, type CallToolRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { careResultSchema, scenarioSchema, visitSnapshotSchema, type VisitEnvelope } from "../../src/contracts.ts";
import { syntheticFhirBundleSchema } from "../../src/billing.ts";
import { omitNullObjectProperties } from "./null-omission.ts";

function element(id: string): HTMLElement {
	const found = document.getElementById(id);
	if (!found) throw new Error("A host harness element is missing.");
	return found;
}
function button(id: string): HTMLButtonElement {
	const found = element(id);
	if (!(found instanceof HTMLButtonElement)) throw new Error("A host harness control is missing.");
	return found;
}
const status = element("status");
const events = element("events");
const mount = element("mount");
const buildSchema = z.object({ appOrigin: z.url(), sandboxOrigin: z.url(), hashes: z.record(z.string(), z.string()) });
const build = buildSchema.parse(await (await fetch("/host/build")).json());
element("build").textContent = JSON.stringify(build, null, 2);
let latest: VisitEnvelope | undefined;
let bridge: AppBridge | undefined;
let iframe: HTMLIFrameElement | undefined;
let initialized = 0;
let mutations = 0;
let notifications = 0;
let teardowns = 0;
let downloads = 0;
let deniedDownloads = 0;
let deniedLinks = 0;
let observedMediaAssets = 0;
let droppedMutation: { name: string; arguments: string; proof: string | undefined } | undefined;
const hostThemeSchema = z.enum(["light", "dark"]);
const hostThemes = {
	light: {
		theme: "light", styles: { variables: {
			"--font-sans": "Arial, sans-serif", "--font-text-md-size": "17px",
			"--color-background-primary": "#fff8ed", "--color-background-secondary": "#f6ead7",
			"--color-text-primary": "#3b2410", "--color-text-secondary": "#705035",
			"--color-border-primary": "#ad7644", "--color-ring-primary": "#b45309",
		} },
	},
	dark: {
		theme: "dark", styles: { variables: {
			"--font-sans": "Verdana, sans-serif", "--font-text-md-size": "19px",
			"--color-background-primary": "#14202b", "--color-background-secondary": "#223443",
			"--color-text-primary": "#e4f0f6", "--color-text-secondary": "#aec4d2",
			"--color-border-primary": "#67899e", "--color-ring-primary": "#6ee7ff",
		} },
	},
};

function selectedHostContext() {
	const control = element("host-theme");
	if (!(control instanceof HTMLSelectElement)) throw new Error("The host theme fixture control is missing.");
	return hostThemes[hostThemeSchema.parse(control.value)];
}
function applyHostTheme(): void {
	const context = selectedHostContext();
	const validated = McpUiHostContextSchema.parse(context);
	document.documentElement.style.setProperty("--host-background", context.styles.variables["--color-background-primary"]);
	if (iframe) iframe.style.colorScheme = context.theme;
	bridge?.setHostContext(validated);
	record(`Host theme ${context.theme}: ${context.styles.variables["--font-sans"]}; medium text ${context.styles.variables["--font-text-md-size"]}. ${bridge ? "Standard host-context update sent." : "Selected for initialization."}`);
}

function record(message: string): void {
	const item = document.createElement("li");
	item.textContent = message;
	events.append(item);
	status.textContent = `Initialized: ${initialized}. App mutations: ${mutations}. Tool-result notifications: ${notifications}. Teardown acknowledgments: ${teardowns}. Accepted download requests: ${downloads}. Denied downloads: ${deniedDownloads}. Denied links: ${deniedLinks}. Media asset requests: ${observedMediaAssets}. Saved step: ${latest?.snapshot.state.kind ?? "none"}. Revision: ${latest?.snapshot.revision ?? "none"}. Payment receipts: ${latest?.snapshot.paymentHistory.length ?? 0}.`;
	button("change-payment-assistance").disabled = !latest?.availableActions.includes("select_payment");
}
async function call(params: CallToolRequest["params"]): Promise<CallToolResult> {
	const response = await fetch("/host/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
	if (!response.ok) throw new Error("The host's MCP call failed.");
	const result = CallToolResultSchema.parse(await response.json());
	const parsed = careResultSchema.safeParse(result.structuredContent);
	if (parsed.success && parsed.data.kind !== "error") latest = parsed.data.envelope;
	return result;
}
function deliveredResult(result: CallToolResult): CallToolResult {
	const control = element("omit-null");
	if (!(control instanceof HTMLInputElement)) throw new Error("The host serialization fixture control is missing.");
	return control.checked ? CallToolResultSchema.parse(omitNullObjectProperties(result)) : result;
}
async function display(result: CallToolResult): Promise<void> {
	const resources = ReadResourceResultSchema.parse(await (await fetch("/host/resource")).json());
	const resource = resources.contents.find((entry) => entry.mimeType === "text/html;profile=mcp-app" && "text" in entry);
	if (!resource || !("text" in resource)) throw new Error("The MCP app HTML resource was missing.");
	if (resource.text.includes("__VIRTUAL_CARE_ASSET_ORIGIN__") || !resource.text.includes(`${build.appOrigin}/livekit.js`)) throw new Error("The built resource import map did not resolve to its public origin.");
	const ui = z.object({ ui: z.object({ csp: z.object({ resourceDomains: z.array(z.string()), connectDomains: z.array(z.string()) }) }) }).parse(resource._meta);
	if (!ui.ui.csp.resourceDomains.includes(build.appOrigin)) throw new Error("The app resource CSP omitted its asset origin.");
	record("resources/read: actual built HTML, resolved import map, exact resource CSP origin");
	const appFrame = document.createElement("iframe");
	appFrame.id = "care-app";
	appFrame.title = "Synthetic visit app";
	appFrame.style.colorScheme = selectedHostContext().theme;
	appFrame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
	appFrame.setAttribute("allow", "camera 'none'; microphone 'none'");
	mount.replaceChildren(appFrame);
	const childWindow = appFrame.contentWindow;
	if (!childWindow) throw new Error("The sandbox window did not initialize.");
	iframe = appFrame;
	const active = new AppBridge(null, { name: "Independent local AppBridge harness", version: "1.0.0" }, {
		serverTools: {}, downloadFile: {}, openLinks: {}, sandbox: { permissions: {} },
	}, { hostContext: McpUiHostContextSchema.parse(selectedHostContext()) });
	bridge = active;
	active.ondownloadfile = async ({ contents }) => {
		const deny = element("deny-download");
		if (!(deny instanceof HTMLInputElement)) throw new Error("The download fixture control is missing.");
		if (deny.checked) {
			deniedDownloads += 1;
			record("ui/download-file: host returned isError:true");
			return { isError: true };
		}
		if (contents.length !== 1) return { isError: true };
		const entry = contents[0];
		if (entry?.type !== "resource" || !("text" in entry.resource)) return { isError: true };
		const data: unknown = JSON.parse(entry.resource.text);
		const snapshot = z.object({ mode: z.literal("synthetic"), notice: z.string(), snapshot: visitSnapshotSchema }).strict().safeParse(data);
		const fhir = syntheticFhirBundleSchema.safeParse(data);
		if ((!snapshot.success && !fhir.success) || (latest && entry.resource.text.includes(latest.credential))) return { isError: true };
		downloads += 1;
		record(`ui/download-file: accepted valid ${fhir.success ? "FHIR bundle" : "visit snapshot"}; credential absent; ${new TextEncoder().encode(entry.resource.text).byteLength} bytes. Harness receipt only.`);
		return {};
	};
	active.onopenlink = async () => {
		deniedLinks += 1;
		record("ui/open-link: host returned isError:true; destination not logged");
		return { isError: true };
	};
	active.oncalltool = async (params) => {
		const response = await call(params);
		const mutation = params.name === "care_advance" || params.name === "care_simulate_payment";
		if (mutation) mutations += 1;
		record(`App tools/call: ${params.name}`);
		const parsed = careResultSchema.safeParse(response.structuredContent);
		if (mutation && parsed.success && parsed.data.kind === "ok") record(`Mutation response: replayed ${parsed.data.replayed}; payment receipts ${parsed.data.envelope.snapshot.paymentHistory.length}.`);
		if (mutation && droppedMutation) {
			record(`Retry observation: same tool ${params.name === droppedMutation.name}; identical arguments ${JSON.stringify(params.arguments) === droppedMutation.arguments}; identical proof ${JSON.stringify(params._meta?.["x402/payment"]) === droppedMutation.proof}.`);
			droppedMutation = undefined;
		}
		const drop = element("drop-next-mutation");
		if (!(drop instanceof HTMLInputElement)) throw new Error("The response-loss fixture control is missing.");
		if (mutation && drop.checked) {
			drop.checked = false;
			droppedMutation = { name: params.name, arguments: JSON.stringify(params.arguments), proof: JSON.stringify(params._meta?.["x402/payment"]) };
			record("Host fixture dropped one mutation response after execution; checkbox cleared.");
			throw new Error("The host did not deliver the completed mutation response.");
		}
		const promote = element("promote-tool-errors");
		if (!(promote instanceof HTMLInputElement)) throw new Error("The host error fixture control is missing.");
		if (promote.checked && response.isError) {
			record("Host fixture discarded an isError tool result and returned a protocol error.");
			throw new Error("The host did not deliver the tool's error result.");
		}
		return deliveredResult(response);
	};
	active.onsandboxready = () => {
		record("ui/notifications/sandbox-proxy-ready received from a separate origin");
		void active.sendSandboxResourceReady({ html: resource.text, sandbox: "allow-scripts allow-forms", csp: ui.ui.csp, permissions: {} }).catch(reportError);
	};
	active.oninitialized = () => {
		void (async () => {
			initialized += 1;
			record("ui/notifications/initialized: handshake complete");
			await active.sendToolInput({ arguments: { credential: latest?.credential } });
			await active.sendToolResult(deliveredResult(result));
			notifications += 1;
			record("ui/notifications/tool-input and ui/notifications/tool-result delivered");
			button("update").disabled = false;
			button("delayed-update").disabled = false;
			button("teardown").disabled = false;
			button("reconnect").disabled = true;
		})().catch(reportError);
	};
	active.onerror = () => record("Bridge error; inspect the visible app status.");
	await active.connect(new PostMessageTransport(childWindow, childWindow));
	appFrame.src = `${build.sandboxOrigin}/sandbox`;
}
function reportError(): void { record("Harness action failed. Inspect the browser console and current app before continuing."); }
window.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source !== iframe?.contentWindow) return;
	if (z.object({ type: z.literal("harness-asset-observed"), asset: z.literal("livekit.js") }).strict().safeParse(event.data).success) {
		event.stopImmediatePropagation();
		observedMediaAssets += 1;
		record("Passive Resource Timing observer: optional livekit.js request observed in the built app frame");
		return;
	}
	const message = z.object({ method: z.string().optional() }).passthrough().safeParse(event.data);
	if (message.success && message.data.method === "ui/initialize") record("ui/initialize received from sandbox");
});
button("start").addEventListener("click", () => { void (async () => {
	button("start").disabled = true;
	const scenario = element("scenario");
	if (!(scenario instanceof HTMLSelectElement)) throw new Error("The scenario fixture control is missing.");
	await call({ name: "care_start", arguments: { scenarioId: scenarioSchema.parse(scenario.value) } });
	if (!latest) throw new Error("A synthetic visit was not created.");
	await display(await call({ name: "care_render", arguments: { credential: latest.credential } }));
})().catch(reportError); });
button("update").addEventListener("click", () => { void (async () => {
	await deliverHostUpdate();
})().catch(reportError); });
async function deliverHostUpdate(): Promise<void> {
	if (!latest || !bridge) return;
	const result = await call({ name: "care_advance", arguments: {
		credential: latest.credential, expectedRevision: latest.snapshot.revision, commandId: crypto.randomUUID(),
		command: { kind: "set_access", access: { ...latest.snapshot.access, largeText: !latest.snapshot.access.largeText } },
	} });
	await bridge.sendToolResult(deliveredResult(result));
	notifications += 1;
	record("Host saved an access preference and delivered ui/notifications/tool-result");
}
let delayedHostUpdateTimer: ReturnType<typeof setTimeout> | undefined;
button("delayed-update").addEventListener("click", () => {
	if (delayedHostUpdateTimer) clearTimeout(delayedHostUpdateTimer);
	const control = button("delayed-update");
	control.disabled = true;
	record("Host update scheduled for delivery in 3 seconds; return focus to the app before it arrives.");
	delayedHostUpdateTimer = setTimeout(() => {
		delayedHostUpdateTimer = undefined;
		void deliverHostUpdate().catch(reportError).finally(() => {
			if (bridge && latest) control.disabled = false;
		});
	}, 3000);
});
button("change-payment-assistance").addEventListener("click", () => { void (async () => {
	if (!latest?.availableActions.includes("select_payment")) return;
	const result = await call({ name: "care_advance", arguments: {
		credential: latest.credential, expectedRevision: latest.snapshot.revision, commandId: crypto.randomUUID(),
		command: { kind: "select_payment", choice: { kind: "assistance" } },
	} });
	if (careResultSchema.parse(result.structuredContent).kind !== "ok") throw new Error("The host's independent payment change did not succeed.");
	record("Host changed payment to assistance without notifying the app.");
})().catch(reportError); });
button("teardown").addEventListener("click", () => { void (async () => {
	if (!bridge) return;
	if (delayedHostUpdateTimer) {
		clearTimeout(delayedHostUpdateTimer);
		delayedHostUpdateTimer = undefined;
	}
	await bridge.teardownResource({}, { timeout: 5000 });
	teardowns += 1;
	record("ui/resource-teardown acknowledged");
	await bridge.close();
	bridge = undefined;
	iframe?.remove();
	iframe = undefined;
	button("update").disabled = true;
	button("delayed-update").disabled = true;
	button("teardown").disabled = true;
	button("reconnect").disabled = false;
})().catch(reportError); });
button("reconnect").addEventListener("click", () => { void (async () => {
	if (!latest) return;
	await display(await call({ name: "care_render", arguments: { credential: latest.credential } }));
})().catch(reportError); });
element("omit-null").addEventListener("change", () => record("Host serialization fixture changed; applies to subsequent tool results and notifications."));
element("host-theme").addEventListener("change", applyHostTheme);
applyHostTheme();
record("Host ready. No visit credentials or tokens appear in this evidence panel.");
