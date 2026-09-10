import {
	accessNeedsSchema,
	advanceInputSchema,
	commandIdSchema,
	credentialSchema,
	intakeSchema,
	resumeInputSchema,
	startInputSchema,
	usStates,
	visitCommandSchema,
	type AccessNeeds,
	type AdvanceInput,
	type Appointment,
	type CareResult,
	type Intake,
	type Quote,
	type VisitCommand,
	type VisitEnvelope,
	type VisitState,
} from "../contracts.ts";
import { createCareConnection } from "./client.ts";
import { createMediaPanel } from "./media.ts";

type Section = "current" | "appointment" | "intake" | "coverage" | "overview" | "resume";
type Notice = { kind: "info" | "error" | "conflict"; message: string };
type PendingSave = { input: AdvanceInput; formId: string } & ({ kind: "visit" } | { kind: "payment"; quote: Quote });

const root = document.getElementById("app");
if (!root) throw new Error("The visit application container is missing.");

root.innerHTML = `
	<header class="site-header">
		<span class="demo-label">Developer preview</span>
		<div class="header-actions">
			<button class="text-button small" data-action="larger-text" aria-pressed="false">Larger text</button>
			<button class="text-button small" data-action="overview" id="header-visit-details" hidden>Visit details</button>
			<button class="text-button small" data-action="resume-panel">Save or resume</button>
		</div>
	</header>
	<div class="app-layout">
		<aside class="visit-rail" aria-label="Visit progress"><nav id="progress" aria-label="Visit steps"></nav></aside>
		<main id="main-content" class="content-sheet" tabindex="-1"><div id="feedback" aria-live="polite"></div><div id="task"></div><p id="save-status" class="visit-status" role="status" aria-live="polite"></p></main>
	</div>
`;

const task = requiredElement("task");
const feedback = requiredElement("feedback");
const progress = requiredElement("progress");
const saveStatus = requiredElement("save-status");
let envelope: VisitEnvelope | undefined;
let section: Section = "current";
let notice: Notice | undefined;
let pendingSave: PendingSave | undefined;
let busy = false;
let connected = false;
let largerText: boolean | undefined;
const drafts = new Map<string, FormData>();
const storageKey = "virtual-care-synthetic-credential";

const connection = createCareConnection({
	onVisit: (result) => {
		if (result.kind !== "error" && envelope?.snapshot.visitId === result.envelope.snapshot.visitId && result.envelope.snapshot.revision < envelope.snapshot.revision) return;
		acceptResult(result, false);
	},
	onError: (message) => { notice = { kind: "error", message }; renderFeedback(); },
	onTeardown: () => { void media.stop(); },
});
document.documentElement.classList.toggle("embedded", connection.embedded);

const media = createMediaPanel({
	join: async (mode) => {
		if (!envelope) return { kind: "error", message: "Open a saved practice visit first." };
		return connection.media({ credential: envelope.credential, mode });
	},
	openBrowser: async () => { await openBrowser(); },
});

const stateNames: Record<typeof usStates[number], string> = {
	AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", VI: "US Virgin Islands", GU: "Guam", AS: "American Samoa", MP: "Northern Mariana Islands",
};

function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error("A required visit element is missing.");
	return element;
}

function escape(value: string | number): string {
	return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function value(formId: string, name: string, fallback = ""): string {
	const entry = drafts.get(formId)?.get(name);
	return typeof entry === "string" ? entry : fallback;
}

function checked(formId: string, name: string, fallback = false): boolean {
	const draft = drafts.get(formId);
	return draft ? draft.has(name) : fallback;
}

function isChecked(condition: boolean): string { return condition ? " checked" : ""; }
function isSelected(condition: boolean): string { return condition ? " selected" : ""; }
function formatMoney(cents: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100); }
function formatDate(instant: string, timeZone = "America/New_York", includeTime = true): string {
	return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", ...(includeTime ? { timeStyle: "short" } : {}), timeZone }).format(new Date(instant));
}

function effectiveState(state: VisitState): Exclude<VisitState, { kind: "cancelled" }> {
	return state.kind === "cancelled" ? state.previous : state;
}

function appointmentOf(): Appointment | undefined {
	if (!envelope) return undefined;
	const state = effectiveState(envelope.snapshot.state);
	return "appointment" in state ? state.appointment : undefined;
}

function intakeOf(): Intake | undefined {
	if (!envelope) return undefined;
	const state = effectiveState(envelope.snapshot.state);
	return "intake" in state ? state.intake : undefined;
}

function hasAction(action: VisitCommand["kind"]): boolean {
	return envelope?.availableActions.includes(action) ?? false;
}

function currentStep(): number {
	if (!envelope) return 0;
	const state = effectiveState(envelope.snapshot.state);
	switch (state.kind) {
		case "appointment": return 0;
		case "intake":
		case "coverage":
		case "payment":
		case "consent": return 1;
		case "ready":
		case "consulting": return 2;
		case "complete": return 3;
		default: { const exhaustive: never = state; return exhaustive; }
	}
}

function currentTaskLabel(): string {
	if (!envelope) return "Visit steps";
	if (section === "resume") return "Save or resume";
	if (section === "overview") return "Visit details";
	if (section === "appointment") return "Appointment";
	if (section === "intake") return "Your answers";
	if (section === "coverage") return "Coverage and cost";
	const labels: Record<VisitState["kind"], string> = { appointment: "Appointment", intake: "Your answers", coverage: "Coverage and cost", payment: "Test payment", consent: "Review and consent", ready: "Ready to join", consulting: "Practice room", complete: "Visit record", cancelled: "Visit canceled" };
	return labels[envelope.snapshot.state.kind];
}

