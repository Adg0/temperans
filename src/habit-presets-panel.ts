import { HABIT_PRESETS, HabitPreset } from "./habit-presets";
import { createSubpageCard } from "./ui";
import { Notice, setIcon } from "obsidian";
import { HabitStore } from "./data";
import { todayInZone } from "./date";

export interface BrowsePresetsOptions {
  onAdded: () => Promise<void>;
  onCustomize?: (preset: HabitPreset) => void;
}

export async function renderBrowsePresets(
  container: HTMLElement,
  store: HabitStore,
  options: BrowsePresetsOptions
): Promise<void> {
  const settings = await store.loadSettings();
  const existingIds = new Set(settings.habits.map((h) => h.id));

  const subpageContainer = container.createDiv({ cls: "temperans-subpage-container" });

  const categories: Array<{ key: HabitPreset["category"]; title: string; desc: string }> = [
    {
      key: "health-connect",
      title: "Health Connect",
      desc: "Biometric and health metrics exported by the Android companion app."
    },
    {
      key: "connected-apis",
      title: "Connected APIs",
      desc: "Third-party services with REST API endpoints and secret storage."
    }
  ];

  for (const cat of categories) {
    const icon = cat.key === "health-connect" ? "heart-pulse" : "cloud-download";
    const { card } = createSubpageCard(subpageContainer, icon, cat.title);

    card.createEl("p", {
      cls: "temperans-subpage-card-desc",
      text: cat.desc
    });

    const grid = card.createDiv({ cls: "temperans-preset-grid" });
    const catPresets = HABIT_PRESETS.filter((p) => p.category === cat.key);

    for (const preset of catPresets) {
      const isAlreadyAdded = existingIds.has(preset.id);
      const card = grid.createDiv({ cls: "temperans-preset-card" });

      const header = card.createDiv({ cls: "temperans-preset-header" });
      const iconBox = header.createSpan({ cls: "temperans-preset-icon" });
      setIcon(iconBox, preset.icon);
      header.createSpan({ cls: "temperans-preset-name", text: preset.name });
      if (preset.min !== undefined) {
        header.createSpan({
          cls: "temperans-preset-badge",
          text: preset.displayFormat === "duration" ? "8h" : `${preset.min} ${preset.unit}`
        });
      }

      card.createDiv({ cls: "temperans-preset-desc", text: preset.description });

      const actions = card.createDiv({ cls: "temperans-preset-actions" });

      if (options.onCustomize && !isAlreadyAdded) {
        const customizeBtn = actions.createEl("button", {
          cls: "temperans-preset-add-btn",
          text: "Customize",
          attr: { type: "button" }
        });
        customizeBtn.onclick = (e) => {
          e?.stopPropagation?.();
          options.onCustomize?.(preset);
        };
      }

      const addBtn = actions.createEl("button", {
        cls: `temperans-preset-add-btn ${isAlreadyAdded ? "" : "mod-cta"}`,
        text: isAlreadyAdded ? "Configured" : "Add",
        attr: { type: "button" }
      });
      addBtn.disabled = isAlreadyAdded;

      addBtn.onclick = async (e) => {
        e?.stopPropagation?.();
        if (existingIds.has(preset.id)) {
          new Notice(`“${preset.name}” is already configured.`);
          return;
        }
        addBtn.disabled = true;
        await store.addHabit({
          id: preset.id,
          name: preset.name,
          unit: preset.unit,
          cadence: preset.cadence,
          enabled: true,
          type: preset.archetype,
          displayFormat: preset.displayFormat,
          targetHistory: [{
            effectiveDate: todayInZone(settings.timezone),
            ...(preset.min !== undefined ? { min: preset.min } : {}),
            ...(preset.max !== undefined ? { max: preset.max } : {})
          }],
          ...(preset.endpoint ? { endpoint: preset.endpoint } : {})
        });
        new Notice(`Created “${preset.name}”.`);
        await options.onAdded();
      };
    }
  }
}
