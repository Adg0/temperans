import { renderNotePathSettings } from "./note-path-settings";
import { createSubpageCard, renderActionCard, renderSubpageHeader } from "./ui";
import { renderAddHabitForm } from "./habit-form";
import { renderBrowsePresets } from "./habit-presets-panel";
import { HabitPreset } from "./habit-presets";
import { renderPeerSyncSettings } from "./peer-sync/settings-panel";
import { renderHealthConnectPanel } from "./integrations/health-connect-panel";
import { App, Modal, Notice, PluginSettingTab, SecretComponent, Setting, setIcon } from "obsidian";
import TemperansHabitsPlugin from "./main";
import { EditHabitModal } from "./modals";
import { formatSleepDuration } from "./durations";

// Supports Obsidian 1.13.0+
export class TemperansSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TemperansHabitsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.removeClass("temperans-sub-settings");
    containerEl.addClass("temperans-settings");

    const header = containerEl.createDiv({ cls: "temperans-actions-header" });
    new Setting(header).setName("Habit tracking and imports").setHeading();
    header.createEl("p", {
      text: "Bring habit data together from endpoints and companion apps, or log it here. Your history stays in Markdown."
    });

    // Section 1: Habits and Data Management (Stacked full-width for breathing room)
    const habitsSection = containerEl.createDiv({ cls: "temperans-settings-section" });
    habitsSection.createDiv({
      cls: "temperans-actions-section-title",
      text: "Habits and data management"
    });

    const habitsStack = habitsSection.createDiv({ cls: "temperans-actions-stack" });

    const configureHabitsCard = renderActionCard(habitsStack, {
      icon: "list-ordered",
      title: "Configure habits",
      description: "Manage, reorder, edit, and create habits.",
      badgeText: "Loading...",
      onClick: () => this.displayHabitsSubSettings()
    });

    const endpointsCard = renderActionCard(habitsStack, {
      icon: "cloud-download",
      title: "Automated API endpoints",
      description: "Configure external REST APIs, sync past logs, and manage Secret Storage keys.",
      badgeText: "Loading...",
      onClick: () => this.displayEndpointsSubSettings()
    });

    void this.plugin.store.loadSettings().then((settings) => {
      const habitCount = settings.habits.length;
      configureHabitsCard.setBadge(`${habitCount} habit${habitCount === 1 ? "" : "s"}`);

      const endpointCount = settings.habits.filter((h) => h.endpoint).length;
      endpointsCard.setBadge(`${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`);
    });

    // Section 2: Storage and Preferences Card
    const storageSection = containerEl.createDiv({ cls: "temperans-settings-section" });
    storageSection.createDiv({
      cls: "temperans-actions-section-title",
      text: "Storage and preferences"
    });

    const storageCard = storageSection.createDiv({ cls: "temperans-subpage-card" });

    let draftFolder = this.plugin.state.folder;
    const saveFolder = async () => {
      const target = draftFolder.trim() || "Habit Logs";
      if (target === this.plugin.state.folder) {
        new Notice("Folder is already set to " + target);
        return;
      }
      try { await this.plugin.setFolder(target); }
      catch (error) { new Notice(error instanceof Error ? error.message : "Could not save the folder."); return; }
      new Notice(`Habit Logs folder updated to "${target}".`);
      this.display();
    };

    new Setting(storageCard)
      .setName("Habit Logs folder")
      .setDesc("Dedicated vault folder where Settings.md and dated daily habit notes are stored.")
      .addText((input) => {
        input.setValue(draftFolder);
        input.onChange((value) => { draftFolder = value; });
        input.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void saveFolder();
          }
        });
      })
      .addExtraButton((button) => {
        button.setIcon("check");
        button.setTooltip("Save folder name");
        button.onClick(() => void saveFolder());
      });

    renderNotePathSettings(storageCard.createDiv(), this.app, this.plugin.state.folder, this.plugin.state.notePath,
      value => this.plugin.setNotePath(value));

    const heatmapSetting = new Setting(storageCard)
      .setName("Heat-map accent color")
      .setDesc("Controls the heat-map color scale; respects your active Obsidian theme.");

    const paletteIcon = heatmapSetting.controlEl.createSpan({ cls: "temperans-palette-icon", attr: { "aria-hidden": "true" } });
    setIcon(paletteIcon, "palette");

    heatmapSetting.addText((input) => {
      input.inputEl.type = "color";
      input.setValue(this.plugin.state.heatmapColor);
      input.onChange(async (value) => this.plugin.setHeatmapColor(value));
    });

    // Section 3: Vault Configuration Notes
    const notesSection = containerEl.createDiv({ cls: "temperans-settings-section" });
    notesSection.createDiv({
      cls: "temperans-actions-section-title",
      text: "Vault configuration notes"
    });

    const notesGrid = notesSection.createDiv({ cls: "temperans-actions-grid" });

    renderActionCard(notesGrid, {
      icon: "file-text",
      title: "Open Settings.md",
      description: "Directly customize habit schedules, targets, and historical target revisions in YAML.",
      onClick: () => this.plugin.openSettingsNote()
    });

    renderActionCard(notesGrid, {
      icon: "layout-dashboard",
      title: "Open Dashboard.md",
      description: "Reorder widgets, select cards, and configure views in declarative YAML.",
      onClick: () => this.plugin.openDashboardConfig()
    });

    // Section 4: Synchronization Hub
    const syncSection = containerEl.createDiv({ cls: "temperans-settings-section" });
    syncSection.createDiv({
      cls: "temperans-actions-section-title",
      text: "Synchronization hub"
    });

    const syncGrid = syncSection.createDiv({ cls: "temperans-actions-grid" });

    renderActionCard(syncGrid, {
      icon: "heart-pulse",
      title: "Health Connect sync",
      description: "Import staged health metrics exported from the Android companion app.",
      actionButton: {
        label: "Import staged",
        icon: "download",
        onClick: async () => {
          try {
            await this.plugin.importHealthConnect();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Could not import staged data.");
          }
        }
      },
      onClick: () => this.displaySyncHubSubSettings()
    });

    renderActionCard(syncGrid, {
      icon: "wifi",
      title: "Local peer sync",
      description: "Wirelessly transfer and compare habit notes with your paired desktop vault.",
      onClick: () => this.displayPeerSyncSubSettings()
    });
  }

  private async displayHabitsSubSettings(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Configure habits",
      "Drag cards using the left grip or use the arrows to reorder. Tap the pencil to edit or trash to delete. Changes are saved directly in Habit Logs/Settings.md.", "Back to settings", () => this.display());

    const settings = await this.plugin.store.loadSettings();

    // Add Habit CTA (Clickable full card)
    renderActionCard(containerEl, {
      icon: "plus-circle",
      title: "Create a new habit",
      description: "Define a positive build habit, avoidance habit, or zero-goal metric tracker.",
      onClick: () => {
        void this.displayAddHabitSubSettings();
      }
    });

    containerEl.createDiv({
      cls: "temperans-actions-section-title",
      text: `Configured habits (${settings.habits.length})`
    });

    const list = containerEl.createDiv({ cls: "temperans-sortable-task-list" });
    const habitIds = settings.habits.map((item) => item.id);
    let draggedIndex: number | null = null;

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
        void this.reorderHabitsTo(newIds);
      });

      // 2. Left-aligned title & metadata
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
        new EditHabitModal(this.app, habit, settings.timezone, async (updated) => {
          await this.plugin.store.updateHabit(updated);
          await this.plugin.refreshDashboards();
          await this.displayHabitsSubSettings();
        }).open();
      };

      // Delete Trash button
      const deleteBtn = controls.createEl("button", {
        cls: "temperans-task-order-button mod-warning",
        attr: { type: "button", "aria-label": `Delete ${habit.name}` }
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.onclick = () => {
        new DeleteHabitConfirmModal(this.app, habit.name, async () => {
          await this.plugin.store.deleteHabit(habit.id);
          await this.plugin.refreshDashboards();
          new Notice(`Deleted “${habit.name}”.`);
          await this.displayHabitsSubSettings();
        }).open();
      };

      // Up and Down selectors
      const up = controls.createEl("button", {
        cls: "temperans-task-order-button",
        attr: { type: "button", "aria-label": `Move ${habit.name} up` }
      });
      setIcon(up, "chevron-up");
      up.disabled = index === 0;
      up.onclick = () => this.moveHabit(habitIds, index, -1);

      const down = controls.createEl("button", {
        cls: "temperans-task-order-button",
        attr: { type: "button", "aria-label": `Move ${habit.name} down` }
      });
      setIcon(down, "chevron-down");
      down.disabled = index === settings.habits.length - 1;
      down.onclick = () => this.moveHabit(habitIds, index, 1);
    }
  }

  private async displayAddHabitSubSettings(preset?: HabitPreset): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Add a habit",
      "Configure a positive build habit, negative/avoidance habit, or zero-goal metric tracker.", "Back to habits", () => void this.displayHabitsSubSettings());

    await renderAddHabitForm(containerEl, this.plugin.store, async () => {
      await this.plugin.refreshDashboards();
      await this.displayHabitsSubSettings();
    }, {
      initialPreset: preset,
      onOpenPresets: () => { void this.displayPresetsSubSettings(); }
    });
  }

  private async displayPresetsSubSettings(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Browse presets",
      "Select from pre-configured Health Connect metrics and connected APIs.", "Back to add habit", () => void this.displayAddHabitSubSettings());

    await renderBrowsePresets(containerEl, this.plugin.store, {
      onAdded: async () => {
        await this.plugin.refreshDashboards();
        await this.displayHabitsSubSettings();
      },
      onCustomize: (preset) => {
        void this.displayAddHabitSubSettings(preset);
      }
    });
  }

  private async displayEndpointsSubSettings(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Automated API endpoints",
      "Tasks configured with an external endpoint in Settings.md. Secrets are stored securely in Obsidian Secret Storage, never in plain Markdown.", "Back to settings", () => this.display());

    const subpageContainer = containerEl.createDiv({ cls: "temperans-subpage-container" });
    await this.renderEndpointSettingsCards(subpageContainer);
  }

  private displaySyncHubSubSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Health Connect sync",
      undefined, "Back to settings", () => this.display());

    renderHealthConnectPanel(containerEl, (weekEnding) => this.plugin.importHealthConnect(weekEnding),
      () => this.plugin.refreshDashboards(), this.plugin.healthConnectPathControl());
  }

  private displayPeerSyncSubSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("temperans-settings", "temperans-sub-settings");

    renderSubpageHeader(containerEl, "Local peer sync",
      "Transfers Habit Logs/Settings.md and dated notes with authenticated AES-256-GCM encryption.", "Back to settings", () => this.display());

    void renderPeerSyncSettings(containerEl, this.plugin.peerSync, () => this.displayPeerSyncSubSettings());
  }

  private moveHabit(ids: string[], index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= ids.length) return;
    const newIds = [...ids];
    [newIds[index], newIds[destination]] = [newIds[destination], newIds[index]];
    void this.reorderHabitsTo(newIds);
  }

  private async reorderHabitsTo(ids: string[]): Promise<void> {
    try {
      await this.plugin.reorderHabits(ids);
      await this.displayHabitsSubSettings();
    } catch (error: unknown) {
      console.error("Temperans Habits could not save task order.", error);
      new Notice("Could not save the task order. Please try again.");
      await this.displayHabitsSubSettings();
    }
  }

  private async renderEndpointSettingsCards(container: HTMLElement): Promise<void> {
    const settings = await this.plugin.store.loadSettings();
    const endpointHabits = settings.habits.filter((h) => h.endpoint);

    if (!endpointHabits.length) {
      const emptyCard = container.createDiv({ cls: "temperans-subpage-card" });
      emptyCard.createEl("p", {
        cls: "temperans-subpage-card-desc",
        text: "No tasks currently have an external API endpoint configured. You can enable automated tracking for any task (Monkeytype, WakaTime, Duolingo, GitHub, etc.) by adding an `endpoint:` block to that task in Habit Logs/Settings.md."
      });
      return;
    }

    for (const habit of endpointHabits) {
      const ep = habit.endpoint!;
      const secretKey = ep.auth?.secretKey || (habit.id === "typing" ? this.plugin.state.monkeytypeSecretName : "");

      const { card } = createSubpageCard(container, "cloud-download", `${habit.name} (${habit.id})`);

      card.createEl("p", {
        cls: "temperans-subpage-card-desc",
        text: `${ep.method || "GET"} ${ep.url}`
      });

      const actionsRow = card.createDiv({ cls: "temperans-card-actions-row" });
      const testBtn = actionsRow.createEl("button", { text: "Test connection", attr: { type: "button" } });
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        await this.plugin.testEndpointHabit(habit.id);
        testBtn.disabled = false;
      };

      const syncBtn = actionsRow.createEl("button", { text: "Sync past 7 days", attr: { type: "button" } });
      syncBtn.onclick = async () => {
        syncBtn.disabled = true;
        await this.plugin.syncEndpointHabit(habit.id);
        syncBtn.disabled = false;
      };

      if (ep.auth && ep.auth.type !== "none" && secretKey) {
        const secretSetting = new Setting(card)
          .setName("Secret key identifier")
          .setDesc(`Stored in Obsidian Secret Storage under "${secretKey}".`);

        if (this.app.secretStorage) {
          secretSetting.addComponent((component) => new SecretComponent(this.app, component)
            .setValue(secretKey)
            .onChange(async (value) => {
              if (habit.id === "typing") {
                this.plugin.state.monkeytypeSecretName = value;
                await this.plugin.savePluginState();
              }
            }));
        } else {
          secretSetting.addText((text) => {
            text.inputEl.type = "password";
            text.setValue(secretKey);
            text.onChange(async (value) => {
              if (habit.id === "typing") {
                this.plugin.state.monkeytypeSecretName = value;
                await this.plugin.savePluginState();
              }
            });
          });
        }
      }
    }
  }
}

class DeleteHabitConfirmModal extends Modal {
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
