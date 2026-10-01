import { refreshInBackground } from "../background-refresh";
import { setIcon } from "obsidian";
import { formatDate } from "../../date";
import { evaluatePeriodGoal, typingDurationSeconds, typingTestCount } from "../../evaluation";
import { formatTypingDuration } from "../../durations";
import { HabitLogModal } from "../../modals";
import { renderSourceIcon } from "../../source-icon";
import { formatValue, targetLabel } from "../format";
import { DashboardWidget, WidgetContext } from "../types";
import { DailyLog, HabitId } from "../../types";

function noteForHabit(log: DailyLog, habitId: HabitId): string | undefined {
  return habitId === "typing" ? log.typing.note : log.metricNotes[habitId];
}

function typingSummary(log: DailyLog): string {
  const totalSeconds = Math.round(typingDurationSeconds(log));
  const duration = formatTypingDuration(totalSeconds);
  const tests = typingTestCount(log);
  const testPrefix = tests > 0 ? `${formatValue(tests, "tests")} · ` : "";
  return `${testPrefix}${duration}`;
}

export class DayDetailWidget implements DashboardWidget {
  id = "day-detail";
  name = "Day Detail Inspector";
  description = "Detailed list of targets, logged progress, source icons, and session notes for the selected date.";

  render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    container.empty();
    container.addClass("temperans-day-detail-panel");

    const detailHeader = container.createDiv({ cls: "temperans-detail-heading" });
    const detailScroll = container.createDiv({ cls: "temperans-day-detail-scroll" });

