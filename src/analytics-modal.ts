import { App, Modal } from "obsidian";
import type { HabitStore } from "./data";
import { loadAnalyticsSummaryData, renderAnalyticsPanel } from "./analytics-panel";
import { renderAnalyticsShareActions } from "./analytics-share";

export class HabitAnalyticsModal extends Modal {
  constructor(
    app: App,
    private readonly store: HabitStore,
    private readonly year = new Date().getFullYear()
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-analytics-modal");
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    const summary = await loadAnalyticsSummaryData(this.store, this.year);
    const header = contentEl.createDiv({ cls: "temperans-analytics-header" });
    header.createEl("h2", { text: `Habit analytics — ${this.year}` });
    if (summary.habits.length) renderAnalyticsShareActions(header, this.app, this.store, summary);
    contentEl.createEl("p", {
      text: "Comprehensive performance metrics, volume, consistency, and streaks across all configured tasks."
    });
    renderAnalyticsPanel(contentEl, summary);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
