import { CADENCE_OPTIONS, UNIT_LABELS } from "./habit-options";
import { HabitPreset } from "./habit-presets";
import { createSubpageCard, renderActionCard } from "./ui";
import { Notice, Setting, setIcon } from "obsidian";
import { HabitStore } from "./data";
import { todayInZone } from "./date";
import { createTemperansDropdown } from "./dropdown";
import { EndpointConfig, HabitCadence, HabitDefinition, HabitDisplayFormat, RESERVED_HABIT_IDS, TargetVersion } from "./types";

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export interface AddHabitFormOptions {
  initialPreset?: HabitPreset;
  onOpenPresets?: () => void;
}

export async function renderAddHabitForm(
  container: HTMLElement,
  store: HabitStore,
  onCreated: () => Promise<void>,
  options?: AddHabitFormOptions
): Promise<void> {
  const settings = await store.loadSettings();
  const existingIds = new Set(settings.habits.map((h) => h.id));

  const subpageContainer = container.createDiv({ cls: "temperans-subpage-container" });

  const preset = options?.initialPreset;

  let name = preset?.name ?? "";
  let habitCategory: "build" | "avoidance" | "tracker" = preset
    ? (preset.archetype === "avoidance" ? "avoidance" : (preset.archetype === "tracker" ? "tracker" : "build"))
    : "build";
  let cadence: HabitCadence = preset?.cadence ?? "daily";
  let isSessionHabit = preset?.archetype === "session";
  let minimum = preset?.min !== undefined ? String(preset.min) : "30";
  let maximum = preset?.max !== undefined ? String(preset.max) : "";
  let presetEndpoint: EndpointConfig | undefined = preset?.endpoint;
  let presetDisplayFormat: HabitDisplayFormat | undefined = preset?.displayFormat;

  // 0. Browse Presets Clickable Action Card (Single un-nested card)
  if (options?.onOpenPresets) {
    const openPresets = options.onOpenPresets;
    renderActionCard(subpageContainer, {
      icon: "sparkles",
      title: "Browse presets",
      description: "Choose from pre-configured Health Connect metrics and connected APIs.",
      onClick: () => openPresets()
    });
  }

  // 1. Archetype Selection Card
  const { card: archetypeCard } = createSubpageCard(subpageContainer, "layers", "1. Choose habit archetype");

  const archetypeGrid = archetypeCard.createDiv({ cls: "temperans-archetype-grid" });

  const archetypes: Array<{ key: "build" | "avoidance" | "tracker"; icon: string; title: string; desc: string }> = [
    { key: "build", icon: "sparkles", title: "Build habit", desc: "Reach a positive daily or periodic target." },
    { key: "avoidance", icon: "shield-alert", title: "Avoidance habit", desc: "Quit or minimize slips (clean days build streak)." },
    { key: "tracker", icon: "scale", title: "Metric tracker", desc: "Log variables (weight, mood) without goal pressure." }
  ];

  const archetypeTiles: HTMLElement[] = [];

  archetypes.forEach((item) => {
    const tile = archetypeGrid.createDiv({
      cls: `temperans-archetype-card ${item.key === habitCategory ? "is-selected" : ""}`,
      attr: { role: "button", tabindex: "0", "aria-label": item.title }
    });
    archetypeTiles.push(tile);

    const tIcon = tile.createDiv({ cls: "temperans-archetype-icon" });
    setIcon(tIcon, item.icon);
    tile.createDiv({ cls: "temperans-archetype-title", text: item.title });
    tile.createDiv({ cls: "temperans-archetype-desc", text: item.desc });

    const select = () => {
      habitCategory = item.key;
      archetypeTiles.forEach((t) => t.removeClass("is-selected"));
      tile.addClass("is-selected");
      updateDynamicTargetCard();
    };

    tile.onclick = select;
    tile.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    };
  });

  // 2. Identity and Cadence Card
  const { card: detailsCard } = createSubpageCard(subpageContainer, "tag", "2. Habit details and cadence");

  new Setting(detailsCard).setName("Habit name").addText((input) => {
    if (name) input.setValue(name);
    input
      .setPlaceholder("e.g. Daily reading, No sugar, Body weight")
      .onChange((value) => { name = value; });
  });

  let selectedUnitChoice = preset
    ? (Object.hasOwn(UNIT_LABELS, preset.unit) ? preset.unit : "custom")
    : "count";
  let customUnitValue = preset && !Object.hasOwn(UNIT_LABELS, preset.unit) ? preset.unit : "";

  const unitSetting = new Setting(detailsCard).setName("Unit");
  const customUnitContainer = detailsCard.createDiv({ cls: "temperans-custom-unit-setting" });
  if (selectedUnitChoice !== "custom") customUnitContainer.addClass("temperans-hidden");

  new Setting(customUnitContainer)
    .setName("Custom unit name")
    .addText((input) => {
      if (customUnitValue) input.setValue(customUnitValue);
      input.setPlaceholder("e.g. km, steps, words").onChange((value) => {
        customUnitValue = value.trim();
      });
    });

  createTemperansDropdown(unitSetting.controlEl, {
    value: selectedUnitChoice,
    options: Object.keys(UNIT_LABELS).map((value) => ({ value, label: UNIT_LABELS[value] })),
    ariaLabel: "Choose a habit unit",
    onChange: (value) => {
      selectedUnitChoice = value;
      customUnitContainer.toggleClass("temperans-hidden", value !== "custom");
    }
  });

  const cadenceSetting = new Setting(detailsCard).setName("Goal cadence");
  createTemperansDropdown(cadenceSetting.controlEl, {
    value: cadence,
    options: CADENCE_OPTIONS,
    ariaLabel: "Choose a goal cadence",
    onChange: (value) => { cadence = value as HabitCadence; }
  });

  // 3. Targets and Options Card
  const { card: targetCard } = createSubpageCard(subpageContainer, "target", "3. Target configuration");

  const targetBody = targetCard.createDiv({ cls: "temperans-target-body" });

  const updateDynamicTargetCard = () => {
    targetBody.empty();

    if (habitCategory === "avoidance") {
      new Setting(targetBody)
        .setName("Tolerance limit (max slips)")
        .setDesc("0 means complete abstinence. Entering 0 or leaving unlogged builds your streak.")
        .addText((input) => {
          input.setPlaceholder("0").setValue(maximum || "0").onChange((value) => { maximum = value; });
          input.inputEl.type = "number";
          input.inputEl.min = "0";
          input.inputEl.step = "any";
        });
    } else if (habitCategory === "tracker") {
      targetBody.createEl("p", {
        cls: "temperans-subpage-card-desc",
        text: "Zero-goal habit: logs numerical values without a goal. Missing a day will never break your streaks or lower your completion score."
      });
    } else {
      new Setting(targetBody)
        .setName("Minimum target")
        .setDesc("Required progress amount to achieve 100% completion.")
        .addText((input) => {
          input.setPlaceholder("e.g. 30").setValue(minimum).onChange((value) => { minimum = value; });
          input.inputEl.type = "number";
          input.inputEl.min = "0";
          input.inputEl.step = "any";
        });

      new Setting(targetBody)
        .setName("Maximum target")
        .setDesc("Optional upper limit for bounded targets.")
        .addText((input) => {
          input.setPlaceholder("Optional").setValue(maximum).onChange((value) => { maximum = value; });
          input.inputEl.type = "number";
          input.inputEl.min = "0";
          input.inputEl.step = "any";
        });

      new Setting(targetBody)
        .setName("Multi-entry sessions")
        .setDesc("Log multiple entries with titles and notes throughout the day.")
        .addToggle((toggle) => toggle.setValue(isSessionHabit).onChange((v) => { isSessionHabit = v; }));
    }
  };

  updateDynamicTargetCard();

  // Create Button Row
  const btnRow = subpageContainer.createDiv({ cls: "temperans-create-btn-row" });
  const createBtn = btnRow.createEl("button", { text: "Create habit", attr: { type: "button" } });
  createBtn.onclick = async () => {
    const baseId = slugify(name);
    if (!name.trim() || !baseId) return new Notice("Enter a habit name.");
    if (RESERVED_HABIT_IDS.has(baseId)) return new Notice("That habit name is reserved.");

    let targetHistory: TargetVersion[] = [{ effectiveDate: todayInZone(settings.timezone) }];
    let finalType: HabitDefinition["type"] = "metric";

    if (habitCategory === "avoidance") {
      finalType = "avoidance";
      const max = maximum.trim() ? Number(maximum) : 0;
      if (!Number.isFinite(max) || max < 0) return new Notice("Enter a valid tolerance limit.");
      targetHistory = [{ effectiveDate: todayInZone(settings.timezone), max }];
    } else if (habitCategory === "tracker") {
      finalType = "tracker";
      targetHistory = [{ effectiveDate: todayInZone(settings.timezone) }];
    } else {
      finalType = isSessionHabit ? "session" : "metric";
      const min = Number(minimum);
      const max = maximum.trim() ? Number(maximum) : undefined;
      if (!Number.isFinite(min) || min < 0) return new Notice("Enter a valid minimum target.");
      if (max !== undefined && (!Number.isFinite(max) || max < min)) return new Notice("The maximum must be at least the minimum.");
      targetHistory = [{ effectiveDate: todayInZone(settings.timezone), min, ...(max !== undefined ? { max } : {}) }];
    }

    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) id = `${baseId}-${suffix++}`;
    const effectiveUnit = selectedUnitChoice === "custom" ? (customUnitValue || "count") : selectedUnitChoice;

    await store.addHabit({
      id,
      name: name.trim(),
      unit: effectiveUnit,
      cadence,
      enabled: true,
      type: finalType,
      displayFormat: presetDisplayFormat,
      targetHistory,
      ...(presetEndpoint ? { endpoint: presetEndpoint } : {})
    });

    new Notice(`Created “${name.trim()}”.`);
    await onCreated();
  };
}
