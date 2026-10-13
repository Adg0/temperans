import { createSubpageCard, renderActionCard } from "./ui";
import { renderAddHabitForm } from "./habit-form";
import { renderBrowsePresets } from "./habit-presets-panel";
import { HabitPreset } from "./habit-presets";
import { renderPeerSyncSettings } from "./peer-sync/settings-panel";
import { renderHealthConnectPanel } from "./integrations/health-connect-panel";
import { App, Modal, Notice, PluginSettingTab, SecretComponent, Setting, SettingDefinitionItem, SettingPage, setIcon } from "obsidian";
import TemperansHabitsPlugin from "./main";
import { formatSleepDuration } from "./durations";
import { EditHabitModal } from "./modals";
import { HabitStore } from "./data";
import { DEFAULT_NOTE_PATH, NotePathSettings, restoreNotePath } from "./note-paths";

type SettingsPageRenderer = (container: HTMLElement, refresh: () => void) => void | Promise<void>;

class TemperansContentSettingPage extends SettingPage {
  constructor(title: string, private readonly renderContent: SettingsPageRenderer) {
    super();
    this.title = title;
  }

  override display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("temperans-settings", "temperans-sub-settings");
    try {
      const result = this.renderContent(this.containerEl, () => this.display());
      void Promise.resolve(result).catch((error: unknown) => {
        console.error(`Temperans Habits could not render ${this.title}.`, error);
        new Notice(error instanceof Error ? error.message : `Could not load ${this.title}.`);
      });
    } catch (error) {
      console.error(`Temperans Habits could not render ${this.title}.`, error);
      new Notice(error instanceof Error ? error.message : `Could not load ${this.title}.`);
    }
  }
}

// Supports Obsidian 1.13.1+ (page display values require 1.13.1).
export class TemperansSettingTab extends PluginSettingTab {
  private habitCount: number | null = null;
  private endpointCount: number | null = null;
  private countRefreshGeneration = 0;

