import { commandIdSchema, type CardResult } from "../contracts.ts";
import { createCardConnection } from "./card-client.ts";
import { escapeHtml, maternalSupportUrl, renderCard, summaryText, urgentSignsUrl, type CardDraft } from "./card-render.ts";
import { createMediaPanel } from "./media.ts";

const root = document.getElementById("card");
if (!root) throw new Error("The visit card container is missing.");
root.innerHTML = '<article class="visit-card"><div id="card-content"><p class="loading" role="status">Opening your visit…</p></div><div id="card-feedback" role="status" aria-live="polite"></div></article>';
function element(id: string): HTMLElement {
	const found = document.getElementById(id);
	if (!found) throw new Error("A visit card element is missing.");
	return found;
}
const content = element("card-content");
const feedback = element("card-feedback");
const draft: CardDraft = { questionOpen: false, question: "" };
let current: CardResult | undefined;
let busy = false;
type PendingMutation = { name: string; args: Record<string, unknown>; effect: "question" | "task" | "begin" | "finish"; focusId: string };
let pending: PendingMutation | undefined;
let notice = "";
let retry: "mutation" | "refresh" | undefined;

const connection = createCardConnection({
	onCard: (card) => {
		if (current?.visitId !== card.visitId) { draft.question = ""; draft.questionOpen = false; }
		current = card;
		render();
	},
	onError: (message) => {
		if (!current) content.innerHTML = '<h1>Visit card unavailable</h1>';
		notice = message;
		renderFeedback();
	},
	onTeardown: async () => { await media.stop(); },
});
const media = createMediaPanel({
	join: (mode) => connection.media(mode),
	openBrowser: async () => {
		if (!await connection.openBrowser()) setNotice("This chat could not open the browser visit. Ask to resume the demo in your browser.");
	},
});

function setNotice(message: string): void { notice = message; renderFeedback(); }
function renderFeedback(): void {
	feedback.innerHTML = `${notice ? `<p>${escapeHtml(notice)}</p>` : ""}${retry ? `<button id="card-retry" class="text-button" data-action="retry">${retry === "mutation" ? "Retry save" : "Refresh card"}</button>` : ""}`;
}
function setBusy(value: boolean): void {
	busy = value;
	content.setAttribute("aria-busy", String(value));
	for (const control of content.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>("button, input, textarea")) {
		if (control.closest("[data-media-slot]")) continue;
		const readOnlyTask = control instanceof HTMLInputElement && control.hasAttribute("data-task") && current?.cardKind === "maternal-plan" && !current.canEdit;
		control.disabled = value || readOnlyTask;
	}
}
function render(): void {
	if (!current) return;
	const focused = document.activeElement;
	const focusId = focused instanceof HTMLElement ? focused.id : "";
	const disclosures = [...content.querySelectorAll<HTMLDetailsElement>("details[open][id]")].map((item) => item.id);
	content.innerHTML = renderCard(current, draft);
	content.className = `card-${current.cardKind}`;
	document.documentElement.classList.toggle("large-text", current.access.largeText);
	for (const control of content.querySelectorAll<HTMLElement>("[data-action], [data-task]")) {
		if (!control.id) control.id = `card-${control.dataset.action ?? control.dataset.task}`;
	}
	for (const id of disclosures) {
		const disclosure = document.getElementById(id);
		if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
	}
	const slot = content.querySelector<HTMLElement>("[data-media-slot]");
	if (slot && current.cardKind === "consultation" && current.consultation.kind === "active") {
		media.configure({ visitId: current.visitId, mode: current.consultation.mode, embedded: true });
		slot.append(media.element);
	} else void media.stop();
	setBusy(busy);
	renderFeedback();
	if (focusId) {
		const nextFocus = document.getElementById(focusId) ?? content.querySelector<HTMLElement>("button[data-action]");
		nextFocus?.focus({ preventScroll: true });
	}
}

async function shareContext(): Promise<void> {
	if (current) {
		try { await connection.context(current); } catch { /* Saved data remains available through the server. */ }
	}
}
async function sendMessage(message: string): Promise<void> {
	await shareContext();
	try {
		if (await connection.message(message)) setNotice("Sent to the conversation.");
		else setNotice(`Continue in the conversation: ${message}`);
	} catch { setNotice(`Continue in the conversation: ${message}`); }
}

async function refresh(options: { clearNotice?: boolean } = {}): Promise<void> {
	if (!current) return;
	try {
		await connection.refresh(current.cardKind);
		retry = undefined;
		if (options.clearNotice) notice = "";
		renderFeedback();
		await shareContext();
	} catch (error) {
		retry = "refresh";
		setNotice(error instanceof Error ? error.message : "The card could not be refreshed. Try again.");
	}
}

