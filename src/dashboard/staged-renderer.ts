import { Notice } from "obsidian";
import { abortable, checkAbort, isAbort, yieldToHost } from "../async";
import { calculateHabitAnalytics, HabitAnalytics } from "../analytics";
import { datesFromPeriodStart } from "../evaluation";
import { daysInMonth } from "../date";
import { emptyDailyLog } from "../log-schema";
import { DashboardWidget, WidgetContext } from "./types";

export interface WidgetEntry {
  widget: DashboardWidget;
  container: HTMLElement;
  config?: Record<string, unknown>;
  ready?: boolean;
}
const analyticsCache = new WeakMap<object, { revision: number; entries: Map<string, Promise<Map<string, HabitAnalytics>>> }>();

/** Expand dependencies before rendering: pending dates are never interpreted as zero. */
export function widgetDates(id: string, ctx: WidgetContext, config?: Record<string, unknown>): string[] {
  const selected = ctx.settings.habits.find(h => h.id === ctx.habitFilter);
  const periodic = ctx.settings.habits.filter(h => h.enabled && h.cadence !== "daily");
  if (id === "header") return [];
  if (id === "day-detail") return ctx.selectedDate ? [ctx.selectedDate] : [];
  if (id === "day-periods") return ctx.selectedDate ? periodic.filter(h => ctx.habitFilter === "overall" || h.id === ctx.habitFilter)
    .flatMap(h => datesFromPeriodStart(ctx.selectedDate!, h.cadence)) : [];
  if (id === "period-goals") {
    const cadences = Array.isArray(config?.cadences) ? new Set(config.cadences.map(c => String(c).toLowerCase().trim())) : null;
    return periodic.filter(h => !cadences || cadences.has(h.cadence)).flatMap(h => datesFromPeriodStart(ctx.today, h.cadence));
  }
  const mode = config?.mode === "month" || config?.mode === "year" ? config.mode : ctx.calendarMode ?? (ctx.isCompact ? "month" : "year");
  const dates = (id === "calendar" && mode === "month" ? daysInMonth(ctx.year, ctx.month) : ctx.dates).filter(date => date <= ctx.today);
  // A week beginning in December contributes to January's period totals.
  const dependencies = id === "calendar" || id === "stats" ? selected ? [selected] : [] : periodic;
  return [...new Set([...dates, ...dependencies.filter(h => h.cadence !== "daily").flatMap(h => dates.length ? datesFromPeriodStart(dates[0], h.cadence) : [])])];
}

async function analyticsFor(ctx: WidgetContext, signal: AbortSignal, revision: number): Promise<Map<string, HabitAnalytics>> {
  const habits = ctx.settings.habits.filter(h => h.enabled && (ctx.habitFilter === "overall" || h.id === ctx.habitFilter));
  const reusable = revision !== undefined && revision === ctx.host.store.dataRevision;
  let cached = analyticsCache.get(ctx.host.store);
  if (!cached || cached.revision !== revision) {
    cached = { revision, entries: new Map() };
    if (reusable) analyticsCache.set(ctx.host.store, cached);
  }
  const key = JSON.stringify([ctx.year, ctx.today, ctx.habitFilter, ctx.settings]);
  // Test adapters without a revision have no invalidation contract.
  if (reusable && cached.entries.has(key)) return abortable(cached.entries.get(key)!, signal);
  const work = Promise.resolve().then(() => {
    const result = new Map<string, HabitAnalytics>();
    for (const habit of habits) result.set(habit.id, calculateHabitAnalytics(habit, ctx.dates, ctx.logs, ctx.today));
    return result;
  });
  if (reusable) {
    cached.entries.set(key, work);
    while (cached.entries.size > 8) cached.entries.delete(cached.entries.keys().next().value!);
    void work.catch(() => { if (cached.entries.get(key) === work) cached.entries.delete(key); });
  }
  return abortable(work, signal);
}

