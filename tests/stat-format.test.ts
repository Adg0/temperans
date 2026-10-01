import { expect, it } from "vitest";
import { formatStatValue, formatValue } from "../src/dashboard/format";
import type { HabitDefinition } from "../src/types";
it.each([
  [100000, "ml", "100 L"], [999, "ml", "999 ml"], [1000, "ml", "1 L"],
  [300, "minutes", "5 h"], [1000, "hours", "41.7 days"], [90, "seconds", "1.5 min"],
  [24, "hours", "1 day"], [1500, "reps", "1.5k reps"], [2000000, "steps", "2mn steps"],
  [1000000000, "points", "1bn points"], [0, "minutes", "0 min"], [12.5, "pages", "12.5 pages"]
])("formats %s %s as %s", (value, unit, expected) => {
  expect(formatStatValue(value as number, unit as string)).toBe(expected);
});
it("respects legacy duration storage and leaves goal formatting unchanged", () => {
  const habit = { id: "sleep", unit: "hours", displayFormat: "duration" } as HabitDefinition;
  expect(formatStatValue(300, habit.unit, habit)).toBe("5 h");
  expect(formatValue(100000, "ml")).toBe("100000 ml");
});
