import { McpUiHostContextChangedNotificationSchema, McpUiInitializeResultSchema, McpUiSandboxResourceReadyNotificationSchema } from "@modelcontextprotocol/ext-apps/app-bridge";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";

const configuredOrigin = document.querySelector<HTMLMetaElement>('meta[name="host-origin"]')?.content;
if (!configuredOrigin || !URL.canParse(configuredOrigin)) throw new Error("The local sandbox requires its host origin.");
const hostOrigin = new URL(configuredOrigin).origin;
let view: HTMLIFrameElement | undefined;
let initializationId: string | number | undefined;

function applyColorScheme(theme: "light" | "dark" | undefined): void {
	if (!theme) return;
	document.documentElement.style.colorScheme = theme;
	if (view) view.style.colorScheme = theme;
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source === window.parent && event.origin === hostOrigin) {
		const resource = McpUiSandboxResourceReadyNotificationSchema.safeParse(event.data);
		if (resource.success) {
			const appDocument = new DOMParser().parseFromString(resource.data.params.html, "text/html");
			const csp = resource.data.params.csp;
			const resources = csp?.resourceDomains?.join(" ") ?? "";
			const connections = csp?.connectDomains?.join(" ") || "'none'";
			const policy = appDocument.createElement("meta");
			policy.httpEquiv = "Content-Security-Policy";
			policy.content = `default-src 'none'; script-src 'unsafe-inline' ${resources}; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src ${connections}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`;
			appDocument.head.prepend(policy);
			const importMap = appDocument.querySelector('script[type="importmap"]')?.textContent ?? "";
			const observer = appDocument.createElement("script");
			observer.textContent = `new PerformanceObserver((list) => { for (const entry of list.getEntries()) { if (entry.name.endsWith("/livekit.js")) parent.postMessage({ type: "harness-asset-observed", asset: "livekit.js" }, "*"); } }).observe({ type: "resource", buffered: true });`;
			if (importMap.includes("/livekit.js")) appDocument.head.append(observer);
			const iframe = document.createElement("iframe");
			iframe.id = "care-view";
			iframe.title = "Built virtual care app";
			iframe.style.cssText = "width:100%;height:100%;border:0";
			iframe.style.colorScheme = document.documentElement.style.colorScheme;
			iframe.setAttribute("sandbox", "allow-scripts allow-forms");
			iframe.setAttribute("allow", "camera 'none'; microphone 'none'");
			document.body.replaceChildren(iframe);
			view = iframe;
			iframe.srcdoc = `<!doctype html>${appDocument.documentElement.outerHTML}`;
			return;
		}
		const message = JSONRPCMessageSchema.safeParse(event.data);
		if (message.success && (!("method" in message.data) || !message.data.method.startsWith("ui/notifications/sandbox-"))) {
			if ("result" in message.data && message.data.id === initializationId) {
				const initialized = McpUiInitializeResultSchema.safeParse(message.data.result);
				if (initialized.success) applyColorScheme(initialized.data.hostContext.theme);
				initializationId = undefined;
			}
			const changed = McpUiHostContextChangedNotificationSchema.safeParse(message.data);
			if (changed.success) applyColorScheme(changed.data.params.theme);
			view?.contentWindow?.postMessage(message.data, "*");
		}
		return;
	}
	if (event.source === view?.contentWindow) {
		if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "harness-asset-observed") {
			window.parent.postMessage({ type: "harness-asset-observed", asset: "livekit.js" }, hostOrigin);
			return;
		}
		const message = JSONRPCMessageSchema.safeParse(event.data);
		if (message.success && (!("method" in message.data) || !message.data.method.startsWith("ui/notifications/sandbox-"))) {
			if ("method" in message.data && message.data.method === "ui/initialize" && "id" in message.data) initializationId = message.data.id;
			window.parent.postMessage(message.data, hostOrigin);
		}
	}
});
window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, hostOrigin);
