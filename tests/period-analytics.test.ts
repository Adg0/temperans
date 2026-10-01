import { describe, expect, it } from "vitest";
import { calculateHabitAnalytics } from "../src/analytics";
import { daysInYear } from "../src/date";
import { emptyDailyLog } from "../src/log-schema";
import type { HabitCadence, HabitDefinition } from "../src/types";

describe("period analytics aggregation", () => {
  it.each([
    ["monthly", 12, 2, 20, 2.5],
    ["quarterly", 4, 2, 20, 7.5],
    ["annual", 1, 1, 30, 30]
  ] as const)("keeps completed and empty %s periods in a leap year", (cadence, count, completed, best, average) => {
    const habit: HabitDefinition = {
      id: "goal", name: "Goal", unit: "count", cadence: cadence as HabitCadence, enabled: true,
      targetHistory: [{ effectiveDate: "2028-01-01", min: 10 }]
    };
    const logs = new Map([["2028-01-31", 10], ["2028-12-31", 20]].map(([date, value]) => {
      const log = emptyDailyLog(String(date));
      log.metrics.goal = Number(value);
      return [log.date, log];
    }));
    const stats = calculateHabitAnalytics(habit, daysInYear(2028), logs, "2029-01-01");
    expect(stats).toMatchObject({
      totalDays: 366, totalVolume: 30, totalPeriods: count, elapsedPeriods: count,
      completedPeriods: completed, completedElapsedPeriods: completed,
      bestPeriodValue: best, periodAverage: average, activePeriodInProgress: false,
      consistencyRate: Math.round(completed / count * 100) / 100
    });
  });
});