/** A render owns only its requests; cancelling it cannot cancel another view's shared read. */
export class StagedDashboard {
  private loaded = new Set<string>();
  private revision: number;
  private dayRequest = new AbortController();
  private store: WidgetContext["host"]["store"];
  constructor(readonly entries: WidgetEntry[], readonly ctx: WidgetContext, private signal: AbortSignal) {
    this.store = ctx.host.store;
    this.revision = this.store.dataRevision;
    signal.addEventListener("abort", () => this.dayRequest.abort(), { once: true });
  }
  private async ensure(dates: string[], signal = this.signal): Promise<void> {
    checkAbort(signal); checkAbort(this.signal);
    if (this.store !== this.ctx.host.store) throw new DOMException("Loading cancelled", "AbortError");
    const missing = [...new Set(dates)].filter(date => !this.loaded.has(date));
    if (!missing.length) return;
    const logs = await this.store.logsForDates(missing, signal);
    checkAbort(signal); checkAbort(this.signal);
    for (const date of missing) {
      const log = logs.get(date);
      if (log) this.ctx.logs.set(date, log);
      if (date <= this.ctx.today && date.startsWith(this.ctx.year + "-")) this.ctx.evaluations.set(date,
        this.ctx.host.store.evaluate(log ?? emptyDailyLog(date), date, this.ctx.settings));
      this.loaded.add(date);
    }
  }
  private async paint(entry: WidgetEntry): Promise<void> {
    checkAbort(this.signal);
    entry.container.removeClass("is-loading"); entry.container.setAttribute("aria-busy", "false");
    if (entry.ready && entry.widget.update) await entry.widget.update(entry.container, this.ctx, entry.config);
    else await entry.widget.render(entry.container, this.ctx, entry.config);
    checkAbort(this.signal); entry.ready = true;
  }
  private placeholder(entry: WidgetEntry): void {
    entry.container.empty(); entry.container.addClass("is-loading");
    entry.container.setAttribute("aria-busy", "true");
    const label = entry.widget.id === "stats" ? "Loading statistics…" : entry.widget.id === "calendar" ? "Loading calendar…" : entry.widget.id === "day-detail" ? "Loading selected day…" : "Loading goals…";
    entry.container.createDiv({ cls: "temperans-loading-status", text: label, attr: { role: "status" } });
  }
  private async day(includePeriods: boolean): Promise<void> {
    const entries = this.entries.filter(e => e.widget.id === "day-detail");
    if (!entries.length) return;
    const signal = this.dayRequest.signal, date = this.ctx.selectedDate;
    try {
      await this.ensure(widgetDates("day-detail", this.ctx), signal);
      const periods = widgetDates("day-periods", this.ctx);
      if (includePeriods) await this.ensure(periods, signal);
      checkAbort(signal);
      if (date !== this.ctx.selectedDate) return;
      this.ctx.periodsError = false;
      this.ctx.periodsPending = periods.some(day => !this.loaded.has(day));
      for (const entry of entries) await this.paint(entry);
    } catch (error) {
      if (!isAbort(error)) {
        this.ctx.periodsError = true;
        for (const entry of entries.filter(entry => entry.ready)) await this.paint(entry);
        throw error;
      }
    }
  }
  async selectDay(date: string): Promise<void> {
    this.dayRequest.abort(); this.dayRequest = new AbortController();
    this.ctx.selectedDate = date; this.ctx.month = Number(date.slice(5, 7));
    for (const entry of this.entries.filter(e => e.widget.id === "day-detail")) {
      if (!this.loaded.has(date)) { entry.ready = false; this.placeholder(entry); }
    }
    await this.day(false); await this.day(true);
  }
  async run(): Promise<void> {
    try {
      for (const entry of this.entries) {
        if (entry.widget.id === "header") await this.paint(entry);
        else { entry.ready = false; this.placeholder(entry); }
      }
      // Give the host a chance to paint controls before discovery or parsing starts.
      await yieldToHost(); checkAbort(this.signal);
      await this.day(false);
      for (const entry of this.entries.filter(e => e.widget.id === "calendar")) {
        await this.ensure(widgetDates("calendar", this.ctx, entry.config)); await this.paint(entry);
      }
      await this.day(true);
      for (const entry of this.entries.filter(e => !["header", "day-detail", "calendar"].includes(e.widget.id))) {
        await this.ensure(widgetDates(entry.widget.id, this.ctx, entry.config));
        if (entry.widget.id === "stats" && this.ctx.habitFilter !== "overall") this.ctx.analytics = await analyticsFor(this.ctx, this.signal, this.revision);
        await this.paint(entry);
      }
      checkAbort(this.signal);
    } catch (error) {
      if (isAbort(error) || this.signal.aborted) throw error;
      for (const entry of this.entries.filter(e => !e.ready)) {
        entry.container.empty(); entry.container.removeClass("is-loading"); entry.container.setAttribute("aria-busy", "false");
        entry.container.createDiv({ cls: "temperans-loading-status", text: "Could not load habit data." });
        const retry = entry.container.createEl("button", { text: "Retry", attr: { type: "button" } });
        retry.onclick = () => void this.ctx.onRefresh().catch(error => new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."));
      }
      throw error;
    }
  }
}
