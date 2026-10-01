import { App, Modal } from "obsidian";
import { HabitStore } from "./data";
import { renderAnalyticsPanel } from "./analytics-panel";

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
    contentEl.createEl("h2", { text: `Habit analytics — ${this.year}` });
    contentEl.createEl("p", {
      text: "Comprehensive performance metrics, volume, consistency, and streaks across all configured tasks."
    });

    await renderAnalyticsPanel(contentEl, this.store, this.year);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