async function runPending(): Promise<void> {
	if (!pending || !current) return;
	const attempt = pending;
	setBusy(true);
	retry = undefined;
	setNotice("Saving…");
	try {
		const result = await connection.mutate(attempt.name, attempt.args);
		pending = undefined;
		if (result.kind === "error") { setNotice(result.message); render(); return; }
		if (result.kind === "conflict") {
			await refresh();
			setNotice("This visit changed in another view. Review the updated card before trying again.");
			return;
		}
		if (attempt.effect === "question") { draft.question = ""; draft.questionOpen = false; }
		if (attempt.effect === "finish") await media.stop();
		setNotice(attempt.effect === "question" ? "Question saved for you. It was not sent to a clinician." : attempt.effect === "finish" ? "Your demo visit has ended." : "Saved.");
		await refresh();
		if (attempt.effect === "finish") await sendMessage("Show the sample after-visit summary for the demo visit that just ended.");
	} catch {
		if (pending) {
			retry = "mutation";
			setNotice("The save could not be confirmed. Retry the same save before making another change.");
		} else {
			retry = "refresh";
			setNotice("Your change was saved. Refresh this card to see the latest visit.");
		}
		render();
	} finally {
		setBusy(false);
		renderFeedback();
		const preferredId = attempt.effect === "question" && !pending ? "card-add-question" : attempt.focusId;
		const preferred = preferredId ? document.getElementById(preferredId) : null;
		const focusTarget = preferred instanceof HTMLElement && !preferred.matches(":disabled")
			? preferred
			: content.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)");
		focusTarget?.focus({ preventScroll: true });
	}
}
async function mutate(name: string, extra: Record<string, unknown>, effect: PendingMutation["effect"]): Promise<void> {
	if (!current) return;
	if (pending) { setNotice("Retry the previous save before making another change."); render(); return; }
	const focused = document.activeElement;
	pending = { name, args: { credential: connection.credential(), expectedRevision: current.revision, commandId: commandIdSchema.parse(crypto.randomUUID()), ...extra }, effect, focusId: focused instanceof HTMLElement ? focused.id : "" };
	await runPending();
}

root.addEventListener("input", (event) => {
	if (event.target instanceof HTMLTextAreaElement && event.target.id === "question") draft.question = event.target.value;
});
root.addEventListener("change", (event) => {
	const input = event.target;
	if (!(input instanceof HTMLInputElement) || !input.dataset.task || busy || current?.cardKind !== "maternal-plan" || current.plan.kind === "none" || !current.canEdit) return;
	const task = current.plan.tasks.find((entry) => entry.id === input.dataset.task);
	if (!task) return;
	const kind = task.status.kind === "complete" ? "reopen_task" : "complete_task";
	void mutate("care_update_maternal_plan", { update: { kind, taskId: task.id } }, "task").catch(() => setNotice("Reopen this card from the conversation to continue editing."));
});
root.addEventListener("submit", (event) => {
	if (!(event.target instanceof HTMLFormElement) || event.target.id !== "question-form") return;
	event.preventDefault();
	if (busy || !event.target.reportValidity()) return;
	const text = draft.question.trim();
	if (!text) { setNotice("Write a question before saving it."); return; }
	void mutate("care_update_maternal_plan", { update: { kind: "add_question", text } }, "question").catch(() => setNotice("Reopen this card from the conversation to save your question."));
});
root.addEventListener("click", (event) => {
	if (!(event.target instanceof Element)) return;
	const link = event.target.closest<HTMLAnchorElement>("a[data-official-link]");
	if (link) {
		event.preventDefault();
		if (link.href !== urgentSignsUrl && link.href !== maternalSupportUrl) return;
		void connection.openLink(link.href).then((opened) => { if (!opened) setNotice("This chat could not open the link. You can ask for the official resource in the conversation."); }).catch(() => setNotice("The link could not be opened. You can ask for the official resource in the conversation."));
		return;
	}
	const button = event.target.closest<HTMLButtonElement>("button[data-action]");
	if (!button || busy) return;
	if (button.dataset.action === "save-question") return;
	event.preventDefault();
	void (async () => {
		switch (button.dataset.action) {
			case "choose-time": await sendMessage("Help me choose or change the time for this fictional appointment."); break;
			case "prepare-visit": await sendMessage("Continue preparing this fictional visit using the context I have already supplied."); break;
			case "open-visit": await sendMessage("Open the consultation card for this fictional visit."); break;
			case "show-summary": await sendMessage("Show the sample after-visit summary for this visit."); break;
			case "show-plan": await sendMessage("Show my maternal follow-up plan from this sample visit."); break;
			case "prepare-plan": await sendMessage("Help me prepare for the next appointment using my saved follow-up plan and questions."); break;
			case "discuss-summary": await sendMessage("Help me understand the next steps in this sample after-visit summary."); break;
			case "begin-visit": if (current?.cardKind === "consultation" && current.consultation.kind === "not-started" && current.consultation.canBegin) await mutate("care_begin_consultation", { mode: current.consultation.mode }, "begin"); break;
			case "finish-visit": await mutate("care_finish_consultation", {}, "finish"); break;
			case "add-question": draft.questionOpen = true; render(); document.getElementById("question")?.focus(); break;
			case "cancel-question": draft.questionOpen = false; render(); document.getElementById("card-add-question")?.focus(); break;
			case "save-summary": {
				if (current?.cardKind !== "after-visit") break;
				const text = summaryText(current);
				if (!text) break;
				if (await connection.download(text, "sample-after-visit-summary.txt")) setNotice("Summary download requested.");
				else await sendMessage("Provide a copy of this sample after-visit summary that I can save.");
				break;
			}
			case "retry": if (retry === "mutation") await runPending(); else {
				setBusy(true);
				await refresh({ clearNotice: true });
				setBusy(false);
				(document.getElementById("card-retry") ?? content.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"))?.focus({ preventScroll: true });
			} break;
		}
	})().catch(() => { setBusy(false); setNotice("That action could not be completed. Continue from the conversation or try again."); });
});

window.addEventListener("pagehide", () => { void media.stop(); });
if (window.parent === window) {
	content.innerHTML = '<p class="eyebrow">Visit cards</p><h1>Open a card in your conversation</h1><p class="supporting">Ask your connected assistant to show an appointment, visit, summary, or maternal follow-up plan.</p>';
} else {
	void connection.connect().catch(() => {
		if (!current) content.innerHTML = '<h1>Visit card unavailable</h1>';
		setNotice("This card could not connect. Ask to show the visit again in the conversation.");
	});
}