  constructor(app: App, private readonly plugin: TemperansHabitsPlugin) {
    super(app, plugin);
    this.containerEl.addClass("temperans-settings");

    const refreshForSettingsFile = (path: string): void => {
      if (path !== this.plugin.store.settingsPath) return;
      window.setTimeout(() => { void this.refreshPageCounts(); }, 0);
    };
    this.plugin.registerEvent(this.app.vault.on("create", (file) => refreshForSettingsFile(file.path)));
    this.plugin.registerEvent(this.app.vault.on("modify", (file) => refreshForSettingsFile(file.path)));
    this.plugin.registerEvent(this.app.vault.on("delete", (file) => refreshForSettingsFile(file.path)));
    this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      refreshForSettingsFile(file.path);
      refreshForSettingsFile(oldPath);
    }));
    void this.refreshPageCounts();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Habits and data management",
        items: [
          {
            type: "page",
            name: "Configure habits",
            desc: "Manage, reorder, edit, and create habits.",
            displayValue: () => this.habitCount === null ? "" : String(this.habitCount),
            page: () => this.createSettingsPage("Configure habits", (container, refresh) => this.renderHabitsSettings(container, refresh))
          },
          {
            type: "page",
            name: "Browse presets",
            desc: "Choose from pre-configured health metrics and connected APIs.",
            page: () => this.createSettingsPage("Browse presets", (container, refresh) => this.renderPresetsSettings(container, refresh))
          },
          {
            type: "page",
            name: "Automated API endpoints",
            desc: "Test external API connections and manage secret storage keys.",
            displayValue: () => this.endpointCount === null ? "" : String(this.endpointCount),
            page: () => this.createSettingsPage("Automated API endpoints", (container, refresh) => this.renderEndpointsSettings(container, refresh))
          }
        ]
      },
      {
        type: "group",
        heading: "Storage and preferences",
        items: [
          {
            name: "Habit Logs folder",
            desc: "Vault folder for Settings.md and dated habit notes.",
            render: (setting) => this.renderFolderSetting(setting)
          },
          {
            name: "Organize logs by year and month",
            desc: "Save new logs as YYYY/MM/YYYY-MM-DD.md. Existing notes stay where they are.",
            render: (setting) => this.renderNoteOrganizationSetting(setting)
          },
          {
            name: "Custom date format",
            desc: "Moment format for dated log filenames, without .md.",
            visible: () => this.plugin.state.notePath.mode !== "nested",
            render: (setting) => this.renderNoteFormatSetting(setting)
          },
          {
            name: "Heat-map accent color",
            desc: "Controls the heat-map color scale and respects your active Obsidian theme.",
            render: (setting) => this.renderHeatmapColorSetting(setting)
          }
        ]
      },
      {
        type: "group",
        heading: "Vault configuration notes",
        items: [
          {
            name: "Open Settings.md",
            desc: "Customize habit schedules, targets, and historical target revisions in YAML.",
            action: () => { void this.plugin.openSettingsNote(); }
          },
          {
            name: "Open Dashboard.md",
            desc: "Reorder widgets, select cards, and configure dashboard views in YAML.",
            action: () => { void this.plugin.openDashboardConfig(); }
          }
        ]
      },
      {
        type: "group",
        heading: "Synchronization hub",
        items: [
          {
            type: "page",
            name: "Health Connect sync",
            desc: "Import staged health metrics exported from the Android companion app.",
            page: () => this.createSettingsPage("Health Connect sync", (container) => this.renderHealthConnectSettings(container))
          },
          {
            type: "page",
            name: "Local peer sync",
            desc: "Wirelessly transfer and compare habit notes with your paired desktop vault.",
            page: () => this.createSettingsPage("Local peer sync", (container, refresh) => this.renderPeerSyncSettings(container, refresh))
          }
        ]
      }
    ];
  }

  private createSettingsPage(title: string, render: SettingsPageRenderer): SettingPage {
    return new TemperansContentSettingPage(title, render);
  }

  private async refreshPageCounts(): Promise<void> {
    const generation = ++this.countRefreshGeneration;
    try {
      const settings = await this.plugin.store.loadSettings();
      if (generation !== this.countRefreshGeneration) return;
      this.habitCount = settings.habits.length;
      this.endpointCount = settings.habits.filter((habit) => habit.endpoint).length;
    } catch (error) {
      if (generation !== this.countRefreshGeneration) return;
      this.habitCount = null;
      this.endpointCount = null;
      console.error("Temperans Habits could not refresh settings counts.", error);
    }
    this.update();
  }

  private renderFolderSetting(setting: Setting): void {
    setting.setName("Habit Logs folder")
      .setDesc("Vault folder for Settings.md and dated habit notes.");
    let draftFolder = this.plugin.state.folder;

    const saveFolder = async (): Promise<void> => {
      const target = draftFolder.trim() || "Habit Logs";
      if (target === this.plugin.state.folder) {
        new Notice(`Folder is already set to ${target}.`);
        return;
      }
      try {
        await this.plugin.setFolder(target);
        new Notice(`Habit Logs folder updated to "${target}".`);
        this.update();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not save the folder.");
      }
    };

    setting.addText((input) => {
      input.setValue(draftFolder);
      input.onChange((value) => { draftFolder = value; });
      input.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void saveFolder();
        }
      });
    }).addExtraButton((button) => {
      button.setIcon("check");
      button.setTooltip("Save folder name");
      button.onClick(() => { void saveFolder(); });
    });
  }

  private renderNoteOrganizationSetting(setting: Setting): void {
    const current = restoreNotePath(this.plugin.state.notePath);
    const fallbackMode = current.format === DEFAULT_NOTE_PATH.format ? "flat" : "custom";
    setting.setName("Organize logs by year and month")
      .setDesc("Save new logs as YYYY/MM/YYYY-MM-DD.md. Existing notes stay where they are.")
      .addToggle((toggle) => toggle
        .setValue(current.mode === "nested")
        .onChange((enabled) => {
          const next: NotePathSettings = { ...current, mode: enabled ? "nested" : fallbackMode };
          void this.saveNotePath(next);
        }));
  }

  private renderNoteFormatSetting(setting: Setting): void {
    const current = restoreNotePath(this.plugin.state.notePath);
    let format = current.format;
    setting.setName("Custom date format")
      .setDesc("Moment format for dated log filenames, without .md.")
      .addText((input) => {
        input.setPlaceholder("YYYY-MM-DD").setValue(format);
        input.onChange((value) => { format = value.trim(); });
        input.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void this.saveNotePathFormat(format);
          }
        });
      })
      .addButton((button) => button
        .setButtonText("Save format")
        .onClick(() => { void this.saveNotePathFormat(format); }));
  }

  private async saveNotePathFormat(format: string): Promise<void> {
    const next: NotePathSettings = {
      mode: format === DEFAULT_NOTE_PATH.format ? "flat" : "custom",
      format
    };
    await this.saveNotePath(next);
  }

  private async saveNotePath(settings: NotePathSettings): Promise<void> {
    try {
      await this.plugin.setNotePath(settings);
      this.update();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not save note format.");
      this.update();
    }
  }

  private renderHeatmapColorSetting(setting: Setting): void {
    setting.setName("Heat-map accent color")
      .setDesc("Controls the heat-map color scale and respects your active Obsidian theme.");
    const paletteIcon = setting.controlEl.createSpan({ cls: "temperans-palette-icon", attr: { "aria-hidden": "true" } });
    setIcon(paletteIcon, "palette");
    setting.addText((input) => {
      input.inputEl.type = "color";
      input.setValue(this.plugin.state.heatmapColor);
      input.onChange((value) => {
        void this.plugin.setHeatmapColor(value).catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : "Could not save the heat-map color.");
        });
      });
    });
  }

  private renderHabitsSettings(container: HTMLElement, refresh: () => void): Promise<void> {
    container.createEl("p", {
      cls: "temperans-sub-settings-desc",
      text: "Drag cards to reorder. Edit or delete a habit from its row. Changes are saved in Habit Logs/Settings.md."
    });
    return renderHabitsConfiguration(container, {
      app: this.app,
      store: this.plugin.store,
      onChanged: async () => {
        await this.plugin.refreshDashboards();
        await this.refreshPageCounts();
        refresh();
      },
      onAddHabit: () => this.openAddHabitModal(undefined, refresh)
    });
  }

  private renderPresetsSettings(container: HTMLElement, refresh: () => void): Promise<void> {
    return renderBrowsePresets(container, this.plugin.store, {
      onAdded: async () => {
        await this.plugin.refreshDashboards();
        await this.refreshPageCounts();
        refresh();
      },
      onCustomize: (preset) => this.openAddHabitModal(preset, refresh)
    });
  }

  private async renderEndpointsSettings(container: HTMLElement, refresh: () => void): Promise<void> {
    container.createEl("p", {
      cls: "temperans-sub-settings-desc",
      text: "Tasks configured with an external endpoint in Settings.md. Secrets are stored securely in Obsidian secret storage, never in plain Markdown."
    });
    const subpageContainer = container.createDiv({ cls: "temperans-subpage-container" });
    await this.renderEndpointSettingsCards(subpageContainer, refresh);
  }

  private renderHealthConnectSettings(container: HTMLElement): void {
    renderHealthConnectPanel(container, (weekEnding) => this.plugin.importHealthConnect(weekEnding),
      () => this.plugin.refreshDashboards(), this.plugin.healthConnectPathControl());
  }

  private renderPeerSyncSettings(container: HTMLElement, refresh: () => void): Promise<void> {
    container.createEl("p", {
      cls: "temperans-sub-settings-desc",
      text: "Transfers Habit Logs/Settings.md and dated notes with authenticated AES-256-GCM encryption."
    });
    return renderPeerSyncSettings(container, this.plugin.peerSync, refresh);
  }

  private openAddHabitModal(preset?: HabitPreset, refresh?: () => void): void {
    new AddHabitSettingsModal(this.app, this.plugin, preset, async () => {
      await this.refreshPageCounts();
      refresh?.();
    }, () => this.openPresetsModal(refresh)).open();
  }

  private openPresetsModal(refresh?: () => void): void {
    new BrowsePresetsSettingsModal(this.app, this.plugin, async () => {
      await this.refreshPageCounts();
      refresh?.();
    }, (preset) => this.openAddHabitModal(preset, refresh)).open();
  }

  private async renderEndpointSettingsCards(container: HTMLElement, refresh: () => void): Promise<void> {
    const settings = await this.plugin.store.loadSettings();
    const endpointHabits = settings.habits.filter((h) => h.endpoint);

    if (!endpointHabits.length) {
      const emptyCard = container.createDiv({ cls: "temperans-subpage-card" });
      emptyCard.createEl("p", {
        cls: "temperans-subpage-card-desc",
        text: "No tasks currently have an external API endpoint configured. Add an `endpoint:` block to any task in Habit Logs/Settings.md to enable automated API tracking."
      });
      return;
    }

    for (const habit of endpointHabits) {
      const ep = habit.endpoint!;
      const { card } = createSubpageCard(container, "cloud-download", `${habit.name} (${habit.id})`);

      card.createEl("p", {
        cls: "temperans-subpage-card-desc",
        text: `${ep.method || "GET"} ${ep.url}`
      });

      const actionsRow = card.createDiv({ cls: "temperans-card-actions-row" });
      const testBtn = actionsRow.createEl("button", { text: "Test connection", attr: { type: "button" } });
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        try {
          await this.plugin.testEndpointHabit(habit.id);
        } finally {
          testBtn.disabled = false;
        }
      };

      const syncBtn = actionsRow.createEl("button", { text: "Sync past 7 days", attr: { type: "button" } });
      syncBtn.onclick = async () => {
        syncBtn.disabled = true;
        try {
          await this.plugin.syncEndpointHabit(habit.id);
          refresh();
        } finally {
          syncBtn.disabled = false;
        }
      };

      if (ep.auth && ep.auth.type !== "none") {
        const currentKey = ep.auth.secretKey || (habit.id === "typing" ? this.plugin.state.monkeytypeSecretName : "");
        const secretSetting = new Setting(card)
          .setName("Secret key identifier")
          .setDesc("Select or enter the key stored in Obsidian secret storage.");

        const onSecretChanged = async (value: string) => {
          const key = value.trim();
          if (ep.auth) ep.auth.secretKey = key;
          if (habit.id === "typing") {
            this.plugin.state.monkeytypeSecretName = key;
            await this.plugin.savePluginState();
          }
          await this.plugin.store.updateHabit(habit);
          new Notice(`Updated secret key for ${habit.name}.`);
        };

        if (this.app.secretStorage) {
          secretSetting.addComponent((component) => new SecretComponent(this.app, component)
            .setValue(currentKey)
            .onChange(onSecretChanged));
        } else {
          secretSetting.addText((text) => {
            text.inputEl.type = "password";
            text.setValue(currentKey);
            text.onChange(onSecretChanged);
          });
        }
      }
    }
  }
}

class AddHabitSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: TemperansHabitsPlugin,
    private readonly preset: HabitPreset | undefined,
    private readonly onCreated: () => void | Promise<void>,
    private readonly onOpenPresets: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-add-habit-modal");
    this.contentEl.createEl("h2", { text: "Add a habit" });
    void renderAddHabitForm(this.contentEl, this.plugin.store, async () => {
      await this.plugin.refreshDashboards();
      await this.onCreated();
      this.close();
    }, {
      initialPreset: this.preset,
      onOpenPresets: () => {
        this.close();
        this.onOpenPresets();
      }
    }).catch((error: unknown) => {
      new Notice(error instanceof Error ? error.message : "Could not load the habit form.");
    });
  }
}

class BrowsePresetsSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: TemperansHabitsPlugin,
    private readonly onChanged: () => void | Promise<void>,
    private readonly onCustomize: (preset: HabitPreset) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-browse-presets-modal");
    this.contentEl.createEl("h2", { text: "Browse presets" });
    void renderBrowsePresets(this.contentEl, this.plugin.store, {
      onAdded: async () => {
        await this.plugin.refreshDashboards();
        await this.onChanged();
        this.close();
      },
      onCustomize: (preset) => {
        this.close();
        this.onCustomize(preset);
      }
    }).catch((error: unknown) => {
      new Notice(error instanceof Error ? error.message : "Could not load habit presets.");
    });
  }
}

