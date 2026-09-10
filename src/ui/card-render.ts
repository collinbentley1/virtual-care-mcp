import type { AfterVisitCard, AppointmentCard, CardResult, ConsultationCard, MaternalPlanCard, PlanQuestion } from "../contracts.ts";

export const urgentSignsUrl = "https://www.cdc.gov/hearher/maternal-warning-signs/index.html";
export const maternalSupportUrl = "https://mchb.hrsa.gov/programs-impact/national-maternal-mental-health-hotline";

export type CardDraft = { questionOpen: boolean; question: string };
export function escapeHtml(value: string | number): string {
	return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
const e = escapeHtml;
export function dateText(instant: string, timeZone: string, options: Intl.DateTimeFormatOptions = {}): string {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...options, timeZone }).format(new Date(instant));
}
function timeText(instant: string, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(new Date(instant));
}
function modeText(mode: "audio" | "video" | "text"): string {
	switch (mode) {
		case "audio": return "Audio visit";
		case "video": return "Video visit";
		case "text": return "Text visit";
	}
}
function action(label: string, name: string, secondary = false): string {
	return `<button class="button${secondary ? " button-secondary" : ""}" data-action="${e(name)}">${e(label)}</button>`;
}
function dateStamp(instant: string, timeZone: string): string {
	const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone }).format(new Date(instant));
	const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(new Date(instant));
	return `<div class="date-stamp" aria-hidden="true"><span>${e(month)}</span><strong>${e(day)}</strong></div>`;
}
function appointmentCard(card: AppointmentCard): string {
	const appointment = card.appointment;
	if (appointment.kind === "not-booked") return `<p class="eyebrow">Fictional appointment</p><h1>Find a time for your visit</h1><p class="supporting">Choose an appointment in the conversation, then its details will appear here.</p><div class="actions">${action("Choose a time", "choose-time")}</div>`;
	const details = appointment.details;
	const status = appointment.status === "cancelled" ? "Canceled" : appointment.status === "complete" ? "Visit complete" : "Appointment saved";
	const callToAction = appointment.status !== "scheduled" ? "" : appointment.readyToJoin ? action("Join demo visit", "open-visit") : action("Continue in chat", "prepare-visit");
	return `<div class="card-caption"><p class="eyebrow">Fictional appointment</p><span class="status-pill${appointment.status === "cancelled" ? " neutral" : ""}">${e(status)}</span></div>
		<h1>${e(card.purpose)}</h1><div class="appointment-date">${dateStamp(details.startsAt, details.timeZone)}<div><p class="appointment-day">${e(dateText(details.startsAt, details.timeZone, { weekday: "long" }))}</p><p class="appointment-time">${e(timeText(details.startsAt, details.timeZone))}</p><p class="supporting">${details.durationMinutes} minutes · ${e(modeText(card.access.mode))}</p></div></div>
		<div class="appointment-team"><span class="team-mark" aria-hidden="true">+</span><div><strong>${e(details.careTeam)}</strong><p class="supporting">${e(details.locationState)} · ${e(details.timeZone.replaceAll("_", " "))}</p></div></div>
		${callToAction ? `<div class="actions">${callToAction}${card.availableActions.includes("choose_appointment") ? action("Change time", "choose-time", true) : ""}</div>` : ""}`;
}
function consultationCard(card: ConsultationCard): string {
	const consultation = card.consultation;
	const heading = `<p class="eyebrow">Fictional visit</p><h1>${e(card.purpose)}</h1>`;
	switch (consultation.kind) {
		case "not-started": return `${heading}<p class="supporting">${consultation.canBegin ? "Your visit is ready. Camera and microphone stay off until you choose to use them." : "Finish preparing your visit in the conversation."}</p><div class="actions">${consultation.canBegin ? action("Enter demo visit", "begin-visit") : action("Continue in chat", "prepare-visit")}</div>`;
		case "active": return `${heading}<p class="visit-mode">${e(modeText(consultation.mode))}<span class="connection-dot" aria-hidden="true"></span>Demo room open</p>${consultation.mode === "text" ? '<div class="text-visit"><span aria-hidden="true">“</span><p>Continue in the conversation</p><p class="supporting">Your visit context is available there. This demo does not provide medical care.</p></div>' : '<div data-media-slot></div>'}<div class="call-footer"><p class="supporting">No clinician is providing care in this demo.</p>${action("End demo visit", "finish-visit")}</div>`;
		case "ended": return `${heading}<div class="completed-heading"><span class="completion-mark" aria-hidden="true">✓</span><div><h2>Your visit has ended</h2><p class="supporting">Your sample summary is ready in the conversation.</p></div></div><div class="actions">${action("View summary", "show-summary")}</div>`;
		case "cancelled": return `${heading}<p class="supporting">This demo visit was canceled.</p>`;
	}
}
function afterVisitCard(card: AfterVisitCard): string {
	if (card.afterVisit.kind === "not-ready") return `<p class="eyebrow">Sample after-visit summary</p><h1>Your summary will appear here</h1><p class="supporting">End the demo visit when you are ready to see its sample record.</p><div class="actions">${action("Return to visit", "open-visit")}</div>`;
	const { summary, appointment, endedAt } = card.afterVisit;
	return `<div class="card-caption"><p class="eyebrow">Sample after-visit summary</p><span class="status-pill">Visit complete</span></div><h1>Your next steps</h1><p class="summary-date">${e(dateText(endedAt, appointment.timeZone))} · ${e(appointment.careTeam)}</p><p class="summary-lead">${e(summary.summary)}</p><ol class="next-steps">${summary.nextSteps.map((step, index) => `<li><span class="step-mark" aria-hidden="true">${index + 1}</span><p>${e(step)}</p></li>`).join("")}</ol><p class="provenance">Sample summary. Not reviewed by a clinician.</p><div class="actions">${card.hasMaternalPlan ? action("View my follow-up plan", "show-plan") : action("Discuss next steps", "discuss-summary")}${action("Save summary", "save-summary", true)}</div>`;
}
function urgentConcerns(): string {
	return `<div class="plan-support"><p class="supporting">This demo is not monitored.</p><details id="urgent-concerns"><summary>Urgent concerns</summary><div class="disclosure-content"><p>Pregnancy-related warning signs can occur during pregnancy and for a year afterward. If you have a warning sign, get medical care immediately. Call 911 for an emergency. Tell the care team about your current or recent pregnancy. Do not wait for this chat or a scheduled appointment.</p><a href="${urgentSignsUrl}" data-official-link target="_blank" rel="noopener noreferrer">CDC: urgent maternal warning signs</a><p class="supporting">For support with how you are feeling, the National Maternal Mental Health Hotline is available at 1-833-852-6262. This support line is separate from emergency care.</p><a href="${maternalSupportUrl}" data-official-link target="_blank" rel="noopener noreferrer">National Maternal Mental Health Hotline</a></div></details></div>`;
}
function maternalPlanCard(card: MaternalPlanCard, draft: CardDraft): string {
	if (card.plan.kind === "none") return `<p class="eyebrow">Sample follow-up plan</p><h1>Your next care steps</h1><p class="supporting">No maternal care plan is attached to this visit.</p>${urgentConcerns()}`;
	const plan = card.plan;
	const nextOpenMilestone = card.canEdit ? plan.timeline.findIndex((milestone) => milestone.progress.kind === "open") : -1;
	return `<p class="eyebrow">Sample postpartum plan</p><h1>${e(plan.title)}</h1>
		<ol class="care-timeline">${plan.timeline.map((milestone, index) => `<li class="${index === nextOpenMilestone ? "next-milestone" : ""}"><div class="timeline-marker" aria-hidden="true">${milestone.progress.kind === "complete" ? "✓" : milestone.progress.kind === "cancelled" ? "×" : index === nextOpenMilestone ? "•" : ""}</div><div class="milestone-content"><p class="milestone-time">${milestone.timing.kind === "scheduled" ? e(`${dateText(milestone.timing.startsAt, milestone.timing.timeZone)} · ${timeText(milestone.timing.startsAt, milestone.timing.timeZone)}`) : "Needs arranging"}</p><h2>${e(milestone.title)}</h2>${milestone.progress.kind === "complete" ? '<span class="milestone-status">Complete</span>' : milestone.progress.kind === "cancelled" ? '<span class="milestone-status">Canceled</span>' : ""}</div></li>`).join("")}</ol>
		${plan.tasks.length ? `<section class="preparation" aria-labelledby="preparation-title"><h2 id="preparation-title">Before your next visit</h2><div class="task-list">${plan.tasks.map((task) => `<label class="plan-task${task.status.kind === "complete" ? " task-complete" : ""}"><input type="checkbox" data-task="${e(task.id)}"${task.status.kind === "complete" ? " checked" : ""}${card.canEdit ? "" : " disabled"}><span>${e(task.label)}</span><span class="task-status" aria-hidden="true">${task.status.kind === "complete" ? "Done" : ""}</span></label>`).join("")}</div></section>` : ""}
		<section class="questions" aria-labelledby="questions-title"><div class="section-heading"><h2 id="questions-title">My questions <span class="count">${plan.questions.length}</span></h2>${card.canEdit && !draft.questionOpen ? '<button class="text-button" data-action="add-question">Add a question</button>' : ""}</div>${plan.questions.length ? `<ul class="question-list">${plan.questions.slice(-1).map(questionItem).join("")}</ul>${plan.questions.length > 1 ? `<details id="earlier-questions" class="earlier-questions"><summary>${plan.questions.length - 1} earlier ${plan.questions.length === 2 ? "question" : "questions"}</summary><ul class="question-list">${plan.questions.slice(0, -1).map(questionItem).join("")}</ul></details>` : ""}` : '<p class="supporting">Save something you want to ask at your next visit.</p>'}${draft.questionOpen && card.canEdit ? `<form id="question-form"><label for="question">Question for your next visit</label><textarea id="question" name="question" maxlength="500" rows="2" required placeholder="What would you like to ask?">${e(draft.question)}</textarea><div class="actions">${action("Save question", "save-question")}${action("Cancel", "cancel-question", true)}</div></form>` : ""}<p class="supporting question-note">Saved for you. Questions are not sent to a clinician.</p></section>
		<div class="actions">${action("Prepare in chat", "prepare-plan")}</div>${urgentConcerns()}<p class="retention">This sample plan is saved until ${e(dateText(card.expiresAt, "America/New_York"))}, ${e(timeText(card.expiresAt, "America/New_York"))}.</p>`;
}
function questionItem(question: PlanQuestion): string {
	return `<li>${e(question.text)}${question.source === "scripted-demo" ? '<span class="question-source">Sample question</span>' : ""}</li>`;
}

export function renderCard(card: CardResult, draft: CardDraft): string {
	switch (card.cardKind) {
		case "appointment": return appointmentCard(card);
		case "consultation": return consultationCard(card);
		case "after-visit": return afterVisitCard(card);
		case "maternal-plan": return maternalPlanCard(card, draft);
	}
}

export function summaryText(card: AfterVisitCard): string | undefined {
	if (card.afterVisit.kind !== "available") return;
	const { summary, appointment, endedAt } = card.afterVisit;
	return `Sample after-visit summary\n${dateText(endedAt, appointment.timeZone)}\n\n${summary.summary}\n\nNext steps\n${summary.nextSteps.map((step) => `- ${step}`).join("\n")}\n\nSample summary. Not reviewed by a clinician.\n`;
}
