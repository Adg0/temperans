import { ActionCard, renderActionCard, renderSubpageHeader } from "./ui";
import { renderAnalyticsPanel } from "./analytics-panel";
import { PeerSyncService } from "./peer-sync/service";
import { HealthConnectImportSummary } from "./integrations/health-connect";
import { renderAddHabitForm } from "./habit-form";
import { renderBrowsePresets } from "./habit-presets-panel";
import { HabitPreset } from "./habit-presets";
import { renderPeerSyncSettings } from "./peer-sync/settings-panel";
import { HealthConnectPathControl, renderHealthConnectPanel } from "./integrations/health-connect-panel";
import { App, Modal, Notice } from "obsidian";
import { HabitStore } from "./data";

export interface DashboardActionsHost {
  store: HabitStore;
  peerSync?: PeerSyncService;
  importHealthConnect?(weekEnding?: string): Promise<HealthConnectImportSummary | null>;
  openThirdPartySync(): void;
  openPeerSync(): void;
  healthConnectPathControl?(): HealthConnectPathControl;
  syncAllEndpoints(): Promise<void>;
  openSettingsNote(): Promise<void>;
  openAnalyticsSummary(): void;
  openDashboardConfig(): Promise<void>;
}

type ActionsView = "menu" | "peer-sync" | "sync-hub" | "analytics" | "add-habit" | "presets";

/** Frequently used dashboard actions, presented in an elegant, categorized action palette with embedded sub-pages. */
export class DashboardActionsModal extends Modal {
  private currentView: ActionsView = "menu";
  private selectedPreset?: HabitPreset;

  constructor(
    app: App,
    private readonly host: DashboardActionsHost,
    private readonly onTasksChanged: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-dashboard-actions-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.currentView === "menu") {
      this.renderMenu(contentEl);
    } else if (this.currentView === "peer-sync") {
      void this.renderPeerSync(contentEl);
    } else if (this.currentView === "sync-hub") {
      this.renderSyncHub(contentEl);
    } else if (this.currentView === "analytics") {
      void this.renderAnalytics(contentEl);
    } else if (this.currentView === "add-habit") {
      void this.renderAddHabit(contentEl);
    } else if (this.currentView === "presets") {
      void this.renderPresets(contentEl);
    }
  }

  private renderSubpageHeader(container: HTMLElement, title: string, subtitle?: string): void {
    renderSubpageHeader(container, title, subtitle, "Back to actions", () => {
      this.currentView = "menu";
      this.render();
    });
  }

  private renderMenu(container: HTMLElement): void {
    const header = container.createDiv({ cls: "temperans-actions-header" });
    header.createEl("h2", { text: "Habit actions" });
    header.createEl("p", { text: "Quick actions for synchronization, habits, analytics, and vault notes." });

    // Category 1: Sync and Integrations
    this.renderSection(container, "Sync and integrations", [
      {
        icon: "wifi",
        title: "Local peer sync",
        description: "Compare and transfer Habit Logs securely with your paired desktop.",
        onClick: () => {
          this.currentView = "peer-sync";
          this.render();
        }
      },
      {
        icon: "cloud-download",
        title: "Sync automated endpoints",
        description: "Fetch the past 7 days from all external REST APIs configured in Settings.md.",
        onClick: async () => {
          this.close();
          await this.host.syncAllEndpoints();
        }
      },
      {
        icon: "heart-pulse",
        title: "Health Connect staging hub",
        description: "Import staged health data on Android or review workflow on desktop.",
        actionButton: {
          label: "Import staged",
          icon: "download",
          onClick: async () => {
            try {
              const result = await this.host.importHealthConnect?.();
              if (result) {
                await this.onTasksChanged();
              }
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Could not import staged data.");
            }
          }
        },
        onClick: () => {
          this.currentView = "sync-hub";
          this.render();
        }
      }
    ]);

    // Category 2: Habits and Insights
    this.renderSection(container, "Habits and insights", [
      {
        icon: "bar-chart-2",
        title: "Analytics summary",
        description: "Review consistency rates, streaks, total volume, and averages across tasks.",
        onClick: () => {
          this.currentView = "analytics";
          this.render();
        }
      },
      {
        icon: "plus-circle",
        title: "Add a habit",
        description: "Create a build habit, negative/avoidance habit, or zero-goal tracker.",
        onClick: () => {
          this.selectedPreset = undefined;
          this.currentView = "add-habit";
          this.render();
        }
      }
    ]);

    // Category 3: Vault Configuration
    this.renderSection(container, "Vault configuration", [
      {
        icon: "file-text",
        title: "Edit Settings.md",
        description: "Directly customize habit schedules, targets, and historical target revisions.",
        onClick: async () => {
          this.close();
          await this.host.openSettingsNote();
        }
      },
      {
        icon: "layout-dashboard",
        title: "Edit Dashboard.md",
        description: "Reorder widgets, adjust cards, and configure views in declarative YAML.",
        onClick: async () => {
          this.close();
          await this.host.openDashboardConfig();
        }
      }
    ]);
  }

  private renderSection(container: HTMLElement, title: string, actions: ActionCard[]): void {
    container.createDiv({
      cls: "temperans-actions-section-title",
      text: title
    });

    const grid = container.createDiv({ cls: "temperans-actions-grid" });

    for (const action of actions) renderActionCard(grid, action);
  }

  private async renderPeerSync(container: HTMLElement): Promise<void> {
    this.renderSubpageHeader(
      container,
      "Local peer sync",
      "Transfers Habit Logs/Settings.md and dated notes with authenticated AES-256-GCM encryption."
    );

    await renderPeerSyncSettings(container, this.host.peerSync, () => this.render());
  }

  private renderSyncHub(container: HTMLElement): void {
    this.renderSubpageHeader(
      container,
      "Health Connect sync",
      ""
    );

    renderHealthConnectPanel(container, async (weekEnding) => this.host.importHealthConnect?.(weekEnding), this.onTasksChanged, this.host.healthConnectPathControl?.());
  }

  private async renderAnalytics(container: HTMLElement): Promise<void> {
    const year = new Date().getFullYear();
    this.renderSubpageHeader(
      container,
      `Habit analytics — ${year}`,
      "Comprehensive consistency rates, volume, averages, and streaks across all enabled habits."
    );

    await renderAnalyticsPanel(container, this.host.store, year, false);
  }

  private async renderAddHabit(container: HTMLElement): Promise<void> {
    this.renderSubpageHeader(
      container,
      "Add a habit",
      "Configure a positive build habit, negative/avoidance habit, or zero-goal metric tracker."
    );

    await renderAddHabitForm(container, this.host.store, async () => {
      this.selectedPreset = undefined;
      await this.onTasksChanged();
      this.currentView = "menu";
      this.render();
    }, {
      initialPreset: this.selectedPreset,
      onOpenPresets: () => {
        this.currentView = "presets";
        this.render();
      }
    });
  }

  private async renderPresets(container: HTMLElement): Promise<void> {
    renderSubpageHeader(
      container,
      "Browse presets",
      "Select from pre-configured Health Connect metrics and connected APIs.",
      "Back to add habit",
      () => {
        this.currentView = "add-habit";
        this.render();
      }
    );

    await renderBrowsePresets(container, this.host.store, {
      onAdded: async () => {
        this.selectedPreset = undefined;
        await this.onTasksChanged();
        this.currentView = "menu";
        this.render();
      },
      onCustomize: (preset) => {
        this.selectedPreset = preset;
        this.currentView = "add-habit";
        this.render();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
