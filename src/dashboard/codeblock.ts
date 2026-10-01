import { abortable, checkAbort, isAbort } from "../async";
import { MarkdownRenderChild, Notice } from "obsidian";
import { daysInYear, monthOf, todayInZone, yearOf } from "../date";
import { defaultWidgetRegistry } from "./registry";
import { DashboardHost, WidgetContext } from "./types";
import { parseCodeblockConfig } from "./codeblock-parser";
import { calendarModeFor } from "./format";
import { StagedDashboard, WidgetEntry } from "./staged-renderer";
import { VisibilityGate } from "./visibility";
export { parseCodeblockConfig, parseYamlSafe } from "./codeblock-parser";
export type { CodeblockConfig } from "./codeblock-parser";

export class TemperansCodeblockChild extends MarkdownRenderChild {
  private disposed = false;
  private controller?: AbortController;
  private visibility?: VisibilityGate;
  constructor(private readonly app: any, private readonly host: DashboardHost, private readonly source: string,
    containerEl: HTMLElement, private readonly onUnloadCallback?: (child: TemperansCodeblockChild) => void) { super(containerEl); }
  async onload(): Promise<void> {
    this.visibility = new VisibilityGate(this.containerEl, visible => {
      if (visible) void this.render(); else this.controller?.abort();
    });
    await this.visibility.start();
    if (!this.disposed) await this.render();
  }
  async render(): Promise<void> {
    if (this.disposed || this.visibility && !this.visibility.visible) return;
    this.controller?.abort(); this.controller = new AbortController();
    try { await renderTemperansCodeblock(this.app, this.host, this.source, this.containerEl, this.controller.signal, () => this.render()); }
    catch (error) { if (!isAbort(error)) new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."); }
  }
  cancelRender(): void { this.controller?.abort(); }
  onunload(): void {
    this.disposed = true; this.controller?.abort(); this.visibility?.stop();
    this.onUnloadCallback?.(this); this.containerEl.empty();
  }
}
const renders = new WeakMap<HTMLElement, AbortController>();
export async function renderTemperansCodeblock(app: any, host: DashboardHost, source: string, el: HTMLElement,
  parentSignal?: AbortSignal, refresh?: () => Promise<void>): Promise<void> {
  renders.get(el)?.abort();
  const controller = new AbortController(); renders.set(el, controller);
  parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  if (parentSignal?.aborted) controller.abort();
  const signal = controller.signal;
  checkAbort(signal);
  el.empty(); el.addClass("temperans-dashboard", "temperans-embedded-dashboard");
  el.style.setProperty("--temperans-accent", host.state.heatmapColor);
  const { habitFilter, year, widgets } = parseCodeblockConfig(source);
  const settings = await abortable(host.store.loadSettings(), signal);
  checkAbort(signal);
  const today = todayInZone(settings.timezone), dates = daysInYear(year);
  const validHabit = habitFilter !== "overall" && !settings.habits.some(h => h.id === habitFilter && h.enabled) ? "overall" : habitFilter;
  const eligible = dates.filter(date => date <= today);
  const selectedDate = yearOf(today) === year ? today : eligible.at(-1) ?? null;
  const isCompact = el.clientWidth > 0 && el.clientWidth <= 720;
  const calendar = widgets.find(item => item.widget === "calendar" || item.widget === "heatmap");
  let staged: StagedDashboard;
  const ctx: WidgetContext = {
    app, host, container: el, year, month: selectedDate ? monthOf(selectedDate) : 1, selectedDate, habitFilter: validHabit,
    settings, logs: new Map(), evaluations: new Map(), analytics: new Map(), dates, today, isCompact,
    calendarMode: calendarModeFor(isCompact, calendar?.config?.mode), dayButtons: new Map(),
    onSelectDay: date => {
      const previous = ctx.selectedDate ? ctx.dayButtons.get(ctx.selectedDate) : undefined;
      previous?.removeClass("is-selected"); previous?.setAttr("aria-pressed", "false"); if (previous) previous.tabIndex = -1;
      const next = ctx.dayButtons.get(date); next?.addClass("is-selected"); next?.setAttr("aria-pressed", "true"); if (next) next.tabIndex = 0;
      void staged.selectDay(date).catch(error => { if (!isAbort(error)) new Notice(error instanceof Error ? error.message : "Could not load the selected day."); });
    },
    onSelectHabit: () => {}, onNavigatePeriod: () => {}, onGoToToday: () => { if (yearOf(today) === year) ctx.onSelectDay(today); },
    onRefresh: refresh ?? (() => renderTemperansCodeblock(app, host, source, el))
  };
  const entries: WidgetEntry[] = [];
  for (const item of widgets) {
    const widget = defaultWidgetRegistry.get(item.widget);
    if (widget) entries.push({ widget, config: item.config, container: el.createDiv({ cls: "temperans-widget temperans-widget-" + widget.id }) });
  }
  staged = new StagedDashboard(entries, ctx, signal);
  await staged.run();
}
