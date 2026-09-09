import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import { createMockPaymentPayload, createPaymentRequired, mockPaymentRequiredSchema, syntheticFhirBundleSchema, type MockPaymentPayload, type MockPaymentRequired, type SyntheticFhirBundle } from "../billing.ts";
import {
	careResultSchema,
	mediaResultSchema,
	type AdvanceInput,
	type CareClient,
	type CareResult,
	type MediaInput,
	type MediaResult,
	type Quote,
	type ResumeInput,
	type StartInput,
	type VisitCredential,
} from "../contracts.ts";

export interface CareConnection extends CareClient {
	readonly embedded: boolean;
	connect(): Promise<void>;
	media(input: MediaInput): Promise<MediaResult>;
	payment(input: AdvanceInput, quote: Quote): Promise<CareResult>;
	exportRecord(input: ResumeInput): Promise<SyntheticFhirBundle>;
	downloadFile(text: string, name: string, mimeType: string): Promise<boolean>;
	openBrowser(credential: VisitCredential): Promise<boolean>;
	close(): Promise<void>;
}

type ConnectionOptions = {
	onVisit: (result: CareResult) => void;
	onError: (message: string) => void;
	onTeardown: () => void;
};

const urlSchema = z.url().refine((value) => {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
});

export function createCareConnection(options: ConnectionOptions): CareConnection {
	const embedded = window.parent !== window;
	if (!embedded) {
		const request = async (path: string, input: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> => {
			return fetch(`/api/visits/${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
				credentials: "same-origin",
				body: JSON.stringify(input),
				signal: AbortSignal.timeout(20_000),
			});
		};
		const post = async (path: string, input: unknown): Promise<unknown> => {
			const data: unknown = await (await request(path, input)).json();
			return data;
		};
		return {
			embedded,
			connect: async () => {},
			start: async (input) => careResultSchema.parse(await post("start", input)),
			resume: async (input) => careResultSchema.parse(await post("resume", input)),
			advance: async (input) => careResultSchema.parse(await post("advance", input)),
			media: async (input) => mediaResultSchema.parse(await post("media", input)),
			payment: async (input, quote) => {
				const args = paymentArguments(input);
				const challenge = await request("payment", args);
				if (challenge.status !== 402) return careResultSchema.parse(await challenge.json());
				const header = challenge.headers.get("PAYMENT-REQUIRED");
				if (!header) throw new Error("The simulated payment requirement was missing.");
				const required = mockPaymentRequiredSchema.parse(JSON.parse(atob(header)));
				const payload = createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId });
				const response = await request("payment", args, { "PAYMENT-SIGNATURE": btoa(JSON.stringify(payload)) });
				return careResultSchema.parse(await response.json());
			},
			exportRecord: async (input) => syntheticFhirBundleSchema.parse(await post("export", input)),
			downloadFile: async (text, name, mimeType) => {
				const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
				const anchor = document.createElement("a");
				anchor.href = url;
				anchor.download = name;
				document.body.append(anchor);
				anchor.click();
				anchor.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1_000);
				return true;
			},
			openBrowser: async () => false,
			close: async () => {},
		};
	}

	const app = new App({ name: "Virtual Care MCP", version: "0.1.0" }, {}, { autoResize: true });
	const applyHostStyles = () => {
		const context = app.getHostContext();
		if (context?.theme) applyDocumentTheme(context.theme);
		if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
		if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
	};
	app.addEventListener("hostcontextchanged", applyHostStyles);
	let browserUrl: string | undefined;
	const configuredUrl = document.querySelector<HTMLMetaElement>('meta[name="virtual-care-base-url"]')?.content;
	const configured = urlSchema.safeParse(configuredUrl);
	if (configured.success) browserUrl = configured.data;
	const offers = new Map<VisitCredential, { revision: number; required?: MockPaymentRequired }>();
	const submittedPayments = new Map<string, { inputKey: string; payload: MockPaymentPayload }>();

	const readBrowserUrl = (metadata: Record<string, unknown> | undefined) => {
		const parsed = urlSchema.safeParse(metadata?.["virtual-care/browserUrl"]);
		if (parsed.success && !browserUrl) browserUrl = parsed.data;
	};

	const readPaymentOffer = (result: CareResult, metadata: Record<string, unknown> | undefined) => {
		if (result.kind === "error") return;
		const { credential, snapshot } = result.envelope;
		if ((offers.get(credential)?.revision ?? -1) > snapshot.revision) return;
		const parsed = mockPaymentRequiredSchema.safeParse(metadata?.["virtual-care/payment-required"]);
		const expected = snapshot.state.kind === "payment" && browserUrl
			? createPaymentRequired({ quote: snapshot.state.quote, resourceUrl: `${new URL(browserUrl).origin}/api/visits/${snapshot.visitId}/quotes/${snapshot.state.quote.id}` })
			: undefined;
		const required = parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected) ? parsed.data : undefined;
		offers.set(credential, { revision: snapshot.revision, ...(required ? { required } : {}) });
	};

	app.ontoolresult = (result) => {
		readBrowserUrl(result._meta);
		const parsed = careResultSchema.safeParse(result.structuredContent);
		if (parsed.success) {
			readPaymentOffer(parsed.data, result._meta);
			options.onVisit(parsed.data);
		}
	};
	app.onerror = () => options.onError("The connection to your chat was interrupted. Your saved visit is still available.");
	app.onteardown = async () => {
		options.onTeardown();
		return {};
	};

	const call = async (name: string, input: StartInput | ResumeInput | AdvanceInput): Promise<CareResult> => {
		const result = await app.callServerTool({ name, arguments: input });
		readBrowserUrl(result._meta);
		const parsed = careResultSchema.parse(result.structuredContent);
		readPaymentOffer(parsed, result._meta);
		return parsed;
	};

	return {
		embedded,
		connect: async () => { await app.connect(); applyHostStyles(); },
		start: (input) => call("care_start", input),
		resume: (input) => call("care_resume", input),
		advance: (input) => call("care_advance", input),
		media: async (input) => {
			const result = await app.callServerTool({ name: "care_media", arguments: input });
			return mediaResultSchema.parse(result._meta?.["virtual-care/media"]);
		},
		payment: async (input, quote) => {
			const args = paymentArguments(input);
			const inputKey = JSON.stringify(input);
			let submitted = submittedPayments.get(input.commandId);
			if (submitted && submitted.inputKey !== inputKey) throw new Error("Retry the original simulated payment without changing it.");
			if (!submitted) {
				let required = offers.get(input.credential)?.required;
				if (!required || required.accepts[0].extra.quoteId !== quote.id || required.accepts[0].extra.expiresAt !== quote.expiresAt) {
					const current = await call("care_resume", { credential: input.credential });
					if (current.kind === "error") return current;
					if (current.envelope.snapshot.state.kind !== "payment" || JSON.stringify(current.envelope.snapshot.state.quote) !== JSON.stringify(quote)) {
						return { kind: "conflict", envelope: current.envelope, message: "The saved payment option changed. Review the current visit before approving a payment." };
					}
					required = offers.get(input.credential)?.required;
				}
				if (!required || required.accepts[0].extra.quoteId !== quote.id || required.accepts[0].extra.expiresAt !== quote.expiresAt) throw new Error("The simulated payment offer could not be verified. Resume the visit and try again.");
				submitted = { inputKey, payload: createMockPaymentPayload({ quote, resourceUrl: required.resource.url, operationId: input.commandId }) };
				submittedPayments.set(input.commandId, submitted);
			}
			const { payload } = submitted;
			const result = await app.callServerTool({ name: "care_simulate_payment", arguments: args, _meta: { "x402/payment": payload } });
			readBrowserUrl(result._meta);
			const parsed = careResultSchema.parse(result.structuredContent);
			readPaymentOffer(parsed, result._meta);
			return parsed;
		},
		exportRecord: async (input) => {
			const result = await app.callServerTool({ name: "care_export", arguments: input });
			return syntheticFhirBundleSchema.parse(result.structuredContent);
		},
		downloadFile: async (text, name, mimeType) => {
			if (!app.getHostCapabilities()?.downloadFile) return false;
			const result = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${encodeURIComponent(name)}`, mimeType, text } }] });
			return result.isError !== true;
		},
		openBrowser: async (credential) => {
			if (!browserUrl || !app.getHostCapabilities()?.openLinks) return false;
			const url = new URL(browserUrl);
			url.hash = new URLSearchParams({ resume: credential }).toString();
			const result = await app.openLink({ url: url.toString() });
			return result.isError !== true;
		},
		close: async () => { await app.close(); },
	};
}

function paymentArguments(input: AdvanceInput) {
	if (input.command.kind !== "simulate_payment") throw new Error("A simulated payment command is required.");
	return { credential: input.credential, commandId: input.commandId, expectedRevision: input.expectedRevision, quoteId: input.command.quoteId, outcome: input.command.outcome };
}
