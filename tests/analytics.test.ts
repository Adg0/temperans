import { describe, expect, it } from "vitest";
import { calculateHabitAnalytics } from "../src/analytics";
import { calculateGoalProgress, evaluateDailyLog, periodBounds } from "../src/evaluation";
import { DailyLog, HabitDefinition, HabitSettings } from "../src/types";

describe("generic habit analytics engine", () => {
  const dummyLog = (metrics: Record<string, number>, date: string): DailyLog => ({
    date,
    metrics,
    metricSources: {},
    metricNotes: {},
    sessions: {},
    typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
    reading: []
  });

  it("computes comprehensive analytics for a daily metric habit", () => {
    const habit: HabitDefinition = {
      id: "guitar",
      name: "Guitar",
      unit: "minutes",
      cadence: "daily",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 15 }]
    };

    const dates = ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25"];
    const logs = new Map<string, DailyLog>([
      ["2026-08-21", dummyLog({ guitar: 20 }, "2026-08-21")],
      ["2026-08-22", dummyLog({ guitar: 30 }, "2026-08-22")],
      ["2026-08-23", dummyLog({ guitar: 0 }, "2026-08-23")],
      ["2026-08-24", dummyLog({ guitar: 15 }, "2026-08-24")],
      ["2026-08-25", dummyLog({ guitar: 25 }, "2026-08-25")]
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-25");

    expect(stats.totalDays).toBe(5);
    expect(stats.activeDays).toBe(4);
    expect(stats.completedDays).toBe(4);
    expect(stats.missedDays).toBe(1);
    expect(stats.totalVolume).toBe(90); // 20 + 30 + 0 + 15 + 25
    expect(stats.averageAllDays).toBe(18); // 90 / 5
    expect(stats.averageActiveDays).toBe(22.5); // 90 / 4
    expect(stats.peakValue).toBe(30);
    expect(stats.peakDate).toBe("2026-08-22");
    expect(stats.currentStreak).toBe(2); // 24 and 25
    expect(stats.bestStreak).toBe(2);
    expect(stats.consistencyRate).toBe(0.8); // 4 / 5
  });

  it("computes session counts and session averages for session-based habits", () => {
    const habit: HabitDefinition = {
      id: "workouts",
      name: "Workouts",
      unit: "reps",
      cadence: "daily",
      enabled: true,
      type: "session",
      targetHistory: [{ effectiveDate: "2020-01-01", min: 50 }]
    };

    const dates = ["2026-08-24", "2026-08-25"];
    const log1 = dummyLog({}, "2026-08-24");
    log1.sessions = {
      workouts: [
        { title: "Set 1", reps: 30 },
        { title: "Set 2", reps: 30 }
      ]
    };
    const log2 = dummyLog({}, "2026-08-25");
    log2.sessions = {
      workouts: [
        { title: "Set 1", reps: 40 }
      ]
    };

    const logs = new Map([
      ["2026-08-24", log1],
      ["2026-08-25", log2]
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-25");

    expect(stats.totalVolume).toBe(100); // 60 + 40
    expect(stats.totalSessions).toBe(3);
    expect(stats.averagePerSession).toBeCloseTo(33.33, 1);
    expect(stats.completedDays).toBe(1); // Aug 24: 60 >= 50
  });

  it("handles weekly cadence habits and period completion", () => {
    const habit: HabitDefinition = {
      id: "pullups",
      name: "Pull-ups",
      unit: "reps",
      cadence: "weekly",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 100 }]
    };

    // Week of Mon Aug 17 to Sun Aug 23, 2026
    const dates = ["2026-08-17", "2026-08-18", "2026-08-19"];
    const logs = new Map([
      ["2026-08-17", dummyLog({ pullups: 50 }, "2026-08-17")],
      ["2026-08-18", dummyLog({ pullups: 60 }, "2026-08-18")]
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-19");
    expect(stats.totalVolume).toBe(110);
    expect(stats.totalPeriods).toBe(1);
    expect(stats.completedPeriods).toBe(1); // 110 >= 100
    expect(stats.bestPeriodValue).toBe(110);
    expect(stats.activePeriodInProgress).toBe(true);
    expect(stats.activePeriodCompleted).toBe(true);
  });

  it("differentiates elapsed periods from in-progress active periods without depressing consistency", () => {
    const habit: HabitDefinition = {
      id: "run",
      name: "Running",
      unit: "count",
      cadence: "weekly",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 3 }]
    };

    // Week 1 (elapsed): Mon Aug 10 to Sun Aug 16, 2026 -> 3 runs completed
    // Week 2 (in-progress): Mon Aug 17 to Sun Aug 23, 2026 (today is Tue Aug 18) -> 1 run so far
    const dates = [
      "2026-08-10", "2026-08-12", "2026-08-14",
      "2026-08-17", "2026-08-18"
    ];
    const logs = new Map([
      ["2026-08-10", dummyLog({ run: 1 }, "2026-08-10")],
      ["2026-08-12", dummyLog({ run: 1 }, "2026-08-12")],
      ["2026-08-14", dummyLog({ run: 1 }, "2026-08-14")],
      ["2026-08-17", dummyLog({ run: 1 }, "2026-08-17")]
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-18");
    expect(stats.totalPeriods).toBe(2);
    expect(stats.elapsedPeriods).toBe(1);
    expect(stats.completedElapsedPeriods).toBe(1);
    expect(stats.activePeriodInProgress).toBe(true);
    expect(stats.activePeriodCompleted).toBe(false);
    // Historical consistency rate is 100% (1/1 elapsed), not depressed to 50%
    expect(stats.consistencyRate).toBe(1.0);
  });

  it("calculates accurate boundaries for quarterly and annual cadences", () => {
    // Q1
    expect(periodBounds("2026-02-15", "quarterly")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-03-31"
    });
    // Q2
    expect(periodBounds("2026-05-01", "quarterly")).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-06-30"
    });
    // Q3
    expect(periodBounds("2026-08-25", "quarterly")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-09-30"
    });
    // Q4
    expect(periodBounds("2026-11-10", "quarterly")).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-12-31"
    });
    // Annual
    expect(periodBounds("2026-08-25", "annual")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31"
    });
  });

  it("computes quarterly habit periodic analytics accurately", () => {
    const habit: HabitDefinition = {
      id: "deep-review",
      name: "Quarterly Review",
      unit: "count",
      cadence: "quarterly",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 1 }]
    };

    const dates = ["2026-03-15", "2026-06-20", "2026-08-10"];
    const logs = new Map([
      ["2026-03-15", dummyLog({ "deep-review": 1 }, "2026-03-15")], // Q1: completed
      ["2026-06-20", dummyLog({ "deep-review": 1 }, "2026-06-20")], // Q2: completed
      ["2026-08-10", dummyLog({ "deep-review": 0 }, "2026-08-10")]  // Q3: in-progress
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-10");
    expect(stats.totalPeriods).toBe(3);
    expect(stats.elapsedPeriods).toBe(2);
    expect(stats.completedElapsedPeriods).toBe(2);
    expect(stats.activePeriodInProgress).toBe(true);
    expect(stats.activePeriodCompleted).toBe(false);
    expect(stats.consistencyRate).toBe(1.0);
  });

  it("calculates accurate goal progress for uncapped habits, bounded ranges, and ceiling deviations", () => {
    // 1. Uncapped habit (min only): allows > 100%
    const uncapped = { effectiveDate: "2026-01-01", min: 20 };
    expect(calculateGoalProgress(10, uncapped)).toEqual({ progress: 0.5, isOverCeiling: false, excess: 0 });
    expect(calculateGoalProgress(19, uncapped)).toEqual({ progress: 0.95, isOverCeiling: false, excess: 0 });
    expect(calculateGoalProgress(20, uncapped)).toEqual({ progress: 1.0, isOverCeiling: false, excess: 0 });
    expect(calculateGoalProgress(30, uncapped)).toEqual({ progress: 1.5, isOverCeiling: false, excess: 0 });

    // 2. Bounded habit with ceiling (e.g. calories: min 1800, max 2500)
    const bounded = { effectiveDate: "2026-01-01", min: 1800, max: 2500 };
    // Below minimum
    expect(calculateGoalProgress(1440, bounded)).toEqual({ progress: 0.8, isOverCeiling: false, excess: 0 });
    // Inside green zone
    expect(calculateGoalProgress(2000, bounded)).toEqual({ progress: 1.0, isOverCeiling: false, excess: 0 });
    expect(calculateGoalProgress(2500, bounded)).toEqual({ progress: 1.0, isOverCeiling: false, excess: 0 });
    // Overdoing ceiling: progress drops below 1.0 proportionally
    const overCeiling = calculateGoalProgress(3000, bounded);
    expect(overCeiling.isOverCeiling).toBe(true);
    expect(overCeiling.excess).toBe(500);
    expect(overCeiling.progress).toBe(0.8); // 1 - 500/2500 = 0.8

    // Grossly overdoing ceiling
    const extremeOverCeiling = calculateGoalProgress(5500, bounded);
    expect(extremeOverCeiling.isOverCeiling).toBe(true);
    expect(extremeOverCeiling.progress).toBe(0);

    // 3. Ceiling-only habit (e.g. screen time up to 120 mins)
    const ceilingOnly = { effectiveDate: "2026-01-01", max: 120 };
    expect(calculateGoalProgress(90, ceilingOnly)).toEqual({ progress: 1.0, isOverCeiling: false, excess: 0 });
    const screenOver = calculateGoalProgress(150, ceilingOnly);
    expect(screenOver.isOverCeiling).toBe(true);
    expect(screenOver.excess).toBe(30);
    expect(screenOver.progress).toBe(0.75); // 1 - 30/120 = 0.75
  });

  it("handles negative / avoidance habits (clean days = success, slips = penalty)", () => {
    const habit: HabitDefinition = {
      id: "no-junk",
      name: "No Junk Food",
      unit: "count",
      cadence: "daily",
      enabled: true,
      type: "avoidance",
      targetHistory: [{ effectiveDate: "2020-01-01", max: 0 }]
    };

    const dates = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];
    const logs = new Map([
      ["2026-08-20", dummyLog({}, "2026-08-20")],            // Clean (no log = 0)
      ["2026-08-21", dummyLog({ "no-junk": 0 }, "2026-08-21")], // Clean (explicit 0)
      ["2026-08-22", dummyLog({ "no-junk": 1 }, "2026-08-22")], // Slipped (1 slip)
      ["2026-08-23", dummyLog({}, "2026-08-23")]             // Clean (no log = 0)
    ]);

    const stats = calculateHabitAnalytics(habit, dates, logs, "2026-08-23");
    expect(stats.totalDays).toBe(4);
    expect(stats.completedDays).toBe(3); // 20, 21, 23 are clean
    expect(stats.missedDays).toBe(1);    // 22 slipped
    expect(stats.consistencyRate).toBe(0.75);
    expect(stats.currentStreak).toBe(1); // 23 is clean
    expect(stats.bestStreak).toBe(2);    // 20 and 21

    // Verify daily evaluation score
    const settings: HabitSettings = { timezone: "UTC", habits: [habit] };
    const cleanDayEval = evaluateDailyLog(dummyLog({}, "2026-08-20"), "2026-08-20", settings);
    expect(cleanDayEval.completed).toBe(1);
    expect(cleanDayEval.eligible).toBe(1);
    expect(cleanDayEval.score).toBe(1);

    const slippedDayEval = evaluateDailyLog(dummyLog({ "no-junk": 1 }, "2026-08-22"), "2026-08-22", settings);
    expect(slippedDayEval.completed).toBe(0);
    expect(slippedDayEval.eligible).toBe(1);
    expect(slippedDayEval.score).toBe(0);
  });

  it("handles zero-goal metric trackers (does not affect daily score or streaks)", () => {
    const tracker: HabitDefinition = {
      id: "weight",
      name: "Weight",
      unit: "kg",
      cadence: "daily",
      enabled: true,
      type: "tracker",
      targetHistory: [{ effectiveDate: "2020-01-01" }]
    };

    const reading: HabitDefinition = {
      id: "reading",
      name: "Reading",
      unit: "pages",
      cadence: "daily",
      enabled: true,
      targetHistory: [{ effectiveDate: "2020-01-01", min: 10 }]
    };

    const settings: HabitSettings = { timezone: "UTC", habits: [tracker, reading] };

    // Day where only weight is logged, reading is missing
    const dayLog = dummyLog({ weight: 75 }, "2026-08-25");
    const evalResult = evaluateDailyLog(dayLog, "2026-08-25", settings);

    // Tracker habit is not-applicable for eligible count, so eligible = 1 (reading only)
    expect(evalResult.eligible).toBe(1);
    expect(evalResult.completed).toBe(0);
    expect(evalResult.score).toBe(0);

    // Day where reading is completed, weight is NOT logged
    const dayLog2 = dummyLog({ reading: 15 }, "2026-08-26");
    const evalResult2 = evaluateDailyLog(dayLog2, "2026-08-26", settings);
    expect(evalResult2.eligible).toBe(1);
    expect(evalResult2.completed).toBe(1);
    // Score is 100%! Missing weight did NOT penalize the day
    expect(evalResult2.score).toBe(1);

    // Analytics for tracker habit
    const dates = ["2026-08-25", "2026-08-26"];
    const logs = new Map([
      ["2026-08-25", dayLog],
      ["2026-08-26", dayLog2]
    ]);
    const trackerStats = calculateHabitAnalytics(tracker, dates, logs, "2026-08-26");
    expect(trackerStats.totalDays).toBe(2);
    expect(trackerStats.activeDays).toBe(1);
    expect(trackerStats.totalVolume).toBe(75);
  });
});
