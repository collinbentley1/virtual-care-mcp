import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import { cardResultSchema, careResultSchema, credentialSchema, mediaResultSchema, type CardResult, type VisitCredential } from "../contracts.ts";

export const cardTools: Record<CardResult["cardKind"], string> = {
	appointment: "care_show_appointment",
	consultation: "care_show_consultation",
	"after-visit": "care_show_after_visit",
	"maternal-plan": "care_show_maternal_plan",
};

type CardConnectionOptions = {
	onCard: (card: CardResult) => void;
	onError: (message: string) => void;
	onTeardown: () => Promise<void>;
};
const browserUrlSchema = z.url().refine((value) => {
	const url = new URL(value);
	return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
});

export function createCardConnection(options: CardConnectionOptions) {
	const app = new App({ name: "Virtual Care MCP", version: "0.2.0" }, {}, { autoResize: true });
	let credential: VisitCredential | undefined;
	let browserUrl: string | undefined;
	let current: CardResult | undefined;
	const applyStyles = () => {
		const context = app.getHostContext();
		if (context?.theme) applyDocumentTheme(context.theme);
		if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
		if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
	};
	app.addEventListener("hostcontextchanged", applyStyles);
	const accept = (structuredContent: unknown, metadata?: Record<string, unknown>) => {
		const parsed = cardResultSchema.safeParse(structuredContent);
		if (!parsed.success) {
			const error = careResultSchema.safeParse(structuredContent);
			options.onError(error.success && error.data.kind === "error" ? error.data.message : "This card's data could not be read. Ask to show it again in the conversation.");
			return;
		}
		const next = parsed.data;
		if (current?.visitId === next.visitId && current.revision > next.revision) return;
		if (current && current.visitId !== next.visitId) credential = undefined;
		const scoped = credentialSchema.safeParse(metadata?.["virtual-care/credential"]);
		if (scoped.success) credential = scoped.data;
		const origin = browserUrlSchema.safeParse(metadata?.["virtual-care/browserUrl"]);
		if (origin.success) browserUrl = origin.data;
		current = next;
		options.onCard(next);
	};
	app.ontoolresult = (result) => {
		if (result.isError && !cardResultSchema.safeParse(result.structuredContent).success) {
			const message = result.content.find((item) => item.type === "text");
			options.onError(message?.type === "text" ? message.text : "This visit card could not be opened. Ask to resume the visit in the conversation.");
			return;
		}
		accept(result.structuredContent, result._meta);
	};
	app.onerror = () => options.onError("The connection was interrupted. Your saved visit is still available in the conversation.");
	app.onteardown = async () => { await options.onTeardown(); return {}; };
	const scopedCredential = () => {
		if (!credential) throw new Error("Open this card again from the conversation to reconnect to your saved visit.");
		return credential;
	};
	return {
		connect: async () => { await app.connect(); applyStyles(); },
		credential: scopedCredential,
		refresh: async (kind: CardResult["cardKind"]) => {
			const result = await app.callServerTool({ name: cardTools[kind], arguments: { credential: scopedCredential() } });
			const parsed = cardResultSchema.safeParse(result.structuredContent);
			if (!parsed.success) {
				const error = careResultSchema.safeParse(result.structuredContent);
				throw new Error(error.success && error.data.kind === "error" ? error.data.message : "The card could not be refreshed. Try again.");
			}
			accept(parsed.data, result._meta);
		},
		mutate: async (name: string, args: Record<string, unknown>) => {
			const result = await app.callServerTool({ name, arguments: args });
			return careResultSchema.parse(result.structuredContent);
		},
		media: async (mode: "audio" | "video") => {
			const result = await app.callServerTool({ name: "care_media", arguments: { credential: scopedCredential(), mode } });
			return mediaResultSchema.parse(result._meta?.["virtual-care/media"]);
		},
		context: async (card: CardResult) => { await app.updateModelContext({ structuredContent: card }); },
		message: async (text: string) => {
			const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
			return result.isError !== true;
		},
		openLink: async (url: string) => {
			if (!app.getHostCapabilities()?.openLinks) return false;
			const result = await app.openLink({ url });
			return result.isError !== true;
		},
		openBrowser: async () => {
			if (!browserUrl || !app.getHostCapabilities()?.openLinks) return false;
			const url = new URL(browserUrl);
			url.hash = new URLSearchParams({ resume: scopedCredential() }).toString();
			const result = await app.openLink({ url: url.toString() });
			return result.isError !== true;
		},
		download: async (text: string, name: string) => {
			if (!app.getHostCapabilities()?.downloadFile) return false;
			const result = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${name}`, mimeType: "text/plain", text } }] });
			return result.isError !== true;
		},
	};
}
