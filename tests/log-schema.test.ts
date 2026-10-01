import { describe, expect, it } from "vitest";
import { orderByIds } from "../src/habit-order";
import { DAILY_LOG_SCHEMA_VERSION, isUnifiedDailyLog, parseDailyLog, serializeDailyLog } from "../src/log-schema";

describe("daily-log schema", () => {
  const legacy = {
    temperans: "habit-log",
    date: "2026-08-20",
    metrics: { calories: 2200, guitar: 15, "custom-task": 4 },
    metricSources: { calories: "health-connect", guitar: "manual", "custom-task": "manual" },
    typing: {
      manualTests: 21,
      manualDurationSeconds: 930,
      imported: []
    },
    reading: [{ title: "The Odyssey", pages: 12, note: "Book 3" }],
    mood: "focused"
  };

  it("writes each habit as a uniform top-level map while preserving unrelated properties", () => {
    const normalized = parseDailyLog(legacy, "2026-08-20");
    const uniform = serializeDailyLog(normalized, legacy);

    expect(isUnifiedDailyLog(uniform)).toBe(true);
    expect(uniform).toMatchObject({
      temperans: "habit-log",
      temperans_schema: DAILY_LOG_SCHEMA_VERSION,
      date: "2026-08-20",
      calories: { value: 2200, source: "health-connect" },
      guitar: { value: 15, source: "manual" },
      "custom-task": { value: 4, source: "manual" },
      typing: { value: 930, value_unit: "seconds", tests: 21, source: "manual", imported: [] },
      reading: { sessions: legacy.reading, source: "manual" },
      mood: "focused"
    });
    expect(uniform).not.toHaveProperty("metrics");
    expect(uniform).not.toHaveProperty("metricSources");
    expect(uniform).not.toHaveProperty("temperans_meta");
    expect(parseDailyLog(uniform, "2026-08-20")).toEqual({ ...normalized,
      metrics: { ...normalized.metrics, typing: 16 },
      metricSources: { ...normalized.metricSources, typing: "manual", reading: "manual" }
    });
  });

  it("reads v2 flat logs and keeps Monkeytype result IDs inside typing", () => {
    const normalized = parseDailyLog({
      temperans: "habit-log",
      date: "2026-08-21",
      hydration: 1800,
      typing_duration_seconds: 0,
      typing_tests: 0,
      reading: [],
      temperans_meta: {
        schema_version: 2,
        sources: { hydration: "health-connect", typing: "monkeytype" },
        typing: { imported: [{ id: "test-1", timestamp: 1234, durationSeconds: 65 }] }
      }
    }, "2026-08-21");
    const once = serializeDailyLog(normalized, {});
    const twice = serializeDailyLog(parseDailyLog(once, "2026-08-21"), once);

    expect(once).toMatchObject({
      hydration: { value: 1800, source: "health-connect" },
      typing: { source: "monkeytype", imported: [{ id: "test-1", timestamp: 1234, durationSeconds: 65 }] }
    });
    expect(twice).toEqual(once);
  });

  it("keeps optional remarks beside their respective task entries", () => {
    const log = parseDailyLog({
      temperans: "habit-log",
      temperans_schema: 3,
      date: "2026-08-22",
      hydration: { value: 2100, source: "manual", note: "Finished after the gym" },
      typing: { value: 900, value_unit: "seconds", tests: 4, source: "manual", note: "Accuracy drills", imported: [] },
      reading: { sessions: [] }
    }, "2026-08-22");

    expect(log.metricNotes.hydration).toBe("Finished after the gym");
    expect(log.typing.note).toBe("Accuracy drills");
    expect(serializeDailyLog(log, {})).toMatchObject({
      hydration: { value: 2100, note: "Finished after the gym" },
      typing: { note: "Accuracy drills" }
    });
  });

  it("parses and serializes reading sessions with minutes, pages, and chapters", () => {
    const raw = {
      temperans: "habit-log",
      temperans_schema: 3,
      date: "2026-08-25",
      reading: {
        sessions: [
          { title: "Deep Work", pages: 20, minutes: 45, note: "Chapter 1" },
          { title: "Article", minutes: 15 }
        ],
        source: "manual"
      }
    };
    const log = parseDailyLog(raw, "2026-08-25");
    expect(log.reading).toEqual([
      { title: "Deep Work", pages: 20, minutes: 45, note: "Chapter 1" },
      { title: "Article", minutes: 15 }
    ]);
    const serialized = serializeDailyLog(log, raw);
    expect(serialized.reading).toEqual(raw.reading);
  });

  it("parses and serializes generic multi-session tasks", () => {
    const raw = {
      temperans: "habit-log",
      temperans_schema: 3,
      date: "2026-08-25",
      workouts: {
        sessions: [
          { title: "Push day", reps: 80, minutes: 45, note: "Felt strong" },
          { title: "Core", reps: 40, minutes: 15 }
        ],
        source: "manual"
      }
    };
    const log = parseDailyLog(raw, "2026-08-25");
    expect(log.sessions.workouts).toEqual([
      { title: "Push day", reps: 80, minutes: 45, note: "Felt strong" },
      { title: "Core", reps: 40, minutes: 15 }
    ]);
    const serialized = serializeDailyLog(log, raw);
    expect(serialized.workouts).toEqual(raw.workouts);
  });

  it("preserves source: endpoint on typing when parsed and serialized", () => {
    const raw = {
      temperans: "habit-log",
      temperans_schema: 3,
      date: "2026-08-25",
      typing: {
        value: 900,
        value_unit: "seconds",
        tests: 0,
        source: "endpoint",
        imported: []
      }
    };
    const log = parseDailyLog(raw, "2026-08-25");
    expect(log.metricSources.typing).toBe("endpoint");
    const serialized = serializeDailyLog(log, raw);
    expect(serialized.typing).toMatchObject({
      value: 900,
      source: "endpoint"
    });
  });

  it("preserves custom sourceName labels across habits when parsed and serialized", () => {
    const raw = {
      temperans: "habit-log",
      temperans_schema: 3,
      date: "2026-08-25",
      coding: {
        value: 60,
        source: "wakatime"
      },
      typing: {
        value: 930,
        value_unit: "seconds",
        tests: 21,
        source: "monkeytype",
        imported: [{ id: "t1", timestamp: 12345, durationSeconds: 60 }]
      }
    };
    const log = parseDailyLog(raw, "2026-08-25");
    expect(log.metricSources.coding).toBe("wakatime");
    expect(log.metricSources.typing).toBe("monkeytype");
    const serialized = serializeDailyLog(log, raw);
    expect(serialized.coding).toMatchObject({
      value: 60,
      source: "wakatime"
    });
    expect(serialized.typing).toMatchObject({
      value: 930,
      source: "monkeytype"
    });
  });
});

describe("task ordering", () => {
  it("uses the chosen IDs as the authoritative full ordering", () => {
    const tasks = [{ id: "typing" }, { id: "hydration" }, { id: "guitar" }];
    expect(orderByIds(tasks, ["guitar", "typing", "hydration"])).toEqual([
      { id: "guitar" }, { id: "typing" }, { id: "hydration" }
    ]);
  });

  it("rejects a stale or incomplete ordering request", () => {
    expect(() => orderByIds([{ id: "typing" }, { id: "hydration" }], ["typing"])).toThrow("task order");
  });
});
