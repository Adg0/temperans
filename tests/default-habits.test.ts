import { expect, it } from "vitest";
import { DEFAULT_HABITS, HabitStore } from "../src/data";
import { memoryVault } from "./helpers/memory-vault";

it("creates a clean single starter for a new vault with target starting today", async () => {
  const f = memoryVault();
  const store = new HabitStore(f.app, "Habit Logs");
  const settings = await store.loadSettings();
  expect(settings.habits.map(h => [h.id, h.name])).toEqual([
    ["reading", "Reading"]
  ]);
  expect(DEFAULT_HABITS).toHaveLength(1);
  expect(settings.habits.every(h => h.enabled && !h.endpoint)).toBe(true);
  expect(settings.habits[0].targetHistory[0].effectiveDate).not.toBe("2000-01-01");
  expect(settings.habits[0].targetHistory[0].effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  store.invalidate(store.settingsPath);
  expect((await store.loadSettings()).habits.map(h => h.id)).toEqual(["reading"]);
});

it("preserves existing habits and legacy typing migration after shrinking the starters", async () => {
  const f = memoryVault();
  f.put("Habit Logs/Settings.md", "---\n" + JSON.stringify({ timezone: "UTC", habits: [
    { id: "sleep", name: "My sleep", enabled: false },
    { id: "typing", name: "My typing", enabled: true, unit: "tests", targetHistory: [{ effectiveDate: "2000-01-01", min: 1 }] }
  ] }) + "\n---\nPersonal settings body.\n");
  const store = new HabitStore(f.app, "Habit Logs");
  const settings = await store.loadSettings();
  expect(settings.habits.map(h => h.id)).toEqual(["sleep", "typing"]);
  expect(settings.habits[0]).toMatchObject({ name: "My sleep", enabled: false, unit: "minutes", targetHistory: [{ effectiveDate: "2000-01-01", min: 480 }] });
  expect(settings.habits[1]).toMatchObject({ name: "My typing", enabled: true, unit: "minutes", targetHistory: [{ effectiveDate: "2000-01-01", min: 15 }], endpoint: { sourceName: "monkeytype" } });
  expect(f.contents.get(store.settingsPath)).toContain("Personal settings body.");
});

it("does not repopulate an intentionally empty habit list", async () => {
  const f = memoryVault();
  f.put("Habit Logs/Settings.md", "---\n" + JSON.stringify({ timezone: "UTC", habits: [] }) + "\n---\n");
  expect((await new HabitStore(f.app, "Habit Logs").loadSettings()).habits).toEqual([]);
  expect(f.vault.process).not.toHaveBeenCalled();
});
