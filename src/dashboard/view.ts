import { abortable, checkAbort, isAbort } from "../async";
import { calendarModeFor } from "./format";
import { ItemView, Notice, Platform, WorkspaceLeaf } from "obsidian";
import { daysInYear, monthOf, todayInZone, yearOf } from "../date";
import { HabitId } from "../types";
import { DashboardHost, WidgetContext } from "./types";
import { defaultWidgetRegistry, DashboardWidgetRegistry } from "./registry";
import { ensureDashboardFile, loadDashboardLayout } from "./layout-loader";
import { StagedDashboard, WidgetEntry } from "./staged-renderer";
import { VisibilityGate } from "./visibility";

export const DASHBOARD_VIEW_TYPE = "temperans-habit-dashboard";
const COMPACT_PANE_MAX = 720;

export class HabitDashboardView extends ItemView {
  private year = new Date().getFullYear();
  private month = new Date().getUTCMonth() + 1;
  private habitFilter: "overall" | HabitId = "overall";
  private selectedDate: string | null = null;
  private isCompact = Platform.isMobile;
  private hasOpened = false;
  private closed = false;
  private visibility?: VisibilityGate;
  private request?: AbortController;
  private staged?: StagedDashboard;
  private paneObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private refreshRequested = 0;
  private refreshRendered = 0;
  private refreshWorker: Promise<void> | null = null;
  private registry: DashboardWidgetRegistry = defaultWidgetRegistry;
  private renderedWidgets: WidgetEntry[] = [];
  private dayButtons = new Map<string, HTMLButtonElement>();
  private renderedContext: WidgetContext | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: DashboardHost) { super(leaf); }
  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return this.host.state.dashboardTitle || "Temperans Habits"; }
  getIcon(): string { return "chart-no-axes-combined"; }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.attachPaneObserver(); this.syncCompactFromPane();
    this.visibility = new VisibilityGate(this.contentEl, visible => {
      if (visible) void this.refresh(); else this.request?.abort();
    });
    await this.visibility.start();
    if (this.closed) return;
    if (!this.app.workspace.layoutReady) {
      this.app.workspace.onLayoutReady(() => { if (!this.closed) void this.refresh(); });
    } else await this.refresh();
  }
  async refresh(): Promise<void> {
    if (this.closed) return;
    this.refreshRequested++;
    this.request?.abort();
    if (this.visibility && !this.visibility.visible) return;
    while (!this.closed && this.refreshRendered < this.refreshRequested && (!this.visibility || this.visibility.visible)) {
      if (!this.refreshWorker) this.refreshWorker = this.runRefreshWorker().finally(() => { this.refreshWorker = null; });
      await this.refreshWorker;
    }
  }
  private async runRefreshWorker(): Promise<void> {
    while (!this.closed && this.refreshRendered < this.refreshRequested && (!this.visibility || this.visibility.visible)) {
      const revision = this.refreshRequested;
      this.request = new AbortController();
      try { await this.renderLatestRefresh(this.request.signal); }
      catch (error) {
        if (!isAbort(error) && !this.request.signal.aborted) {
          new Notice(error instanceof Error ? error.message : "Dashboard refresh failed.");
        }
      }
      if (revision === this.refreshRequested) this.refreshRendered = revision;
    }
  }
  private attachPaneObserver(): void {
    this.paneObserver?.disconnect();
    this.paneObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      if (this.resizeFrame !== null) (this.contentEl.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = (this.contentEl.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
        this.resizeFrame = null;
        const compact = width <= COMPACT_PANE_MAX;
        if (compact === this.isCompact) {
          this.contentEl.toggleClass("is-compact", compact);
          return;
        }
        this.isCompact = compact;
        void this.refresh().catch(error => new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."));
      });
    });
    this.paneObserver.observe(this.contentEl);
  }

  private syncCompactFromPane(): void {
    const width = this.contentEl.clientWidth;
    if (width > 0) this.isCompact = width <= COMPACT_PANE_MAX;
  }


  private clearWidgets(): void {
    for (const entry of this.renderedWidgets) entry.widget.destroy?.(entry.container);
    this.renderedWidgets = []; this.dayButtons.clear(); this.renderedContext = null; this.staged = undefined;
  }
  private async renderLatestRefresh(signal: AbortSignal): Promise<void> {
    this.syncCompactFromPane();
    const settings = await abortable(this.host.store.loadSettings(), signal);
    checkAbort(signal);
    const today = todayInZone(settings.timezone);
    if (!this.hasOpened) {
      this.year = yearOf(today); this.month = monthOf(today); this.selectedDate = today; this.hasOpened = true;
    }
    if (this.habitFilter !== "overall" && !settings.habits.some(h => h.id === this.habitFilter && h.enabled)) this.habitFilter = "overall";
    await abortable(ensureDashboardFile(this.app, this.host.store.folderPath), signal);
    const layout = await abortable(loadDashboardLayout(this.app, this.host.store.folderPath), signal);
    checkAbort(signal);
    const calendar = layout.widgets.find(item => item.widget === "calendar" || item.widget === "heatmap");
    const calendarMode = calendarModeFor(this.isCompact, calendar?.config?.mode);
    const dates = daysInYear(this.year);
    const visibleDates = dates.filter(date => date <= today && (calendarMode === "year" || monthOf(date) === this.month));
    if (!this.selectedDate || !visibleDates.includes(this.selectedDate)) this.selectedDate = visibleDates.includes(today) ? today : visibleDates.at(-1) ?? null;
    if (calendarMode === "year" && this.selectedDate) this.month = monthOf(this.selectedDate);
    this.clearWidgets();
    const container = this.contentEl;
    container.empty(); container.addClass("temperans-dashboard"); container.toggleClass("is-compact", this.isCompact);
    container.style.setProperty("--temperans-accent", this.host.state.heatmapColor);
    const ctx: WidgetContext = {
      app: this.app, host: this.host, container, year: this.year, month: this.month, selectedDate: this.selectedDate,
      habitFilter: this.habitFilter, settings, logs: new Map(), evaluations: new Map(), analytics: new Map(), dates,
      today, isCompact: this.isCompact, calendarMode, dayButtons: this.dayButtons,
      onSelectDay: date => this.selectDay(date),
      onSelectHabit: id => { this.habitFilter = id; void this.refresh(); },
      onNavigatePeriod: delta => {
        if (calendarMode === "month") { const next = new Date(Date.UTC(this.year, this.month - 1 + delta, 1)); this.year = next.getUTCFullYear(); this.month = next.getUTCMonth() + 1; }
        else this.year += delta;
        void this.refresh();
      },
      onGoToToday: () => { this.year = yearOf(today); this.month = monthOf(today); this.selectedDate = today; void this.refresh(); },
      onRefresh: () => this.refresh()
    };
    this.renderedContext = ctx;
    if (layout.error) {
      const banner = container.createDiv({ cls: "temperans-dashboard-error-banner" });
      banner.createSpan({ text: layout.error + ". Displaying default layout." });
      const dismiss = banner.createEl("button", { text: "Dismiss", attr: { type: "button" } });
      dismiss.onclick = () => banner.remove();
    }
    for (const item of layout.widgets) {
      const widget = this.registry.get(item.widget);
      if (widget) this.renderedWidgets.push({ widget, config: item.config,
        container: container.createDiv({ cls: "temperans-widget temperans-widget-" + widget.id }) });
    }
    this.staged = new StagedDashboard(this.renderedWidgets, ctx, signal);
    await this.staged.run();
  }
  private selectDay(date: string): void {
    const previous = this.selectedDate ? this.dayButtons.get(this.selectedDate) : undefined;
    previous?.removeClass("is-selected"); previous?.setAttr("aria-pressed", "false");
    if (previous && !previous.disabled) previous.tabIndex = -1;
    this.selectedDate = date; this.month = monthOf(date);
    const next = this.dayButtons.get(date);
    next?.addClass("is-selected"); next?.setAttr("aria-pressed", "true");
    if (next && !next.disabled) next.tabIndex = 0;
    void this.staged?.selectDay(date).catch(error => { if (!isAbort(error)) new Notice(error instanceof Error ? error.message : "Could not load the selected day."); });
  }
  cancelRender(): void { this.request?.abort(); }

  async onClose(): Promise<void> {
    this.closed = true; this.request?.abort(); this.visibility?.stop();
    if (this.resizeFrame !== null) { (this.contentEl.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.resizeFrame); this.resizeFrame = null; }
    this.paneObserver?.disconnect(); this.paneObserver = null;
    this.clearWidgets(); this.containerEl.empty();
  }
}
