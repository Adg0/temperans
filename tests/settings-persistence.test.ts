import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "./helpers/obsidian-ui";
import { HabitStore } from "../src/data";
import type { HabitDefinition } from "../src/types";

const habit = (id: string): HabitDefinition => ({
  id, name: id, unit: "count", cadence: "daily", enabled: true, targetHistory: [{ effectiveDate: "2026-01-01", min: 1 }]
});

function fixture() {
  const file = new TFile("Habit Logs/Settings.md");
  const body = "\n# Personal settings\nKeep this note and its links.\n";
  let contents = `---\n${JSON.stringify({ temperans: "settings", timezone: "UTC", custom: { keep: true }, habits: [habit("a"), habit("b")] })}\n---\n${body}`;
  const vault = {
    getAbstractFileByPath: () => file,
    read: async () => contents,
    process: vi.fn(async (_file: TFile, update: (text: string) => string) => { contents = update(contents); return contents; }),
    modify: vi.fn(async (_file: TFile, value: string) => { contents = value; })
  };
  return { store: new HabitStore({ vault } as unknown as App, "Habit Logs"), vault, body,
    contents: () => contents, frontmatter: () => JSON.parse(contents.split("---\n")[1]) };
}

describe("shared settings persistence", () => {
  it("preserves unrelated frontmatter and note body across add, edit, reorder and delete", async () => {
    const f = fixture();
    await f.store.loadSettings(); // Populate cache before the first write.
    await f.store.addHabit(habit("c"));
    expect((await f.store.loadSettings()).habits.map(h => h.id)).toEqual(["a", "b", "c"]);
    await f.store.updateHabit({ ...habit("b"), name: "Updated", enabled: false });
    expect((await f.store.loadSettings()).habits[1]).toMatchObject({ name: "Updated", enabled: false });
    await f.store.reorderHabits(["c", "a", "b"]);
    expect((await f.store.loadSettings()).habits.map(h => h.id)).toEqual(["c", "a", "b"]);
    await f.store.deleteHabit("a");
    expect((await f.store.loadSettings()).habits.map(h => h.id)).toEqual(["c", "b"]);
    expect(f.frontmatter()).toMatchObject({ custom: { keep: true }, timezone: "UTC", temperans: "settings" });
    expect(f.contents().endsWith(f.body)).toBe(true);
    expect(f.vault.process.mock.calls.every(([file]) => file.path === "Habit Logs/Settings.md")).toBe(true);
  });

  it("keeps invalid or absent habit operations from writing files", async () => {
    const f = fixture();
    await expect(f.store.addHabit(habit("a"))).rejects.toThrow("already exists");
    await expect(f.store.addHabit(habit("date"))).rejects.toThrow("reserved");
    await expect(f.store.updateHabit(habit("absent"))).rejects.toThrow("not found");
    await f.store.deleteHabit("absent");
    expect(f.vault.modify).not.toHaveBeenCalled();
  });
});

it("round-trips per-habit logging customizations through settings mutations", async () => {
  const f = fixture();
  const custom = { ...habit("practice"), logging: { remark: { placeholder: "What improved?" }, quickEntry: { values: [10, "0:30"], mode: "add" as const, showClear: false } } };
  await f.store.addHabit(custom);
  await f.store.addHabit({ ...habit("quiet"), logging: { quickEntry: false } });
  const loaded = (await f.store.loadSettings()).habits.find(h => h.id === "practice")!;
  expect(loaded.logging).toEqual(custom.logging);
  await f.store.updateHabit({ ...loaded, name: "Focused practice" });
  await f.store.reorderHabits(["quiet", "practice", "a", "b"]);
  await f.store.deleteHabit("b");
  const habits = (await f.store.loadSettings()).habits;
  expect(habits[0].logging).toEqual({ quickEntry: false });
  expect(habits[1]).toMatchObject({ name: "Focused practice", logging: custom.logging });
  expect(habits[2].logging).toBeUndefined();
  expect(f.frontmatter().habits[1].logging).toEqual(custom.logging);
});
