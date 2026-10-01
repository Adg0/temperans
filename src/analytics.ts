import { emptyDailyLog } from "./log-schema";
import { addDays } from "./date";
import { evaluatePeriodGoal, periodBounds, targetForDate, valueForHabit } from "./evaluation";
import { DailyLog, HabitDefinition, TargetVersion } from "./types";

export interface HabitAnalytics {
  habit: HabitDefinition;
  totalDays: number;
  activeDays: number;
  completedDays: number;
  partialDays: number;
  missedDays: number;
  consistencyRate: number;
  totalVolume: number;
  averageAllDays: number;
  averageActiveDays: number;
  peakValue: number;
  peakDate: string | null;
  currentStreak: number;
  bestStreak: number;
  totalSessions?: number;
  averagePerSession?: number;
  totalPeriods?: number;
  completedPeriods?: number;
  elapsedPeriods?: number;
  completedElapsedPeriods?: number;
  activePeriodInProgress?: boolean;
  activePeriodCompleted?: boolean;
  periodAverage?: number;
  bestPeriodValue?: number;
}

function isComplete(value: number, target?: TargetVersion, habit?: HabitDefinition): boolean {
  if (habit?.type === "tracker") return value > 0;
  if (habit?.type === "avoidance") {
    const maxLimit = target?.max ?? 0;
    return value <= maxLimit;
  }
  if (!target || (target.min === undefined && target.max === undefined)) return false;
  const withinMin = target.min === undefined || value >= target.min;
  const withinMax = target.max === undefined || value <= target.max;
  return withinMin && withinMax;
}

export function calculateHabitAnalytics(
  habit: HabitDefinition,
  dates: string[],
  logs: Map<string, DailyLog>,
  today: string
): HabitAnalytics {
  const eligibleDates = dates.filter((d) => d <= today);
  const totalDays = eligibleDates.length;

  let activeDays = 0;
  let completedDays = 0;
  let partialDays = 0;
  let missedDays = 0;
  let totalVolume = 0;
  let peakValue = 0;
  let peakDate: string | null = null;
  let totalSessions = 0;

  const dayComplete = new Map<string, boolean>();

  for (const date of eligibleDates) {
    const log = logs.get(date) ?? emptyDailyLog(date);
    const value = valueForHabit(log, habit);
    const target = targetForDate(habit, date);
    const complete = isComplete(value, target, habit);

    dayComplete.set(date, complete);

    if (value > 0) activeDays += 1;
    if (habit.type === "avoidance") {
      if (complete) {
        completedDays += 1;
      } else {
        missedDays += 1;
      }
    } else if (habit.type === "tracker") {
      if (value > 0) {
        completedDays += 1;
      }
    } else {
      if (complete) {
        completedDays += 1;
      } else if (value > 0) {
        partialDays += 1;
      } else {
        missedDays += 1;
      }
    }

    totalVolume += value;

    if (value > peakValue) {
      peakValue = value;
      peakDate = date;
    } else if (peakDate === null && value > 0) {
      peakValue = value;
      peakDate = date;
    }

    const sessions = log.sessions?.[habit.id] ?? (habit.id === "reading" ? log.reading : undefined);
    if (sessions && sessions.length > 0) {
      totalSessions += sessions.length;
    }
  }

  // Calculate best streak for this habit
  let bestStreak = 0;
  let currentRun = 0;
  for (const date of eligibleDates) {
    if (dayComplete.get(date)) {
      currentRun += 1;
      if (currentRun > bestStreak) bestStreak = currentRun;
    } else {
      currentRun = 0;
    }
  }

  // Calculate current streak for this habit
  const todayComplete = dayComplete.get(today) === true;
  let cursor = todayComplete ? today : addDays(today, -1);
  let currentStreak = 0;
  while (cursor >= (eligibleDates[0] ?? today)) {
    if (dayComplete.get(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }

  const averageAllDays = totalDays > 0 ? Math.round((totalVolume / totalDays) * 100) / 100 : 0;
  const averageActiveDays = activeDays > 0 ? Math.round((totalVolume / activeDays) * 100) / 100 : 0;
  const consistencyRate = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) / 100 : 0;
  const averagePerSession = totalSessions > 0 ? Math.round((totalVolume / totalSessions) * 100) / 100 : undefined;

  const result: HabitAnalytics = {
    habit,
    totalDays,
    activeDays,
    completedDays,
    partialDays,
    missedDays,
    consistencyRate,
    totalVolume: Math.round(totalVolume * 100) / 100,
    averageAllDays,
    averageActiveDays,
    peakValue: Math.round(peakValue * 100) / 100,
    peakDate,
    currentStreak,
    bestStreak,
    ...(habit.type === "session" || totalSessions > 0 ? { totalSessions, averagePerSession } : {})
  };

  // Evaluate each period once, at its latest eligible date.
  if (habit.cadence !== "daily" && eligibleDates.length > 0) {
    const periods = new Map<string, string>();
    for (const date of eligibleDates) periods.set(periodBounds(date, habit.cadence).startDate, date);

    let completedPeriods = 0;
    let elapsedPeriods = 0;
    let completedElapsedPeriods = 0;
    let activePeriodInProgress = false;
    let activePeriodCompleted = false;
    let bestPeriodValue = 0;
    const periodCount = periods.size;

    for (const latestDate of periods.values()) {
      const evaluation = evaluatePeriodGoal(habit, latestDate, logs);
      if (evaluation.value > bestPeriodValue) bestPeriodValue = evaluation.value;
      const isPeriodComplete = evaluation.status === "complete";
      if (isPeriodComplete) completedPeriods += 1;

      const isElapsed = evaluation.endDate < today;
      if (isElapsed) {
        elapsedPeriods += 1;
        if (isPeriodComplete) completedElapsedPeriods += 1;
      } else {
        activePeriodInProgress = true;
        if (isPeriodComplete) activePeriodCompleted = true;
      }
    }

    result.totalPeriods = periodCount;
    result.completedPeriods = completedPeriods;
    result.elapsedPeriods = elapsedPeriods;
    result.completedElapsedPeriods = completedElapsedPeriods;
    result.activePeriodInProgress = activePeriodInProgress;
    result.activePeriodCompleted = activePeriodCompleted;
    result.periodAverage = periodCount > 0 ? Math.round((totalVolume / periodCount) * 100) / 100 : 0;
    result.bestPeriodValue = Math.round(bestPeriodValue * 100) / 100;

    if (elapsedPeriods > 0) {
      result.consistencyRate = Math.round((completedElapsedPeriods / elapsedPeriods) * 100) / 100;
    } else {
      result.consistencyRate = completedPeriods > 0 ? 1 : 0;
    }
  }

  return result;
}

export function calculateAllHabitsAnalytics(
  habits: HabitDefinition[],
  dates: string[],
  logs: Map<string, DailyLog>,
  today: string
): Map<string, HabitAnalytics> {
  const result = new Map<string, HabitAnalytics>();
  for (const habit of habits.filter((h) => h.enabled)) {
    result.set(habit.id, calculateHabitAnalytics(habit, dates, logs, today));
  }
  return result;
}
