import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysInMonth, daysInYear, formatMonthYear, monthLongName, monthShortName, weekdayIndexMonday } from "../src/date";
import { bestDailyStreak, calculateDailyStreak, evaluateDailyLog, evaluatePeriodGoal, hasTypingData, mergeImportedResults, periodBounds, typingDurationSeconds, valueForHabit } from "../src/evaluation";
import { formatSleepDuration, formatTypingDuration, parseSleepDuration, parseTypingDuration, sleepInputValue, typingInputValue } from "../src/durations";
import { normalizeHealthConnectRecord, validateHealthConnectStagingDocument } from "../src/integrations/health-connect-schema";
import { decideHealthConnectWrite } from "../src/integrations/health-connect-ownership";
import { DailyLog, HabitDefinition, HabitSettings } from "../src/types";

describe("date helpers", () => {
  it("keeps leap days in the yearly grid", () => {
    const dates = daysInYear(2028);
    expect(dates).toHaveLength(366);
    expect(dates).toContain("2028-02-29");
  });

  it("moves safely across a year boundary", () => {
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("uses Monday as the first grid row", () => {
    expect(weekdayIndexMonday("2024-01-01")).toBe(0);
  });

  it("lists calendar days for a leap February", () => {
    expect(daysInMonth(2028, 2)).toHaveLength(29);
    expect(daysInMonth(2028, 2)[0]).toBe("2028-02-01");
    expect(daysInMonth(2028, 2).at(-1)).toBe("2028-02-29");
  });

  it("formats a month heading without shifting the calendar month", () => {
    expect(formatMonthYear(2026, 8)).toMatch(/2026/);
    expect(monthShortName(1)).toBeTruthy();
    expect(monthLongName(8)).toBe("August");
    expect(monthLongName(9)).toBe("September");
  });
});

describe("habit evaluation", () => {
  const log = (metrics: DailyLog["metrics"]): DailyLog => ({
    date: "2026-08-18",
    metrics,
    metricSources: {},
    metricNotes: {},
    sessions: {},
    typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
    reading: []
  });

  it("preserves a historic target after the current target changes", () => {
    const hydration: HabitDefinition = {
      id: "hydration", name: "Hydration", unit: "ml", cadence: "daily", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 1000 }, { effectiveDate: "2026-01-01", min: 2000 }]
    };
    const settings: HabitSettings = { timezone: "America/New_York", habits: [hydration] };
    expect(evaluateDailyLog(log({ hydration: 1500 }), "2025-12-31", settings).score).toBe(1);
    expect(evaluateDailyLog(log({ hydration: 1500 }), "2026-08-18", settings).score).toBe(0);
  });

  it("evaluates calories against an inclusive range", () => {
    const calories: HabitDefinition = {
      id: "calories", name: "Calories", unit: "kcal", cadence: "daily", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 1800, max: 2500 }]
    };
    const settings: HabitSettings = { timezone: "America/New_York", habits: [calories] };
    expect(evaluateDailyLog(log({ calories: 1800 }), "2026-08-18", settings).score).toBe(1);
    expect(evaluateDailyLog(log({ calories: 2700 }), "2026-08-18", settings).score).toBe(0);
  });

  it("does not duplicate overlapping Monkeytype results", () => {
    const existing = [{ id: "one", timestamp: 1, durationSeconds: 30, wpm: 65, accuracy: 97 }];
    const incoming = [...existing, { id: "two", timestamp: 2, durationSeconds: 60, wpm: 70, accuracy: 98 }];
    expect(mergeImportedResults(existing, incoming).map((result) => result.id)).toEqual(["one", "two"]);
  });

  it("tracks weekly goals separately from daily consistency", () => {
    const pullups: HabitDefinition = {
      id: "pullups", name: "Pull-ups", unit: "reps", cadence: "weekly", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 500 }]
    };
    const settings: HabitSettings = { timezone: "America/New_York", habits: [pullups] };
    const logs = new Map<string, DailyLog>([
      ["2026-08-17", log({ pullups: 60 })],
      ["2026-08-18", log({ pullups: 120 })]
    ]);
    const weekly = evaluatePeriodGoal(pullups, "2026-08-18", logs);
    expect(weekly.value).toBe(180);
    expect(weekly.progress).toBeCloseTo(0.36);
    expect(weekly.startDate).toBe("2026-08-17");
    expect(evaluateDailyLog(log({ pullups: 60 }), "2026-08-17", settings).score).toBeNull();
  });

  it("uses calendar months for monthly goals", () => {
    expect(periodBounds("2028-02-14", "monthly")).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });

  it("uses manual typing duration when no Monkeytype results exist", () => {
    const manual = log({});
    manual.typing.manualDurationSeconds = 15 * 60 + 30;
    expect(typingDurationSeconds(manual)).toBe(930);
  });

  it("lets a Monkeytype sync replace the effective manual typing duration", () => {
    const synced = log({});
    synced.typing.manualDurationSeconds = 15 * 60;
    synced.typing.imported = [{ id: "result-1", timestamp: 1, durationSeconds: 95 }];
    expect(typingDurationSeconds(synced)).toBe(95);
  });

  it("recognises any manual or imported typing entry as existing data", () => {
    const empty = log({});
    expect(hasTypingData(empty)).toBe(false);
    empty.typing.manualTests = 2;
    expect(hasTypingData(empty)).toBe(true);
    empty.typing.manualTests = 0;
    empty.typing.imported = [{ id: "result-1", timestamp: 1, durationSeconds: 60 }];
    expect(hasTypingData(empty)).toBe(true);
  });

  it("calculates active streak including today when today is completed", () => {
    const scores = new Map([
      ["2026-08-25", 1],
      ["2026-08-24", 1],
      ["2026-08-23", 1],
      ["2026-08-22", 0]
    ]);
    const mockEval = (d: string) => scores.has(d) ? { date: d, habits: [], eligible: 1, completed: scores.get(d)!, score: scores.get(d)! } : undefined;
    const result = calculateDailyStreak("2026-08-25", mockEval);
    expect(result.streak).toBe(3);
    expect(result.coversToday).toBe(true);
  });

  it("preserves active streak from yesterday when today is in progress", () => {
    const scores = new Map([
      ["2026-08-25", 0.3], // today in progress
      ["2026-08-24", 1],
      ["2026-08-23", 1],
      ["2026-08-22", 1],
      ["2026-08-21", 0.5]
    ]);
    const mockEval = (d: string) => scores.has(d) ? { date: d, habits: [], eligible: 1, completed: 1, score: scores.get(d)! } : undefined;
    const result = calculateDailyStreak("2026-08-25", mockEval);
    expect(result.streak).toBe(3);
    expect(result.coversToday).toBe(false);
  });

  it("returns zero streak when yesterday was missed and today is incomplete", () => {
    const scores = new Map([
      ["2026-08-25", 0], // today in progress
      ["2026-08-24", 0.5], // missed yesterday
      ["2026-08-23", 1]
    ]);
    const mockEval = (d: string) => scores.has(d) ? { date: d, habits: [], eligible: 1, completed: 1, score: scores.get(d)! } : undefined;
    const result = calculateDailyStreak("2026-08-25", mockEval);
    expect(result.streak).toBe(0);
    expect(result.coversToday).toBe(false);
  });

  it("calculates active streak crossing safely across a year boundary", () => {
    const scores = new Map([
      ["2026-01-02", 1],
      ["2026-01-01", 1],
      ["2025-12-31", 1],
      ["2025-12-30", 1],
      ["2025-12-29", 0]
    ]);
    const mockEval = (d: string) => scores.has(d) ? { date: d, habits: [], eligible: 1, completed: 1, score: scores.get(d)! } : undefined;
    const result = calculateDailyStreak("2026-01-02", mockEval);
    expect(result.streak).toBe(4);
    expect(result.coversToday).toBe(true);
  });

  it("computes the best daily streak across a sequence of dates", () => {
    const scores = new Map([
      ["2026-08-01", 1],
      ["2026-08-02", 1],
      ["2026-08-03", 0],
      ["2026-08-04", 1],
      ["2026-08-05", 1],
      ["2026-08-06", 1],
      ["2026-08-07", 1],
      ["2026-08-08", 0.5],
      ["2026-08-09", 1]
    ]);
    const dates = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
    const mockEval = (d: string) => scores.has(d) ? { date: d, habits: [], eligible: 1, completed: 1, score: scores.get(d)! } : undefined;
    expect(bestDailyStreak(dates, mockEval)).toBe(4);
  });

  it("evaluates reading habit correctly for pages, chapters, and minutes", () => {
    const readingPages: HabitDefinition = {
      id: "reading", name: "Reading", unit: "pages", cadence: "daily", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 20 }]
    };
    const readingMinutes: HabitDefinition = {
      id: "reading", name: "Reading", unit: "minutes", cadence: "daily", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 30 }]
    };
    const readingChapters: HabitDefinition = {
      id: "reading", name: "Reading", unit: "chapters", cadence: "daily", enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 2 }]
    };
    const dailyLog: DailyLog = {
      date: "2026-08-25",
      metrics: {},
      metricSources: {},
      metricNotes: {},
      sessions: {},
      typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
      reading: [
        { title: "Book A", pages: 15, minutes: 20, chapters: 1 },
        { title: "Book B", pages: 10, minutes: 15, chapters: 1 }
      ]
    };
    expect(valueForHabit(dailyLog, readingPages)).toBe(25);
    expect(valueForHabit(dailyLog, readingMinutes)).toBe(35);
    expect(valueForHabit(dailyLog, readingChapters)).toBe(2);

    const settingsPages: HabitSettings = { timezone: "UTC", habits: [readingPages] };
    const settingsMinutes: HabitSettings = { timezone: "UTC", habits: [readingMinutes] };
    const settingsChapters: HabitSettings = { timezone: "UTC", habits: [readingChapters] };

    expect(evaluateDailyLog(dailyLog, "2026-08-25", settingsPages).score).toBe(1);
    expect(evaluateDailyLog(dailyLog, "2026-08-25", settingsMinutes).score).toBe(1);
    expect(evaluateDailyLog(dailyLog, "2026-08-25", settingsChapters).score).toBe(1);
  });

  it("evaluates custom session-based habits dynamically", () => {
    const workouts: HabitDefinition = {
      id: "workouts", name: "Workouts", unit: "reps", cadence: "daily", enabled: true,
      type: "session",
      targetHistory: [{ effectiveDate: "2020-01-01", min: 100 }]
    };
    const logWithWorkouts: DailyLog = {
      date: "2026-08-25",
      metrics: {},
      metricSources: {},
      metricNotes: {},
      sessions: {
        workouts: [
          { title: "Set 1", reps: 60, minutes: 20 },
          { title: "Set 2", reps: 50, minutes: 20 }
        ]
      },
      typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
      reading: []
    };
    expect(valueForHabit(logWithWorkouts, workouts)).toBe(110);
    const settings: HabitSettings = { timezone: "UTC", habits: [workouts] };
    expect(evaluateDailyLog(logWithWorkouts, "2026-08-25", settings).score).toBe(1);
  });
});

