import { setIcon } from "obsidian";
import { daysInMonth, formatDate, monthLongName, monthShortName, weekdayIndexMonday } from "../../date";
import { calculateGoalProgress, evaluatePeriodGoal } from "../../evaluation";
import { cadenceLabel, formatValue, targetLabel } from "../format";
import { DashboardWidget, WidgetContext } from "../types";
import { HabitDefinition, HabitEvaluation, PeriodEvaluation } from "../../types";

function intensity(score: number | null): number {
  if (score === null || score <= 0) return 0;
  if (score < 0.35) return 1;
  if (score < 0.70) return 2;
  if (score < 0.999) return 3;
  return 4;
}

function scoreForHabit(item: HabitEvaluation): number {
  return calculateGoalProgress(item.value, item.target, item.habit).progress;
}

function buildCellTooltip(
  date: string,
  isFuture: boolean,
  selectedHabit: HabitDefinition | undefined,
  habitEvaluation: HabitEvaluation | undefined,
  periodEvaluation: PeriodEvaluation | undefined,
  overallScore: number | null
): string {
  if (isFuture) {
    return `${formatDate(date)} — future date`;
  }
  if (periodEvaluation && selectedHabit) {
    const goal = calculateGoalProgress(periodEvaluation.value, periodEvaluation.target, selectedHabit);
    const percentText = Math.round(goal.progress * 100) + "%";
    const statusDetail = goal.isOverCeiling
      ? ` (${percentText} — exceeded ceiling by ${formatValue(goal.excess, selectedHabit.unit, selectedHabit)})`
      : ` (${percentText} complete)`;
    return `${formatDate(date)} — ${formatValue(periodEvaluation.value, selectedHabit.unit, selectedHabit)} / ${targetLabel(periodEvaluation.target, selectedHabit)}${statusDetail} (${periodEvaluation.startDate}–${periodEvaluation.endDate})`;
  }
  if (selectedHabit && habitEvaluation) {
    if (selectedHabit.type === "tracker") {
      return habitEvaluation.value > 0
        ? `${formatDate(date)} — Tracked: ${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)}`
        : `${formatDate(date)} — Not logged`;
    }
    if (selectedHabit.type === "avoidance") {
      const maxLimit = habitEvaluation.target?.max ?? 0;
      if (habitEvaluation.value <= maxLimit) {
        const valDetail = habitEvaluation.value > 0
          ? `${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)} / max ${formatValue(maxLimit, selectedHabit.unit, selectedHabit)}`
          : `0 ${selectedHabit.unit}`;
        return `${formatDate(date)} — Clean day (${valDetail}) — 100% complete`;
      }
      const excess = habitEvaluation.value - maxLimit;
      return `${formatDate(date)} — Slipped: ${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)} (exceeded limit by ${formatValue(excess, selectedHabit.unit, selectedHabit)})`;
    }
    if (!habitEvaluation.target || (habitEvaluation.target.min === undefined && habitEvaluation.target.max === undefined)) {
      return `${formatDate(date)} — ${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)} (no target)`;
    }
    const goal = calculateGoalProgress(habitEvaluation.value, habitEvaluation.target, selectedHabit);
    const percentText = Math.round(goal.progress * 100) + "%";
    if (goal.isOverCeiling) {
      return `${formatDate(date)} — ${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)} / ${targetLabel(habitEvaluation.target, selectedHabit)} (${percentText} — exceeded ceiling by ${formatValue(goal.excess, selectedHabit.unit, selectedHabit)})`;
    }
    return `${formatDate(date)} — ${formatValue(habitEvaluation.value, selectedHabit.unit, selectedHabit)} / ${targetLabel(habitEvaluation.target, selectedHabit)} (${percentText} complete)`;
  }
  return `${formatDate(date)} — ${overallScore === null ? "No active targets" : `${Math.round(overallScore * 100)}% complete`}`;
}

export class CalendarWidget implements DashboardWidget {
  id = "calendar";
  name = "Heat Map & Calendar Grid";
  description = "53-week annual heat map or monthly grid with keyboard navigation.";

  render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    container.empty();
    container.addClass("temperans-calendar-section");

    const selectedHabit = ctx.habitFilter === "overall" ? undefined : ctx.settings.habits.find((h) => h.id === ctx.habitFilter);

    const titleEl = container.createEl("h3", { cls: "temperans-calendar-title" });
    titleEl.createSpan({
      text: !selectedHabit ? "Daily consistency" : `${selectedHabit.name} — ${cadenceLabel(selectedHabit.cadence)} goal`
    });

    const infoText = !selectedHabit
      ? "Darker cells mean more daily targets were completed. Weekly and monthly goals are kept out of this score."
      : selectedHabit.cadence === "daily"
      ? "Darker cells mean this day’s target was met."
      : `Each cell shows cumulative ${selectedHabit.cadence} progress from the period’s start through that date.`;

    const infoIcon = titleEl.createSpan({
      cls: "temperans-info-icon",
      attr: {
        "aria-label": infoText,
        "data-tooltip-position": "top",
        tabindex: "0"
      }
    });
    setIcon(infoIcon, "info");

