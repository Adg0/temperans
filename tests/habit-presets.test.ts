import { expect, it, vi } from "vitest";
import { HABIT_PRESETS } from "../src/habit-presets";
import { renderBrowsePresets } from "../src/habit-presets-panel";
import { DEFAULT_HABITS, HabitStore } from "../src/data";
import { Element } from "./helpers/obsidian-ui";

it("starts with exactly one clean starter habit (Reading)", () => {
  expect(DEFAULT_HABITS).toHaveLength(1);
  expect(DEFAULT_HABITS[0].id).toBe("reading");
  expect(DEFAULT_HABITS[0].name).toBe("Reading");
  expect(DEFAULT_HABITS[0].unit).toBe("pages");
  expect(DEFAULT_HABITS[0].enabled).toBe(true);
});

it("provides categorized presets for Health Connect and Connected APIs", () => {
  const healthConnect = HABIT_PRESETS.filter(p => p.category === "health-connect");
  const connectedApis = HABIT_PRESETS.filter(p => p.category === "connected-apis");

  expect(healthConnect.length).toBeGreaterThanOrEqual(4);
  expect(connectedApis.length).toBeGreaterThanOrEqual(3);

  const healthIds = healthConnect.map(p => p.id);
  expect(healthIds).toContain("sleep");
  expect(healthIds).toContain("hydration");
  expect(healthIds).toContain("steps");
  expect(healthIds).toContain("calories");

  const apiIds = connectedApis.map(p => p.id);
  expect(apiIds).toContain("typing");
  expect(apiIds).toContain("duolingo");
  expect(apiIds).toContain("github");

  // Every preset must have required properties and sentence-case labels
  for (const preset of HABIT_PRESETS) {
    expect(preset.id).toMatch(/^[a-z0-9-]+$/);
    expect(preset.name.length).toBeGreaterThan(0);
    expect(preset.unit.length).toBeGreaterThan(0);
    expect(preset.description.length).toBeGreaterThan(0);
    expect(preset.icon.length).toBeGreaterThan(0);
  }
});

it("renders categorized presets and handles add/customize actions", async () => {
  const store = {
    loadSettings: vi.fn().mockResolvedValue({ timezone: "UTC", habits: [{ id: "reading", name: "Reading", unit: "pages", cadence: "daily", enabled: true, targetHistory: [] }] }),
    addHabit: vi.fn().mockResolvedValue(undefined)
  };
  const root = new Element();
  const onAdded = vi.fn().mockResolvedValue(undefined);
  const onCustomize = vi.fn();

  await renderBrowsePresets(root.element(), store as unknown as HabitStore, { onAdded, onCustomize });

  const headers = root.all().filter(n => n.tag === "h3").map(n => n.textContent);
  expect(headers).toContain("Health Connect");
  expect(headers).toContain("Connected APIs");

  // Find Sleep preset card and click Add
  const addButtons = root.all().filter(n => n.tag === "button" && n.textContent === "Add");
  expect(addButtons.length).toBeGreaterThanOrEqual(5);

  await addButtons[0].onclick!();
  expect(store.addHabit).toHaveBeenCalledOnce();
  expect(onAdded).toHaveBeenCalledOnce();

  // Find customize button
  const customizeButtons = root.all().filter(n => n.tag === "button" && n.textContent === "Customize");
  expect(customizeButtons.length).toBeGreaterThanOrEqual(1);

  customizeButtons[0].onclick!();
  expect(onCustomize).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }));
});