describe("readable duration entry", () => {
  it("parses sleep as hours and minutes", () => {
    expect(parseSleepDuration("7:30")).toBe(450);
    expect(parseSleepDuration("8")).toBe(480);
    expect(parseSleepDuration("7:60")).toBeNull();
    expect(sleepInputValue(450)).toBe("7:30");
    expect(formatSleepDuration(480)).toBe("8 hrs");
    expect(formatSleepDuration(450)).toBe("7 hrs 30 min");
  });

  it("parses typing as minutes and seconds", () => {
    expect(parseTypingDuration("14:24")).toBe(864);
    expect(parseTypingDuration("15")).toBe(900);
    expect(parseTypingDuration("14:60")).toBeNull();
    expect(typingInputValue(864)).toBe("14:24");
    expect(formatTypingDuration(864)).toBe("14 min 24 sec");
  });
});

describe("integration foundations", () => {
  it("normalizes Health Connect units to existing daily-log metrics", () => {
    expect(normalizeHealthConnectRecord({
      date: "2026-08-21",
      calories: { value: 2200, unit: "kcal" },
      hydration: { value: 1800, unit: "ml" },
      sleep: { value: 450, unit: "minutes" },
      pullups: { value: 30, unit: "reps" }
    })).toEqual({
      source: "health-connect",
      date: "2026-08-21",
      metrics: { calories: 2200, hydration: 1800, sleep: 450, pullups: 30 }
    });
  });

  it("normalizes and validates open-ended custom Health Connect metrics", () => {
    const customRecord = {
      date: "2026-08-21",
      steps: { value: 10450, unit: "count" },
      active_minutes: { value: 45, unit: "minutes" },
      calories: { value: 2100, unit: "kcal" }
    };
    expect(normalizeHealthConnectRecord(customRecord)).toEqual({
      source: "health-connect",
      date: "2026-08-21",
      metrics: { steps: 10450, active_minutes: 45, calories: 2100 }
    });

    const doc = {
      schemaVersion: 1,
      integration: "health-connect",
      generatedAt: "2026-08-23T08:30:00.000Z",
      timezone: "America/New_York",
      sources: ["com.google.android.apps.healthdata"],
      records: [customRecord]
    };
    expect(validateHealthConnectStagingDocument(doc, "America/New_York", "2026-08-23").ok).toBe(true);
  });

  it("accepts a valid, selected-source Health Connect seven-day staging export", () => {
    const result = validateHealthConnectStagingDocument({
      schemaVersion: 1,
      integration: "health-connect",
      generatedAt: "2026-08-23T08:30:00.000Z",
      timezone: "America/New_York",
      sources: ["com.sec.android.app.shealth"],
      records: [{ date: "2026-08-17", calories: { value: 2200, unit: "kcal" }, sleep: { value: 450, unit: "minutes" } }]
    }, "America/New_York", "2026-08-23");
    expect(result.ok).toBe(true);
  });

  it("rejects wrong units, duplicate sources, time zones, and dates outside the past seven days", () => {
    const base = {
      schemaVersion: 1,
      integration: "health-connect",
      generatedAt: "2026-08-23T08:30:00.000Z",
      timezone: "America/New_York",
      sources: ["com.sec.android.app.shealth"],
      records: [{ date: "2026-08-23", hydration: { value: 1800, unit: "ml" } }]
    };
    expect(validateHealthConnectStagingDocument({ ...base, timezone: "UTC" }, "America/New_York", "2026-08-23").ok).toBe(false);
    expect(validateHealthConnectStagingDocument({ ...base, sources: [...base.sources, base.sources[0]] }, "America/New_York", "2026-08-23").ok).toBe(false);
    expect(validateHealthConnectStagingDocument({ ...base, records: [{ date: "2026-08-23", hydration: { value: 1800, unit: "kcal" } }] }, "America/New_York", "2026-08-23").ok).toBe(false);
    expect(validateHealthConnectStagingDocument({ ...base, records: [{ date: "2026-08-16", hydration: { value: 1800, unit: "ml" } }] }, "America/New_York", "2026-08-23").ok).toBe(false);
  });

  it("creates missing values, refreshes Health Connect values, and protects other owners", () => {
    expect(decideHealthConnectWrite(undefined, undefined, 1800)).toBe("import");
    expect(decideHealthConnectWrite(1500, "health-connect", 1800)).toBe("update");
    expect(decideHealthConnectWrite(1800, "health-connect", 1800)).toBe("skip");
    expect(decideHealthConnectWrite(1800, "manual", 2000)).toBe("protect");
    expect(decideHealthConnectWrite(1800, "monkeytype", 2000)).toBe("protect");
    expect(decideHealthConnectWrite(10, "companion", 26, "companion")).toBe("update");
    expect(decideHealthConnectWrite(26, "companion", 26, "companion")).toBe("skip");
    expect(decideHealthConnectWrite(26, "manual", 30, "companion")).toBe("protect");
  });

  it("normalizes companion staging records with custom sources and sessions", () => {
    const companionRecord = {
      date: "2026-09-20",
      pullups: {
        value: 26,
        unit: "reps",
        source: "companion",
        sessions: [
          { value: 6, note: "muscle-up" },
          { value: 10, note: "weighted" },
          { value: 10, note: "" }
        ]
      },
      guitar: {
        value: 21.14,
        unit: "minutes",
        source: "companion",
        sessions: [
          { value: 10, note: "arppegio practice" },
          { value: 11.14, note: "Strumming" }
        ]
      },
      calories: {
        value: 2228,
        unit: "kcal",
        source: "health-connect"
      }
    };

    const habits: HabitDefinition[] = [
      { id: "pullups", name: "Pull-ups", unit: "reps", cadence: "daily", enabled: true, targetHistory: [] },
      { id: "guitar", name: "Guitar", unit: "minutes", cadence: "daily", enabled: true, targetHistory: [] },
      { id: "calories", name: "Calories", unit: "kcal", cadence: "daily", enabled: true, targetHistory: [] }
    ];

    const normalized = normalizeHealthConnectRecord(companionRecord, habits);
    expect(normalized.date).toBe("2026-09-20");
    expect(normalized.metrics).toEqual({ pullups: 26, guitar: 21.14, calories: 2228 });
    expect(normalized.metricSources).toEqual({
      pullups: "companion",
      guitar: "companion",
      calories: "health-connect"
    });
    expect(normalized.sessions?.pullups).toHaveLength(3);
    expect(normalized.sessions?.pullups[0]).toEqual({ title: "muscle-up", reps: 6 });
    expect(normalized.sessions?.pullups[1]).toEqual({ title: "weighted", reps: 10 });
    expect(normalized.sessions?.pullups[2]).toEqual({ title: "Pull-ups session", reps: 10 });

    expect(normalized.sessions?.guitar).toHaveLength(2);
    expect(normalized.sessions?.guitar[0]).toEqual({ title: "arppegio practice", minutes: 10 });
    expect(normalized.sessions?.guitar[1]).toEqual({ title: "Strumming", minutes: 11.14 });
  });

  it("validates full companion export JSON with Africa/Addis_Ababa timezone", () => {
    const doc = {
      schemaVersion: 1,
      integration: "health-connect",
      generatedAt: "2026-09-20T14:00:07.506Z",
      timezone: "Africa/Addis_Ababa",
      sources: ["all-health-connect-origins", "com.sec.android.app.shealth", "temperans-companion"],
      records: [
        { date: "2026-09-14", calories: { value: 2012, unit: "kcal", source: "health-connect" } },
        { date: "2026-09-15", calories: { value: 2117, unit: "kcal", source: "health-connect" } },
        { date: "2026-09-16", calories: { value: 2067, unit: "kcal", source: "health-connect" } },
        { date: "2026-09-17", calories: { value: 2184, unit: "kcal", source: "health-connect" } },
        { date: "2026-09-18", calories: { value: 2222, unit: "kcal", source: "health-connect" } },
        { date: "2026-09-19", calories: { value: 2228, unit: "kcal", source: "health-connect" } },
        {
          date: "2026-09-20",
          pullups: {
            value: 26,
            unit: "reps",
            source: "companion",
            sessions: [{ value: 6, note: "muscle-up" }]
          }
        }
      ]
    };
    expect(validateHealthConnectStagingDocument(doc, "Africa/Addis_Ababa", "2026-09-20").ok).toBe(true);
  });
});