export class DeleteHabitConfirmModal extends Modal {
  constructor(app: App, private habitName: string, private onConfirm: () => Promise<void>) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.createEl("p", {
      text: `Delete habit “${this.habitName}”? Existing entries in your daily logs will be preserved.`
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Delete").setDestructive().onClick(async () => {
        this.close();
        await this.onConfirm();
      }));
  }
}

export interface HabitsConfigurationHost {
  app: App;
  store: HabitStore;
  onChanged: () => Promise<void>;
  onAddHabit: () => void;
}

export async function renderHabitsConfiguration(
  container: HTMLElement,
  host: HabitsConfigurationHost
): Promise<void> {
  const { app, store, onChanged, onAddHabit } = host;
  const settings = await store.loadSettings();

  // Add Habit CTA (Clickable full card)
  renderActionCard(container, {
    icon: "plus-circle",
    title: "Create a new habit",
    description: "Define a positive build habit, avoidance habit, or zero-goal metric tracker.",
    onClick: onAddHabit
  });

  container.createDiv({
    cls: "temperans-actions-section-title",
    text: `Configured habits (${settings.habits.length})`
  });

  const list = container.createDiv({ cls: "temperans-sortable-task-list" });
  const habitIds = settings.habits.map((item) => item.id);
  let draggedIndex: number | null = null;

  const reorderHabitsTo = async (ids: string[]): Promise<void> => {
    try {
      await store.reorderHabits(ids);
      await onChanged();
    } catch (error: unknown) {
      console.error("Temperans Habits could not save task order.", error);
      new Notice("Could not save the task order. Please try again.");
      await onChanged();
    }
  };

  const moveHabit = async (index: number, direction: -1 | 1): Promise<void> => {
    const destination = index + direction;
    if (destination < 0 || destination >= habitIds.length) return;
    const newIds = [...habitIds];
    [newIds[index], newIds[destination]] = [newIds[destination], newIds[index]];
    await reorderHabitsTo(newIds);
  };

  for (const [index, habit] of settings.habits.entries()) {
    const target = habit.targetHistory.at(-1);
    const formatTarget = (value: number) => habit.id === "sleep" ? formatSleepDuration(value) : `${value} ${habit.unit}`;
    const range = target?.min !== undefined && target?.max !== undefined
      ? `${formatTarget(target.min)}–${formatTarget(target.max)}`
      : target?.min !== undefined
      ? formatTarget(target.min)
      : target?.max !== undefined
      ? `max ${formatTarget(target.max)}`
      : "No target";

    const row = list.createDiv({ cls: "temperans-sortable-task", attr: { "data-habit-id": habit.id } });
    row.draggable = true;

    // 1. Left-aligned drag handle
    const dragHandle = row.createSpan({ cls: "temperans-task-drag-handle", attr: { "aria-label": "Drag to reorder" } });
    setIcon(dragHandle, "grip-vertical");

    row.addEventListener("dragstart", (e) => {
      draggedIndex = index;
      row.addClass("is-dragging");
      e.dataTransfer?.setData("text/plain", String(index));
    });

    row.addEventListener("dragend", () => {
      row.removeClass("is-dragging");
      draggedIndex = null;
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.addClass("is-drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.removeClass("is-drag-over");
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.removeClass("is-drag-over");
      if (draggedIndex === null || draggedIndex === index) return;
      const newIds = [...habitIds];
      const [moved] = newIds.splice(draggedIndex, 1);
      newIds.splice(index, 0, moved);
      void reorderHabitsTo(newIds);
    });

    // 2. Left-aligned title and metadata
    const textContainer = row.createDiv({ cls: "temperans-task-text-container" });
    textContainer.createEl("strong", { text: habit.name, cls: "temperans-task-title" });
    textContainer.createSpan({
      text: ` · ${habit.cadence}${habit.type === "avoidance" ? " · avoidance" : habit.type === "tracker" ? " · tracker" : ""} · ${range}${habit.enabled ? "" : " · disabled"}`,
      cls: "temperans-task-meta"
    });

    // 3. Right-aligned controls
    const controls = row.createDiv({ cls: "temperans-task-order-controls" });

    // Edit Pencil button
    const editBtn = controls.createEl("button", {
      cls: "temperans-task-order-button",
      attr: { type: "button", "aria-label": `Edit ${habit.name}` }
    });
    setIcon(editBtn, "pencil");
    editBtn.onclick = () => {
      new EditHabitModal(app, habit, settings.timezone, async (updated) => {
        await store.updateHabit(updated);
        new Notice(`Updated “${updated.name}”.`);
        await onChanged();
      }).open();
    };

    // Delete Trash button
    const deleteBtn = controls.createEl("button", {
      cls: "temperans-task-order-button mod-warning",
      attr: { type: "button", "aria-label": `Delete ${habit.name}` }
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.onclick = () => {
      new DeleteHabitConfirmModal(app, habit.name, async () => {
        await store.deleteHabit(habit.id);
        new Notice(`Deleted “${habit.name}”.`);
        await onChanged();
      }).open();
    };

    // Up and Down selectors
    const up = controls.createEl("button", {
      cls: "temperans-task-order-button",
      attr: { type: "button", "aria-label": `Move ${habit.name} up` }
    });
    setIcon(up, "chevron-up");
    up.disabled = index === 0;
    up.onclick = () => void moveHabit(index, -1);

    const down = controls.createEl("button", {
      cls: "temperans-task-order-button",
      attr: { type: "button", "aria-label": `Move ${habit.name} down` }
    });
    setIcon(down, "chevron-down");
    down.disabled = index === settings.habits.length - 1;
    down.onclick = () => void moveHabit(index, 1);
  }
}