    ctx.dayButtons.clear();

    const mode = config?.mode === "year" ? "year" : config?.mode === "month" ? "month" : "auto";
    const isMonthView = mode === "month" || (mode === "auto" && ctx.isCompact);
    const showLegend = config?.showLegend !== false;

    if (isMonthView) {
      this.renderMonthGrid(container, ctx, selectedHabit, showLegend);
    } else {
      this.renderYearHeatmap(container, ctx, selectedHabit, showLegend);
    }
  }

  update(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    const selectedHabit = ctx.habitFilter === "overall" ? undefined : ctx.settings.habits.find((h) => h.id === ctx.habitFilter);
    const mode = config?.mode === "year" ? "year" : config?.mode === "month" ? "month" : "auto";
    const isMonthView = mode === "month" || (mode === "auto" && ctx.isCompact);

    if (isMonthView) {
      const summary = container.querySelector<HTMLElement>(".temperans-month-summary");
      if (summary) {
        summary.textContent = this.getMonthSummaryText(ctx, selectedHabit);
      }
    }

    const cellDates = isMonthView ? daysInMonth(ctx.year, ctx.month) : ctx.dates;
    for (const date of cellDates) {
      const cell = ctx.dayButtons.get(date);
      if (!cell) continue;
      const isFuture = date > ctx.today;
      const evaluation = ctx.evaluations.get(date);
      const habitEvaluation = selectedHabit ? evaluation?.habits.find((item) => item.habit.id === selectedHabit.id) : undefined;
      const periodEvaluation = !isFuture && selectedHabit && selectedHabit.cadence !== "daily" ? evaluatePeriodGoal(selectedHabit, date, ctx.logs) : undefined;
      const score = isFuture ? null : periodEvaluation ? periodEvaluation.progress : habitEvaluation ? scoreForHabit(habitEvaluation) : evaluation?.score ?? null;
      const tooltip = buildCellTooltip(date, isFuture, selectedHabit, habitEvaluation, periodEvaluation, evaluation?.score ?? null);
      const selected = date === ctx.selectedDate;
      const isToday = date === ctx.today;

      cell.className = `temperans-day intensity-${intensity(score)}${isFuture ? " is-future" : ""}${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`;
      cell.setAttribute("aria-label", tooltip);
      cell.setAttribute("aria-pressed", selected ? "true" : "false");
      if (isToday) cell.setAttribute("aria-current", "date");
      else cell.removeAttribute("aria-current");
      cell.disabled = isFuture;
      cell.tabIndex = selected && !isFuture ? 0 : -1;
    }
  }

  private renderYearHeatmap(section: HTMLElement, ctx: WidgetContext, selectedHabit: HabitDefinition | undefined, showLegend = true): void {
    const layout = section.createDiv({ cls: "temperans-heatmap-layout" });
    const weekdays = layout.createDiv({ cls: "temperans-weekdays" });
    ["Mon", "", "Wed", "", "Fri", "", ""].forEach((day) => weekdays.createSpan({ text: day }));

    const main = layout.createDiv({ cls: "temperans-heatmap-main" });
    const labels = main.createDiv({ cls: "temperans-month-labels" });
    const grid = main.createDiv({ cls: "temperans-heatmap" });
    const firstOffset = ctx.dates.length ? weekdayIndexMonday(ctx.dates[0]) : 0;
    let previousColumn = 0;

    for (let month = 1; month <= 12; month += 1) {
      const first = `${ctx.year}-${String(month).padStart(2, "0")}-01`;
      const index = ctx.dates.indexOf(first);
      if (index < 0) continue;
      const column = Math.floor((index + firstOffset) / 7) + 1;
      if (column <= previousColumn) continue;
      previousColumn = column;
      const label = labels.createSpan({ text: monthShortName(month) });
      label.style.gridColumnStart = String(column);
    }

    ctx.dates.forEach((date, index) => {
      const cell = this.createDayCell(grid, date, ctx, selectedHabit);
      const ordinal = index + firstOffset;
      cell.style.gridColumnStart = String(Math.floor(ordinal / 7) + 1);
      cell.style.gridRowStart = String((ordinal % 7) + 1);
    });

    this.bindDayKeyboard(grid, ctx.dates.filter((date) => date <= ctx.today), { leftRight: 7, upDown: 1 }, ctx);

    if (showLegend) {
      const legend = section.createDiv({ cls: "temperans-legend" });
      legend.createSpan({ text: "Less" });
      for (let value = 0; value <= 4; value += 1) legend.createSpan({ cls: `temperans-legend-cell intensity-${value}` });
      legend.createSpan({ text: "More" });
    }
  }

  private getMonthSummaryText(ctx: WidgetContext, selectedHabit: HabitDefinition | undefined): string {
    const monthDates = daysInMonth(ctx.year, ctx.month);
    const monthName = monthLongName(ctx.month);
    const monthScores = monthDates
      .map((date) => {
        const evaluation = ctx.evaluations.get(date);
        if (!evaluation) return undefined;
        if (selectedHabit) {
          if (selectedHabit.cadence !== "daily") {
            return date <= ctx.today ? evaluatePeriodGoal(selectedHabit, date, ctx.logs).progress : undefined;
          }
          const item = evaluation.habits.find((h) => h.habit.id === selectedHabit.id);
          return item ? scoreForHabit(item) : undefined;
        }
        return evaluation.score;
      })
      .filter((score): score is number => score !== null && score !== undefined);

    if (!monthScores.length) {
      return `${monthName} has no logged days yet.`;
    }

    const monthAverage = monthScores.reduce((sum, score) => sum + score, 0) / monthScores.length;
    const consistencyLabel = selectedHabit ? "consistency" : "daily consistency";
    return `${monthName}: ${Math.round(monthAverage * 100)}% ${consistencyLabel} across ${monthScores.length} day${monthScores.length === 1 ? "" : "s"}.`;
  }

  private renderMonthGrid(section: HTMLElement, ctx: WidgetContext, selectedHabit: HabitDefinition | undefined, showLegend = true): void {
    const monthDates = daysInMonth(ctx.year, ctx.month);
    section.createEl("p", {
      cls: "temperans-month-summary",
      text: this.getMonthSummaryText(ctx, selectedHabit)
    });

    const grid = section.createDiv({ cls: "temperans-month-grid" });
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day) => grid.createSpan({ text: day, cls: "temperans-month-weekday" }));
    const offset = monthDates.length ? weekdayIndexMonday(monthDates[0]) : 0;
    for (let i = 0; i < offset; i += 1) grid.createDiv({ cls: "temperans-month-pad" });
    for (const date of monthDates) this.createDayCell(grid, date, ctx, selectedHabit, true);

    this.bindDayKeyboard(grid, monthDates.filter((date) => date <= ctx.today), { leftRight: 1, upDown: 7 }, ctx);

    if (showLegend) {
      const legend = section.createDiv({ cls: "temperans-legend" });
      legend.createSpan({ text: "Less" });
      for (let value = 0; value <= 4; value += 1) legend.createSpan({ cls: `temperans-legend-cell intensity-${value}` });
      legend.createSpan({ text: "More" });
    }
  }

  private createDayCell(
    parent: HTMLElement,
    date: string,
    ctx: WidgetContext,
    selectedHabit: HabitDefinition | undefined,
    showDayNumber = false
  ): HTMLButtonElement {
    const isFuture = date > ctx.today;
    const evaluation = ctx.evaluations.get(date);
    const habitEvaluation = selectedHabit ? evaluation?.habits.find((item) => item.habit.id === selectedHabit.id) : undefined;
    const periodEvaluation = !isFuture && selectedHabit && selectedHabit.cadence !== "daily" ? evaluatePeriodGoal(selectedHabit, date, ctx.logs) : undefined;
    const score = isFuture ? null : periodEvaluation ? periodEvaluation.progress : habitEvaluation ? scoreForHabit(habitEvaluation) : evaluation?.score ?? null;
    const tooltip = buildCellTooltip(date, isFuture, selectedHabit, habitEvaluation, periodEvaluation, evaluation?.score ?? null);
    const selected = date === ctx.selectedDate;
    const isToday = date === ctx.today;

    const cell = parent.createEl("button", {
      cls: `temperans-day intensity-${intensity(score)}${isFuture ? " is-future" : ""}${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`,
      attr: {
        type: "button",
        "aria-label": tooltip,
        "data-date": date,
        "aria-pressed": selected ? "true" : "false",
        ...(isToday ? { "aria-current": "date" } : {})
      }
    });

    if (showDayNumber) cell.createSpan({ text: String(Number(date.slice(8))), cls: "temperans-day-number" });
    cell.disabled = isFuture;
    cell.tabIndex = selected && !isFuture ? 0 : -1;
    if (evaluation) cell.onclick = () => ctx.onSelectDay(date);
    ctx.dayButtons.set(date, cell);
    return cell;
  }

  private bindDayKeyboard(grid: HTMLElement, navigable: string[], steps: { leftRight: number; upDown: number }, ctx: WidgetContext): void {
    grid.addEventListener("keydown", (event: KeyboardEvent) => {
      const deltaByKey: Record<string, number> = {
        ArrowLeft: -steps.leftRight,
        ArrowRight: steps.leftRight,
        ArrowUp: -steps.upDown,
        ArrowDown: steps.upDown
      };
      const delta = deltaByKey[event.key];
      if (delta === undefined) return;
      const current = ctx.selectedDate && navigable.includes(ctx.selectedDate) ? ctx.selectedDate : navigable.at(-1);
      if (!current) return;
      const index = navigable.indexOf(current);
      const next = navigable[Math.max(0, Math.min(navigable.length - 1, index + delta))];
      if (!next || next === current) return;
      event.preventDefault();
      ctx.onSelectDay(next);
      ctx.dayButtons.get(next)?.focus();
    });
  }
}