function intro(title: string, body?: string): string {
	return `<div class="task-intro"><h1>${escape(title)}</h1>${body ? `<p>${escape(body)}</p>` : ""}</div>`;
}

function textArea(formId: string, name: string, label: string, fallback: string, maximum: number, options: { required?: boolean; hint?: string; compact?: boolean } = {}): string {
	return `<div class="field"><label for="${name}">${escape(label)}${options.required ? "" : ' <span class="optional">Optional</span>'}</label>${options.hint ? `<p class="field-hint" id="${name}-hint">${escape(options.hint)}</p>` : ""}<textarea id="${name}" name="${name}" maxlength="${maximum}"${options.required ? ' required minlength="3"' : ""}${options.hint ? ` aria-describedby="${name}-hint"` : ""}${options.compact ? ' class="compact"' : ""}>${escape(value(formId, name, fallback))}</textarea></div>`;
}

function checkbox(formId: string, name: string, label: string, fallback = false, hint = "", required = false): string {
	return `<label class="check" for="${name}"><input type="checkbox" id="${name}" name="${name}"${isChecked(checked(formId, name, fallback))}${required ? " required" : ""}><span>${escape(label)}${hint ? `<small>${escape(hint)}</small>` : ""}</span></label>`;
}

function radio(name: string, option: string, title: string, detail: string, selected: string): string {
	return `<label class="choice"><input type="radio" id="radio-${escape(name)}-${escape(option)}" name="${name}" value="${escape(option)}" required${isChecked(selected === option)}><span><strong>${escape(title)}</strong><small>${escape(detail)}</small></span></label>`;
}

