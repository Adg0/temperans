import { describe, expect, it } from "vitest";
import { parseHabitAmount, parseSleepDuration, parseTimeValue, parseTypingDuration } from "../src/durations";
import { parseLoggingConfig } from "../src/logging-config";
import { valueForHabit } from "../src/evaluation";
import { emptyDailyLog } from "../src/log-schema";
import type { HabitDefinition } from "../src/types";

describe("flexible time entry", () => {
  it.each([
    ["90", "minutes", 90], ["1:30", "minutes", 90], ["1h 30m", "minutes", 90],
    ["1.5 hours", "minutes", 90], ["30s", "minutes", 0.5], ["90m", "hours", 1.5],
    ["1:30", "hours", 1.5], ["1.5", "hours", 1.5], ["2m 15s", "seconds", 135],
    [" 0:00 ", "minutes", 0], ["1 HR 30 MIN", "minutes", 90]
  ])("parses %s in %s", (input, unit, expected) => {
    expect(parseTimeValue(String(input), String(unit))).toBe(expected);
  });
  it.each(["", "-1", "1:60", "1:3", "1h junk", "NaN", "Infinity", "1h -2m", "1.2.3h"])("rejects invalid duration %s", input => {
    expect(parseTimeValue(input)).toBeNull();
  });
  it("preserves existing sleep and typing conventions and ordinary units", () => {
    expect(parseSleepDuration("8")).toBe(480);
    expect(parseSleepDuration("450m")).toBe(450);
    expect(parseTypingDuration("14:24")).toBe(864);
    expect(parseTypingDuration("14m 24s")).toBe(864);
    expect(parseHabitAmount("1:30", { unit: "pages" })).toBeNull();
    expect(parseHabitAmount("12.5", { unit: "pages" })).toBe(12.5);
    expect(Number.isFinite(parseTimeValue("1" + "0".repeat(290)))).toBe(true);
  });
  it("evaluates time sessions in their configured unit and preserves old count entries", () => {
    const log = emptyDailyLog("2026-09-26");
    const habit: HabitDefinition = { id: "practice", name: "Practice", unit: "hours", type: "session", cadence: "daily", enabled: true, targetHistory: [] };
    log.sessions = { practice: [{ title: "Practice", minutes: 90 }, { title: "Legacy", count: 2 }] };
    expect(valueForHabit(log, habit)).toBe(3.5);
    expect(valueForHabit(log, { ...habit, unit: "seconds" })).toBe(5402);
  });
});

describe("YAML logging configuration", () => {
  it("preserves optional field text, empty placeholders, and disabled quick entry", () => {
    const config = { amount: { label: "Practice", description: "" }, remark: { placeholder: "" }, title: { label: "Book" }, quickEntry: false };
    expect(parseLoggingConfig(config)).toEqual(config);
  });
  it("filters malformed options without discarding valid choices", () => {
    expect(parseLoggingConfig({ amount: [], remark: { label: 5, placeholder: "How was it?" }, quickEntry: {
      values: [10, "0:30", null, -1, Infinity, "", {}], mode: "set", showClear: false
    } })).toEqual({ remark: { placeholder: "How was it?" }, quickEntry: { values: [10, "0:30"], mode: "set", showClear: false } });
    expect(parseLoggingConfig({ quickEntry: { values: [], showClear: false } })).toEqual({ quickEntry: { values: [], showClear: false } });
    for (const value of [null, [], false, "text", { unknown: true }, { quickEntry: { mode: "bad" } }]) expect(parseLoggingConfig(value)).toBeUndefined();
  });
});