    this.renderSelectedDay(detailHeader, detailScroll, ctx, config);
  }

  update(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    const detailHeader = container.querySelector<HTMLElement>(".temperans-detail-heading");
    const detailScroll = container.querySelector<HTMLElement>(".temperans-day-detail-scroll");
    if (detailHeader && detailScroll) {
      this.renderSelectedDay(detailHeader, detailScroll, ctx, config);
    } else {
      this.render(container, ctx, config);
    }
  }

  private renderSelectedDay(header: HTMLElement, scroll: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    header.empty();
    scroll.empty();
    scroll.scrollTop = 0;

    const date = ctx.selectedDate;
    const evaluation = date ? ctx.evaluations.get(date) : undefined;
    if (!date || !evaluation) {
      header.createEl("h3", { text: "No days yet" });
      scroll.createEl("p", {
        cls: "temperans-empty-detail",
        text: ctx.isCompact
          ? "No habit days are available in this month yet. Log today or choose another month."
          : "No habit days are available in this period yet. Log today or choose another year."
      });
      return;
    }

    const log = ctx.logs.get(date) ?? {
      date,
      metrics: {},
      metricSources: {},
      metricNotes: {},
      sessions: {},
      typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
      reading: []
    };

    const targetHabitId = ctx.habitFilter !== "overall" ? ctx.habitFilter : undefined;

    header.createEl("h3", { text: formatDate(evaluation.date) });
    const editButton = header.createEl("button", {
      cls: "temperans-edit-day",
      attr: { "aria-label": `Edit ${formatDate(evaluation.date)}` }
    });
    setIcon(editButton, "square-pen");
    editButton.onclick = () => new HabitLogModal(
      ctx.app,
      ctx.host.store,
      evaluation.date,
      ctx.settings.habits.filter((h) => h.enabled),
      targetHabitId,
      async () => refreshInBackground(ctx),
      async (habitId) => {
        await ctx.host.syncEndpointHabit(habitId);
        await ctx.onRefresh();
      }
    ).open();

    const detail = scroll.createDiv({ cls: "temperans-day-detail" });
    const daily = evaluation.habits.filter((item) =>
      item.habit.enabled &&
      item.habit.cadence === "daily" &&
      (!targetHabitId || item.habit.id === targetHabitId)
    );
    const periodic = ctx.settings.habits.filter((h) =>
      h.enabled &&
      h.cadence !== "daily" &&
      (!targetHabitId || h.id === targetHabitId)
    );

    if (!daily.length && !periodic.length) {
      detail.createEl("p", { cls: "temperans-empty-detail", text: "No enabled tasks. Add one from Temperans actions." });
      return;
    }

    const showSessions = config?.showSessions !== false;
    const showNotes = config?.showNotes !== false;

    const list = detail.createDiv({ cls: "temperans-detail-list" });
    for (const item of daily) {
      const row = list.createDiv({ cls: `temperans-detail-row is-${item.status}` });
      row.createSpan({ text: item.habit.name, cls: "temperans-detail-name" });
      const valueSpan = row.createSpan({ cls: "temperans-detail-value" });
      const actual = item.habit.id === "typing" ? typingSummary(log) : formatValue(item.value, item.habit.unit, item.habit);
      valueSpan.createSpan({ text: `${actual} / ${targetLabel(item.target, item.habit)}` });
      const source = log.metricSources[item.habit.id];
      if (source && source !== "manual") {
        renderSourceIcon(valueSpan, source, setIcon);
      }
      row.createSpan({ text: item.status, cls: "temperans-status" });
      const note = noteForHabit(log, item.habit.id);
      if (showNotes && note) list.createDiv({ cls: "temperans-detail-note", text: note });
    }

    if (periodic.length && ctx.periodsPending) {
      detail.createDiv({ cls: "temperans-loading-status", text: ctx.periodsError ? "Could not load period totals." : "Loading period totals…", attr: { role: "status" } });
      if (ctx.periodsError) detail.createEl("button", { text: "Retry", attr: { type: "button" } }).onclick = () => refreshInBackground(ctx);
    }
    if (periodic.length && !ctx.periodsPending) {
      const goals = detail.createDiv({ cls: "temperans-detail-period-goals" });
      goals.createEl("strong", { text: "Period goals" });
      for (const habit of periodic) {
        const period = evaluatePeriodGoal(habit, evaluation.date, ctx.logs);
        const row = goals.createDiv({ cls: `temperans-detail-row is-${period.status}` });
        row.createSpan({ text: `${habit.name} (${habit.cadence})`, cls: "temperans-detail-name" });
        const valueSpan = row.createSpan({ cls: "temperans-detail-value" });
        valueSpan.createSpan({ text: `${formatValue(period.value, habit.unit, habit)} / ${targetLabel(period.target, habit)}` });
        const source = log.metricSources[habit.id];
        if (source && source !== "manual") {
          renderSourceIcon(valueSpan, source, setIcon);
        }
        row.createSpan({ text: period.status, cls: "temperans-status" });
        const note = noteForHabit(log, habit.id);
        if (showNotes && note) goals.createDiv({ cls: "temperans-detail-note", text: note });
      }
    }

    if (!showSessions) return;

    const allSessions = { ...log.sessions };
    if (log.reading?.length && !allSessions.reading) allSessions.reading = log.reading;

    for (const [habitId, sessions] of Object.entries(allSessions)) {
      if (!sessions || !sessions.length) continue;
      if (targetHabitId && habitId !== targetHabitId) continue;
      const habitDef = ctx.settings.habits.find((h) => h.id === habitId);
      const habitName = habitDef?.name || (habitId === "reading" ? "Reading" : habitId);
      const sessionBlock = detail.createDiv({ cls: "temperans-reading" });
      sessionBlock.createEl("strong", { text: `${habitName} sessions` });
      for (const session of sessions) {
        const parts = [
          session.pages ? `${session.pages} pages` : "",
          session.chapters ? `${session.chapters} chapters` : "",
          session.minutes ? `${session.minutes} min` : "",
          session.reps ? `${session.reps} reps` : "",
          session.count ? `${session.count}` : ""
        ].filter(Boolean);
        const details = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
        sessionBlock.createDiv({ text: `${session.title}${details}${session.note ? ` · ${session.note}` : ""}` });
      }
    }
  }
}