function render(): void {
	const focused = document.activeElement;
	const focusId = focused instanceof HTMLElement ? focused.id : "";
	const openDisclosures = [...document.querySelectorAll<HTMLDetailsElement>("#app details[open][id]")].map((element) => element.id);
	document.documentElement.classList.toggle("large-text", largerText ?? envelope?.snapshot.access.largeText ?? false);
	const textControl = root?.querySelector('[data-action="larger-text"]');
	textControl?.setAttribute("aria-pressed", String(document.documentElement.classList.contains("large-text")));
	const step = currentStep();
	requiredElement("header-visit-details").hidden = !envelope;
	progress.innerHTML = envelope ? `<details class="progress-disclosure" id="visit-steps-details"><summary id="visit-steps-summary">${escape(currentTaskLabel())}<span class="progress-hint">Visit steps</span></summary><ol class="progress-list">${["Appointment", "Before your visit", "Visit room", "After your visit"].map((label, index) => `<li><button id="visit-step-${index}" class="step${index < step ? " step-done" : ""}" data-action="step" data-step="${index}"${index === step ? ' aria-current="step"' : ""}${index > step ? " disabled" : ""}><span class="step-number" aria-hidden="true">${index < step ? "✓" : index + 1}</span><span>${label}</span></button></li>`).join("")}</ol></details>` : "";

	if (section === "resume") task.innerHTML = renderResume();
	else if (!envelope) task.innerHTML = renderWelcome();
	else if (section === "overview") task.innerHTML = renderOverview();
	else if (section === "appointment") task.innerHTML = renderAppointment();
	else if (section === "intake") task.innerHTML = renderIntake();
	else if (section === "coverage") task.innerHTML = renderCoverage();
	else {
		const state = envelope.snapshot.state;
		switch (state.kind) {
			case "appointment": task.innerHTML = renderAppointment(); break;
			case "intake": task.innerHTML = renderIntake(); break;
			case "coverage": task.innerHTML = renderCoverage(); break;
			case "payment": task.innerHTML = renderPayment(state); break;
			case "consent": task.innerHTML = renderConsent(); break;
			case "ready": task.innerHTML = renderReady(); break;
			case "consulting": task.innerHTML = renderConsultation(state); break;
			case "complete": task.innerHTML = renderAfterVisit(state); break;
			case "cancelled": task.innerHTML = renderCancelled(); break;
			default: { const exhaustive: never = state; task.textContent = exhaustive; }
		}
	}
	for (const id of openDisclosures) {
		const disclosure = document.getElementById(id);
		if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
	}
	for (const button of task.querySelectorAll<HTMLButtonElement>("button:not([id])")) {
		if (button.dataset.action) button.id = `task-action-${button.dataset.action}`;
		else if (button.type === "submit" && button.form) button.id = `${button.form.id}-submit`;
	}
	const mediaSlot = task.querySelector<HTMLElement>("[data-media-slot]");
	if (mediaSlot && envelope) {
		const state = envelope.snapshot.state;
		if (state.kind === "consulting") {
			media.configure({ visitId: envelope.snapshot.visitId, mode: state.consultation.mode, embedded: connection.embedded });
			mediaSlot.append(media.element);
		}
	} else void media.stop();
	renderFeedback();
	setBusy(busy);
	if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function navigate(next: Section, clearNotice = false): void {
	section = next;
	if (clearNotice) notice = undefined;
	render();
	requiredElement("main-content").focus();
}

function renderFeedback(): void {
	const currentNotice = notice ?? (pendingSave ? { kind: "error", message: "The previous save is still unconfirmed. Retry the same save to check its result without repeating the change." } satisfies Notice : undefined);
	feedback.innerHTML = currentNotice ? `<div class="notice ${currentNotice.kind === "error" ? "notice-error" : currentNotice.kind === "conflict" ? "notice-warning" : ""}" role="${currentNotice.kind === "error" ? "alert" : "status"}"><p>${escape(currentNotice.message)}</p>${pendingSave ? '<div class="actions"><button id="retry-save" class="button button-secondary" data-action="retry-save">Retry the same save</button><button id="check-saved-visit" class="text-button" data-action="refresh">Check saved visit</button></div>' : ""}</div>` : "";
}

function renderWelcome(): string {
	const selected = value("start-form", "scenarioId", "rural-adult");
	return `${intro("Let's prepare for your visit")}
		<form id="start-form" class="form-stack"><fieldset><legend>Choose a sample situation</legend><div class="choice-list">
		${radio("scenarioId", "rural-adult", "A visit from a rural community", "Try an audio-first visit and connection options.", selected)}
		${radio("scenarioId", "older-adult", "A visit with extra support", "Try larger text, caregiver preferences, and a clear step-by-step flow.", selected)}
		${radio("scenarioId", "uninsured-adult", "A visit without insurance", "Explore simulated self-pay and financial assistance.", selected)}
		</div></fieldset><div class="actions"><button type="submit" class="button">Start a practice visit</button><button type="button" class="text-button" data-action="resume-panel">Resume a saved visit</button></div></form>`;
}

function renderAppointment(): string {
	if (!envelope) return renderWelcome();
	const appointment = appointmentOf();
	const location = value("appointment-form", "locationState", appointment?.locationState ?? "NY");
	const zone = value("appointment-form", "timeZone", appointment?.timeZone ?? "America/New_York");
	const slot = value("appointment-form", "slotId", appointment?.id ?? "slot-1");
	const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico", "Pacific/Guam"];
	if (!zones.includes(zone)) zones.push(zone);
	return `${intro("Choose a time that works")}
		<form id="appointment-form" class="form-stack"><div class="field-pair"><div class="field"><label for="locationState">Visit location</label><select id="locationState" name="locationState" required>${usStates.map((code) => `<option value="${code}"${isSelected(code === location)}>${stateNames[code]}</option>`).join("")}</select><p class="field-hint">US state or territory.</p></div><div class="field"><label for="timeZone">Show times in</label><select id="timeZone" name="timeZone" required>${zones.map((entry) => `<option value="${escape(entry)}"${isSelected(entry === zone)}>${escape(entry.replaceAll("_", " "))}</option>`).join("")}</select></div></div><fieldset><legend>Available practice appointments</legend><div class="choice-list">${envelope.snapshot.appointmentOptions.map((option) => radio("slotId", option.id, formatDate(option.startsAt, zone), `20 minutes · ${zone.replaceAll("_", " ")}`, slot)).join("")}</div></fieldset>
		${appointment ? '<div class="notice notice-warning">Changing the appointment means reviewing your coverage and consent again.</div>' : ""}<div class="actions"><button class="button" type="submit">${appointment ? "Save appointment changes" : "Save this appointment"}</button>${appointment ? '<button type="button" class="text-button" data-action="current">Keep current appointment</button>' : ""}</div></form>`;
}

function renderIntake(): string {
	if (!envelope) return renderWelcome();
	const intake = intakeOf();
	const access = envelope.snapshot.access;
	return `${intro("What would you like to discuss?", "Use made-up details for this demo.")}
		<form id="intake-form" class="form-stack">
		${textArea("intake-form", "reason", "Reason for visit", intake?.reason ?? "", 1200, { required: true, hint: "For example: I'd like to practice a routine follow-up visit." })}
		<button type="button" class="text-button small" data-action="sample-intake">Fill in a fictional example</button>
		${textArea("intake-form", "goals", "What would you like to cover?", intake?.goals ?? "", 1200, { compact: true })}
		<details class="disclosure" id="intake-other-details"><summary id="intake-other-summary">Other visit details <span class="optional">Optional</span></summary><div class="form-stack"><div class="field-pair">${textArea("intake-form", "medications", "Medications", intake?.medications ?? "", 1200, { compact: true })}${textArea("intake-form", "allergies", "Allergies", intake?.allergies ?? "", 1200, { compact: true })}</div>${textArea("intake-form", "communicationNotes", "Anything else that would help you communicate?", intake?.communicationNotes ?? "", 800, { compact: true })}</div></details>
		<section class="form-section"><h2>Make the visit easier to use</h2>${renderAccess("intake-form", access)}</section>
		<div class="actions"><button type="submit" class="button">Save and continue</button><button type="button" class="text-button" data-action="edit-appointment">Review appointment</button></div></form>`;
}

function renderAccess(formId: string, access: AccessNeeds): string {
	const mode = value(formId, "mode", access.mode);
	const language = value(formId, "language", access.language);
	const caregiver = checked(formId, "caregiverRequested", access.caregiver.kind === "requested");
	return `<div class="form-stack"><fieldset><legend>How would you like to practice?</legend><div class="choice-list">
		${radio("mode", "audio", "Audio first", "Use your microphone without video.", mode)}
		${radio("mode", "video", "Video", "Preview your camera before connecting.", mode)}
		${radio("mode", "text", "Text practice", "No camera or microphone needed.", mode)}
		</div></fieldset><div>${checkbox(formId, "largeText", "Use larger text", access.largeText)}${checkbox(formId, "lowBandwidth", "Use less data", access.lowBandwidth, "Prefer audio or text. Keep video off until I choose it.")}</div>
		<details class="disclosure" id="intake-access-details"><summary id="intake-access-summary">Language, captions, or caregiver</summary><div class="form-stack"><div class="field"><label for="language">Preferred language</label><select id="language" name="language"><option value="en"${isSelected(language === "en")}>English</option><option value="es"${isSelected(language === "es")}>Spanish</option><option value="other"${isSelected(language === "other")}>Another language</option></select><p class="field-hint">Language preference only; translation is unavailable.</p></div><div>${checkbox(formId, "interpreterRequested", "I would like an interpreter", access.interpreterRequested, "Preference only; an interpreter will not join.")}${checkbox(formId, "captionsRequested", "I would like captions", access.captionsRequested, "Live captions are unavailable; the conversation has a text version.")}${checkbox(formId, "caregiverRequested", "I would like a caregiver to join", access.caregiver.kind === "requested", "Preference only; no invitation is sent.")}</div>
		<div class="field" id="caregiver-name-field"${caregiver ? "" : " hidden"}><label for="caregiverName">Caregiver name <span class="optional">Optional</span></label><input id="caregiverName" name="caregiverName" maxlength="80" autocomplete="off" value="${escape(value(formId, "caregiverName", access.caregiver.kind === "requested" ? access.caregiver.name : ""))}"></div></div></details></div>`;
}

function renderCoverage(): string {
	if (!envelope) return renderWelcome();
	const selected = value("coverage-form", "paymentKind", "insurance");
	const scenario = value("coverage-form", "insuranceScenario", "active-copay");
	const state = envelope.snapshot.state;
	const check = state.kind === "coverage" ? state.insuranceCheck : null;
	const scenarios = [
		["active-copay", "Active coverage with a sample copay"], ["inactive", "Inactive coverage"], ["unknown-member", "Member not found"], ["benefits-unavailable", "Benefits information unavailable"], ["prior-authorization-required", "Prior authorization required"], ["claim-denied", "Coverage now, mock claim denied later"],
	];
	return `${intro("Choose a payment option")}
		${check ? `<div class="notice notice-warning"><strong>Simulated insurance result</strong><p>${escape(check.explanation)}</p><p>${check.patientEstimateCents === null ? "Your sample cost is unknown." : `Sample patient estimate: ${formatMoney(check.patientEstimateCents)}`}</p></div>` : ""}
		<form id="coverage-form" class="form-stack"><fieldset><legend>Payment path</legend><div class="choice-list">
		${radio("paymentKind", "insurance", "Use demo insurance", "Try an eligibility response from Community Demo Health.", selected)}
		${radio("paymentKind", "self-pay", "Try a simulated self-pay payment", "$35 test payment. No wallet needed.", selected)}
		${radio("paymentKind", "assistance", "Use demo financial assistance", "$0 demo cost.", selected)}
		</div></fieldset><div class="field" id="insurance-scenario-field"${selected === "insurance" ? "" : " hidden"}><label for="insuranceScenario">Insurance scenario</label><select id="insuranceScenario" name="insuranceScenario">${scenarios.map(([id, label]) => `<option value="${escape(id ?? "")}"${isSelected(id === scenario)}>${escape(label ?? "")}</option>`).join("")}</select><p class="field-hint">Eligibility and claim approval are separate results.</p></div><div class="actions"><button type="submit" id="coverage-submit" class="button">${selected === "insurance" ? "Check demo coverage" : "Continue with this option"}</button><button type="button" class="text-button" data-action="edit-intake">Review your answers</button></div></form>`;
}

function renderPayment(state: Extract<VisitState, { kind: "payment" }>): string {
	return `${intro("Review your test payment", "Try an approval or decline. No money is transferred.")}
		<div class="cost-block"><div class="cost-amount">${formatMoney(state.quote.amountCents)}</div></div><p class="field-hint">Quote expires ${escape(formatDate(state.quote.expiresAt, state.appointment.timeZone))}.</p>
		<div class="form-stack form-section"><div class="actions"><button class="button" data-action="approve-payment">Approve simulated payment</button><button class="button button-secondary" data-action="decline-payment">Try a declined payment</button></div><button class="text-button" data-action="edit-coverage">Choose another payment option</button></div>`;
}

function reviewDetails(showEdit: boolean, includeBilling = true): string {
	if (!envelope) return "";
	const state = effectiveState(envelope.snapshot.state);
	const appointment = "appointment" in state ? state.appointment : undefined;
	const intake = "intake" in state ? state.intake : undefined;
	const access = envelope.snapshot.access;
	const row = (title: string, detail: string) => `<div class="review-row"><dt>${escape(title)}</dt><dd>${escape(detail || "Not provided")}</dd></div>`;
	const editButton = (action: string, allowed: boolean, title: string) => showEdit && allowed ? `<button class="text-button small" data-action="${action}">${title}</button>` : "";
	return `${appointment ? `<section class="review-section"><div class="review-heading"><h2>Appointment</h2>${editButton("edit-appointment", hasAction("choose_appointment"), "Edit appointment")}</div><dl class="review-list">${row("When", `${formatDate(appointment.startsAt, appointment.timeZone)}\n${appointment.timeZone.replaceAll("_", " ")}`)}${row("Location", stateNames[appointment.locationState])}${row("Care team", "Demo care team · 20 minutes")}</dl></section>` : ""}
		${intake ? `<section class="review-section"><div class="review-heading"><h2>Your answers</h2>${editButton("edit-intake", hasAction("save_intake"), "Edit answers")}</div><dl class="review-list">${row("Reason", intake.reason)}${row("Goals", intake.goals)}${row("Medications", intake.medications)}${row("Allergies", intake.allergies)}${row("Communication", intake.communicationNotes)}</dl></section>` : ""}
		<section class="review-section"><h2>Access preferences</h2><dl class="review-list">${row("Visit mode", access.mode === "text" ? "Text practice" : access.mode === "audio" ? "Audio first" : "Video")}${row("Language", `${access.language === "en" ? "English" : access.language === "es" ? "Spanish (translation unavailable)" : "Another language (translation unavailable)"}${access.interpreterRequested ? "; interpreter requested (unavailable in this demo)" : ""}`)}${row("Caregiver", access.caregiver.kind === "requested" ? `${access.caregiver.name || "A caregiver"} requested. No invitation sent.` : "Not requested")}${row("Display", [access.largeText ? "Larger text" : "Standard text", ...(access.lowBandwidth ? ["Less data preferred"] : []), ...(access.captionsRequested ? ["Captions requested (unavailable)"] : [])].join(". "))}</dl></section>
		${includeBilling && "billing" in state ? `<section class="review-section"><div class="review-heading"><h2>Coverage and payment</h2>${editButton("edit-coverage", hasAction("select_payment"), "Change payment option")}</div>${billingDetails(state)}</section>` : ""}`;
}

function billingDetails(state: Extract<VisitState, { billing: unknown }>): string {
	const billing = state.billing;
	switch (billing.kind) {
		case "insurance": return `<div class="notice"><strong>Demo insurance</strong><p>${escape(billing.eligibility.explanation)}</p><p>${billing.eligibility.patientEstimateCents === null ? "Sample patient cost is unknown." : `Sample patient estimate: ${formatMoney(billing.eligibility.patientEstimateCents)}`}</p></div>`;
		case "self-pay": return `<div class="notice"><strong>Payment simulation complete</strong><p>${formatMoney(billing.receipt.amountCents)} test receipt. No funds transferred.</p></div>`;
		case "assistance": return `<div class="notice"><strong>Demo financial assistance</strong><p>${escape(billing.explanation)}</p><p>Patient estimate: $0.00.</p></div>`;
		default: { const exhaustive: never = billing; return exhaustive; }
	}
}

function renderConsent(): string {
	return `${intro("Review your visit")}
		${reviewDetails(true)}<form id="consent-form" class="form-stack form-section"><h2>Before you enter the practice visit</h2><div>
		${checkbox("consent-form", "syntheticDataOnly", "I have used made-up information only.", false, "", true)}
		${checkbox("consent-form", "understandsSimulation", "I understand this is a demo with no clinician providing care.", false, "", true)}
		${checkbox("consent-form", "telehealthAcknowledged", "I understand camera and microphone access are optional.", false, "Demo calls connect test participants only.", true)}
		${checkbox("consent-form", "locationConfirmed", "The location and time zone above are correct.", false, "", true)}
		</div><div class="actions"><button type="submit" class="button">Agree and prepare to join</button></div></form>`;
}

function renderReady(): string {
	if (!envelope) return "";
	const mode = value("join-form", "mode", envelope.snapshot.access.mode);
	return `${intro("You're ready for your practice visit")}
		<form id="join-form" class="form-stack form-section"><fieldset><legend>Choose your practice mode</legend><div class="choice-list">${radio("mode", "audio", "Audio first", "Microphone preview and an optional demo call.", mode)}${radio("mode", "video", "Video", "Camera preview and an optional demo call.", mode)}${radio("mode", "text", "Text practice", "Scripted conversation, no device access.", mode)}</div></fieldset><div class="actions"><button type="submit" class="button">Enter practice visit</button><button type="button" class="text-button" data-action="overview">Review visit details</button></div></form>`;
}

function renderConsultation(state: Extract<VisitState, { kind: "consulting" }>): string {
	return `${intro("You're in the practice room", "Replies are scripted and do not provide medical advice.")}
		${state.consultation.mode === "text" ? "" : "<div data-media-slot></div>"}
		<section aria-labelledby="conversation-heading"><h2 id="conversation-heading">Conversation</h2><p class="field-hint">This conversation does not transcribe live audio.</p><div class="chat-log" role="log" aria-label="Practice conversation" aria-live="polite" aria-relevant="additions">${state.consultation.messages.map((message) => `<article class="chat-message${message.kind === "participant" ? " participant" : ""}"><strong>${message.kind === "participant" ? "You" : "Demo reply"}</strong><p>${escape(message.text)}</p></article>`).join("") || '<p class="field-hint">Your practice conversation will appear here.</p>'}</div><form id="message-form" class="chat-form"><div class="field"><label for="message">Your practice message</label><textarea id="message" name="message" class="compact" maxlength="1200" required aria-describedby="message-hint">${escape(value("message-form", "message"))}</textarea><p class="field-hint" id="message-hint">Messages are saved with this visit.</p></div><div class="actions"><button type="submit" class="button button-secondary">Send practice message</button></div></form></section>
		<div class="room-footer"><div class="actions"><button class="button" data-action="finish-visit">Finish practice visit</button></div></div>`;
}

function renderAfterVisit(state: Extract<VisitState, { kind: "complete" }>): string {
	return `${intro("Your practice visit is complete")}
		<p class="record-label">Demo summary · Not reviewed by a clinician</p><section class="review-section"><h2>${escape(state.afterVisit.title)}</h2><p>${escape(state.afterVisit.summary)}</p><h3 style="margin-top:1.3rem">Sample next steps</h3><ul>${state.afterVisit.nextSteps.map((step) => `<li>${escape(step)}</li>`).join("")}</ul></section>
		<section class="review-section"><h2>Insurance and payment record</h2>${billingDetails(state)}<p class="field-hint" style="margin-top:.8rem">${state.afterVisit.claimStatus === "not-applicable" ? "No demo insurance claim applies to this payment path." : state.afterVisit.claimStatus === "simulated-denied" ? "The demo claim was denied locally. Nothing was sent to an insurer." : "The demo claim was approved locally. Nothing was sent to an insurer."}</p></section>
		<div class="actions form-section no-print"><button class="button" data-action="print">${connection.embedded ? "Open record to print" : "Print this record"}</button><button class="button button-secondary" data-action="download-record">Download visit record</button><button class="text-button" data-action="download-fhir">Download FHIR sample</button></div>
		<details class="disclosure" id="aftercare-answers-details"><summary id="aftercare-answers-summary">Appointment and answers</summary>${reviewDetails(false, false)}</details><div class="print-only">Record created ${escape(formatDate(state.afterVisit.createdAt, state.appointment.timeZone))}. Source: scripted demonstration. No clinician reviewed or signed this document.</div><div class="form-section no-print"><button class="text-button" data-action="resume-panel">Save this visit for another device</button><button class="text-button" data-action="start-over">Start another practice visit</button></div>`;
}

function renderCancelled(): string {
	return `${intro("Your demo appointment is canceled", "You can still view the saved record until it expires.")}<div class="actions"><button class="button" data-action="start-over">Start another practice visit</button><button class="button button-secondary" data-action="overview">View the saved record</button></div>`;
}

function renderOverview(): string {
	return `${intro("Visit details")}${reviewDetails(true)}<div class="actions form-section"><button class="button" data-action="current">Return to your visit</button>${hasAction("cancel_visit") ? '<button class="button button-danger" data-action="cancel-visit">Cancel demo appointment</button>' : ""}</div>`;
}

function renderResume(): string {
	return `${intro("Save or resume a practice visit", "Use a resume code to continue on another device or in a connected chat.")}
		${envelope ? `<section class="form-stack"><div class="field"><label for="saved-credential">Your practice visit's resume code</label><textarea id="saved-credential" class="credential-field compact" readonly spellcheck="false">${escape(envelope.credential)}</textarea><p class="field-hint">Anyone with this code can view the visit until ${escape(formatDate(envelope.expiresAt))} and change it while it remains open. Keep it with your demo materials.</p></div><div class="actions"><button class="button button-secondary" data-action="copy-credential">Copy resume code</button>${connection.embedded ? '<button class="button button-secondary" data-action="open-browser">Open in browser</button>' : '<button class="button button-secondary" data-action="copy-link">Copy browser link</button>'}</div><button class="text-button" data-action="current">Return to this visit</button></section>` : ""}
		<form id="resume-form" class="form-stack${envelope ? " form-section" : ""}"><div class="field"><label for="resumeCredential">${envelope ? "Open another saved visit" : "Paste your resume code"}</label><textarea id="resumeCredential" name="resumeCredential" class="credential-field compact" required maxlength="100" spellcheck="false" autocomplete="off">${escape(value("resume-form", "resumeCredential"))}</textarea></div><div class="actions"><button class="button" type="submit">Resume practice visit</button>${!envelope ? '<button type="button" class="text-button" data-action="start-over">Start a new practice visit</button>' : ""}</div></form>`;
}

function accessFrom(form: FormData): AccessNeeds {
	return accessNeedsSchema.parse({
		mode: form.get("mode"), language: form.get("language"), interpreterRequested: form.has("interpreterRequested"), captionsRequested: form.has("captionsRequested"), largeText: form.has("largeText"), lowBandwidth: form.has("lowBandwidth"),
		caregiver: form.has("caregiverRequested") ? { kind: "requested", name: form.get("caregiverName") ?? "" } : { kind: "none" },
	});
}

function rememberCredential(): void {
	if (connection.embedded || !envelope) return;
	try { sessionStorage.setItem(storageKey, envelope.credential); } catch { /* Session storage is optional. */ }
}

function acceptResult(result: CareResult, resetSection: boolean): void {
	if (result.kind === "error") {
		notice = { kind: "error", message: result.message };
		if (result.code === "expired" || result.code === "not_found") {
			try { if (!connection.embedded) sessionStorage.removeItem(storageKey); } catch { /* Recovery does not depend on storage. */ }
		}
	} else {
		envelope = result.envelope;
		rememberCredential();
		if (result.kind === "conflict") notice = { kind: "conflict", message: `${result.message} Your unsaved answers have been kept. Review the latest visit details before saving again.` };
		else if (resetSection) { section = "current"; notice = undefined; }
		const phase = envelope.snapshot.state.kind;
		if (phase === "complete" || phase === "cancelled") void media.stop();
	}
	render();
}

function setBusy(value: boolean): void {
	busy = value;
	task.setAttribute("aria-busy", String(value));
	for (const control of task.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea")) control.disabled = value;
	for (const control of feedback.querySelectorAll<HTMLButtonElement>("button")) control.disabled = value;
	if (value) saveStatus.textContent = "Saving your practice visit…";
	else if (pendingSave) saveStatus.textContent = "Save not confirmed. Retry the same save to check its result.";
	else if (drafts.has(task.querySelector("form")?.id ?? "")) saveStatus.textContent = "Unsaved changes on this screen.";
	else if (envelope) saveStatus.textContent = "Saved.";
	else saveStatus.textContent = connected ? "Ready when you are." : "Connecting to your visit…";
}

async function save(command: VisitCommand, formId = ""): Promise<void> {
	if (!envelope || busy) return;
	if (pendingSave) { notice = { kind: "error", message: "First retry the previous save or check the saved visit. We have not yet confirmed that change." }; renderFeedback(); return; }
	const parsed = advanceInputSchema.parse({ credential: envelope.credential, expectedRevision: envelope.snapshot.revision, commandId: commandIdSchema.parse(crypto.randomUUID()), command });
	if (command.kind === "simulate_payment") {
		if (envelope.snapshot.state.kind !== "payment") return;
		pendingSave = { kind: "payment", input: parsed, formId, quote: envelope.snapshot.state.quote };
	} else pendingSave = { kind: "visit", input: parsed, formId };
	await runPendingSave();
}

async function runPendingSave(): Promise<void> {
	if (!pendingSave || busy) return;
	const attempted = pendingSave;
	setBusy(true);
	try {
		const result = attempted.kind === "payment" ? await connection.payment(attempted.input, attempted.quote) : await connection.advance(attempted.input);
		pendingSave = undefined;
		if (result.kind === "ok") {
			drafts.delete(attempted.formId);
			if (attempted.input.command.kind === "save_intake") largerText = attempted.input.command.access.largeText;
		}
		if (result.kind === "conflict") {
			if (attempted.formId === "intake-form" && result.envelope.availableActions.includes("save_intake")) section = "intake";
			else if (attempted.formId === "appointment-form" && result.envelope.availableActions.includes("choose_appointment")) section = "appointment";
			else if (attempted.formId === "coverage-form" && result.envelope.availableActions.includes("select_payment")) section = "coverage";
		}
		acceptResult(result, result.kind === "ok");
		if (result.kind === "ok" && attempted.input.command.kind === "send_demo_message") document.getElementById("message")?.focus();
		else if (result.kind === "ok") requiredElement("main-content").focus({ preventScroll: true });
	} catch {
		notice = { kind: "error", message: "We couldn't confirm the save. Your answers are still here. Retry the same save to check its result without repeating the change." };
		renderFeedback();
	} finally { setBusy(false); }
}

async function resume(credential: unknown): Promise<void> {
	const parsed = resumeInputSchema.safeParse({ credential });
	if (!parsed.success) { notice = { kind: "error", message: "Paste the complete resume code beginning with vcm_." }; renderFeedback(); return; }
	setBusy(true);
	try {
		const result = await connection.resume(parsed.data);
		if (result.kind === "ok") drafts.delete("resume-form");
		acceptResult(result, result.kind === "ok");
		if (result.kind === "ok") requiredElement("main-content").focus();
	} catch { notice = { kind: "error", message: "The saved visit could not be reached. Check your connection and try the same resume code again." }; renderFeedback(); }
	finally { setBusy(false); }
}

async function openBrowser(): Promise<void> {
	if (!envelope) return;
	try {
		if (await connection.openBrowser(envelope.credential)) return;
	} catch { /* A denied host link still permits text recovery. */ }
	notice = { kind: "info", message: "Your chat did not open a browser window. Copy the resume code to continue in the standalone app, or keep using the text practice here." };
	navigate("resume");
}

async function download(data: unknown, name: string, contentType: string): Promise<void> {
	try {
		if (await connection.downloadFile(JSON.stringify(data, null, 2), name, contentType)) return;
	} catch { /* The host may decline an otherwise valid download request. */ }
	notice = { kind: "info", message: "The download did not start. Open this visit in a browser to download the record, or use your resume code to continue there." };
	renderFeedback();
}

root.addEventListener("input", (event) => {
	const target = event.target;
	if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) || !target.form) return;
	drafts.set(target.form.id, new FormData(target.form));
	saveStatus.textContent = "Unsaved changes on this screen.";
});

root.addEventListener("change", (event) => {
	const target = event.target;
	if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || !target.form) return;
	drafts.set(target.form.id, new FormData(target.form));
	if (target.id === "timeZone") render();
	if (target.id === "caregiverRequested") {
		const field = document.getElementById("caregiver-name-field");
		if (field && target instanceof HTMLInputElement) field.hidden = !target.checked;
	}
	if (target.name === "paymentKind") {
		const field = document.getElementById("insurance-scenario-field");
		if (field) field.hidden = target.value !== "insurance";
		const submit = document.getElementById("coverage-submit");
		if (submit) submit.textContent = target.value === "insurance" ? "Check demo coverage" : "Continue with this option";
	}
});

root.addEventListener("submit", (event) => {
	event.preventDefault();
	const form = event.target;
	if (!(form instanceof HTMLFormElement) || busy) return;
	const data = new FormData(form);
	drafts.set(form.id, data);
	void (async () => {
		try {
			switch (form.id) {
				case "start-form": {
					setBusy(true);
					try { acceptResult(await connection.start(startInputSchema.parse({ scenarioId: data.get("scenarioId") })), true); }
					catch { notice = { kind: "error", message: "We couldn't open a practice visit. Check your connection and try again." }; renderFeedback(); }
					finally { setBusy(false); }
					break;
				}
				case "resume-form": await resume(data.get("resumeCredential")); break;
				case "appointment-form": await save(visitCommandSchema.parse({ kind: "choose_appointment", slotId: data.get("slotId"), locationState: data.get("locationState"), timeZone: data.get("timeZone") }), form.id); break;
				case "intake-form": {
					const intake = intakeSchema.parse({ reason: data.get("reason"), goals: data.get("goals"), medications: data.get("medications"), allergies: data.get("allergies"), communicationNotes: data.get("communicationNotes") });
					await save({ kind: "save_intake", intake, access: accessFrom(data) }, form.id);
					break;
				}
				case "coverage-form": {
					const choice = data.get("paymentKind") === "insurance" ? { kind: "insurance", scenario: data.get("insuranceScenario") } : { kind: data.get("paymentKind") };
					await save(visitCommandSchema.parse({ kind: "select_payment", choice }), form.id);
					break;
				}
				case "consent-form": await save(visitCommandSchema.parse({ kind: "accept_consent", version: "demo-2026-09-09", syntheticDataOnly: data.has("syntheticDataOnly"), understandsSimulation: data.has("understandsSimulation"), telehealthAcknowledged: data.has("telehealthAcknowledged"), locationConfirmed: data.has("locationConfirmed") }), form.id); break;
				case "join-form": await save(visitCommandSchema.parse({ kind: "enter_consultation", mode: data.get("mode") }), form.id); break;
				case "message-form": await save(visitCommandSchema.parse({ kind: "send_demo_message", text: data.get("message") }), form.id); break;
			}
		} catch { notice = { kind: "error", message: "Check the required fields and keep fictional answers within the allowed lengths. Text answers cannot contain only spaces." }; renderFeedback(); form.reportValidity(); }
	})();
});

root.addEventListener("click", (event) => {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const control = target.closest<HTMLButtonElement>("button[data-action]");
	if (!control || control.disabled) return;
	void (async () => {
		switch (control.dataset.action) {
			case "larger-text": largerText = !document.documentElement.classList.contains("large-text"); document.documentElement.classList.toggle("large-text", largerText); control.setAttribute("aria-pressed", String(largerText)); break;
			case "resume-panel": navigate("resume", true); break;
			case "current": navigate("current", true); break;
			case "overview": navigate("overview"); break;
			case "edit-appointment": if (hasAction("choose_appointment")) navigate("appointment"); break;
			case "edit-intake": if (hasAction("save_intake")) navigate("intake"); break;
			case "edit-coverage": if (hasAction("select_payment")) navigate("coverage"); break;
			case "step": {
				const step = Number(control.dataset.step);
				if (step === currentStep()) section = "current";
				else if (step === 0 && hasAction("choose_appointment")) section = "appointment";
				else if (step === 1 && hasAction("save_intake")) section = "intake";
				else section = "overview";
				navigate(section);
				break;
			}
			case "sample-intake": {
				const form = document.getElementById("intake-form");
				if (!(form instanceof HTMLFormElement)) break;
				const examples: Record<string, string> = { reason: "This is a fictional routine follow-up. I'd like to practice explaining what I want to discuss.", goals: "Practice asking questions and reviewing the next steps.", medications: "No real medication information entered.", allergies: "No real allergy information entered.", communicationNotes: "Please use clear language and leave time for questions." };
				for (const [name, text] of Object.entries(examples)) { const field = form.elements.namedItem(name); if (field instanceof HTMLTextAreaElement) field.value = text; }
				drafts.set(form.id, new FormData(form));
				saveStatus.textContent = "Fictional example filled in. Review it before saving.";
				break;
			}
			case "approve-payment":
			case "decline-payment": if (envelope?.snapshot.state.kind === "payment") await save({ kind: "simulate_payment", quoteId: envelope.snapshot.state.quote.id, outcome: control.dataset.action === "approve-payment" ? "approve" : "decline" }); break;
			case "finish-visit": await save({ kind: "finish_consultation" }); break;
			case "cancel-visit": await save({ kind: "cancel_visit" }); break;
			case "retry-save": await runPendingSave(); break;
			case "refresh": if (envelope) await resume(envelope.credential); break;
			case "open-browser": await openBrowser(); break;
			case "copy-credential":
			case "copy-link": {
				if (!envelope) break;
				const url = new URL(window.location.href); url.hash = new URLSearchParams({ resume: envelope.credential }).toString();
				try { await navigator.clipboard.writeText(control.dataset.action === "copy-link" ? url.toString() : envelope.credential); notice = { kind: "info", message: "Copied. Keep this code with your fictional practice materials." }; }
				catch { const field = document.getElementById("saved-credential"); if (field instanceof HTMLTextAreaElement) { field.focus(); field.select(); } notice = { kind: "info", message: "Copy the selected resume code using your device's copy command." }; }
				renderFeedback();
				break;
			}
			case "download-record": if (envelope) await download({ mode: "synthetic", notice: "Fictional practice record. No clinician reviewed this information. No medical advice, real claim, or payment.", snapshot: envelope.snapshot }, "practice-visit.json", "application/json"); break;
			case "download-fhir": {
				if (!envelope) break;
				setBusy(true);
				try { await download(await connection.exportRecord({ credential: envelope.credential }), "practice-visit-fhir.json", "application/fhir+json"); }
				catch { notice = { kind: "error", message: "The FHIR sample could not be downloaded. Try again, or download the visit record instead." }; renderFeedback(); }
				finally { setBusy(false); }
				break;
			}
			case "print": if (connection.embedded) await openBrowser(); else window.print(); break;
			case "start-over": {
				await media.stop(); envelope = undefined; pendingSave = undefined; notice = undefined; section = "current"; drafts.clear();
				try { if (!connection.embedded) sessionStorage.removeItem(storageKey); } catch { /* Starting a new demo does not require browser storage. */ }
				navigate("current"); break;
			}
		}
	})();
});

const printDisclosures = new Set<HTMLDetailsElement>();
window.addEventListener("beforeprint", () => {
	for (const disclosure of task.querySelectorAll<HTMLDetailsElement>("details:not([open])")) { printDisclosures.add(disclosure); disclosure.open = true; }
});
window.addEventListener("afterprint", () => {
	for (const disclosure of printDisclosures) disclosure.open = false;
	printDisclosures.clear();
});
window.addEventListener("pagehide", () => { void media.stop(); });
window.addEventListener("offline", () => { notice = { kind: "info", message: "Your connection is offline. Your saved visit is safe. Keep this screen open to retain unsaved answers, then save when you reconnect." }; renderFeedback(); });
window.addEventListener("online", () => { notice = { kind: "info", message: "Your internet connection is back. You can resume saving your practice visit." }; renderFeedback(); });

render();
void (async () => {
	try {
		await connection.connect();
		connected = true;
		setBusy(false);
		if (connection.embedded) return;
		const fragment = new URLSearchParams(window.location.hash.slice(1));
		const suppliedCredential = fragment.get("resume");
		if (window.location.hash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
		if (suppliedCredential) { await resume(suppliedCredential); return; }
		let saved: string | null = null;
		try { saved = sessionStorage.getItem(storageKey); } catch { /* A resume code also works without storage. */ }
		const parsed = credentialSchema.safeParse(saved);
		if (parsed.success) await resume(parsed.data);
	} catch { notice = { kind: "error", message: "The app could not connect to your chat. You can still use the assistant's text tools to resume the fictional visit." }; renderFeedback(); }
})();
