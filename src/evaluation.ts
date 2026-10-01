import { emptyDailyLog } from "./log-schema";
import { addDays } from "./date";
import { DailyLog, DayEvaluation, HabitCadence, HabitDefinition, HabitEvaluation, HabitSettings, ImportedTypingResult, PeriodEvaluation, TargetVersion } from "./types";

export function targetForDate(habit: HabitDefinition, date: string): TargetVersion | undefined {
  return [...habit.targetHistory]
    .filter((target) => target.effectiveDate <= date)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))
    .at(-1);
}

export function valueForHabit(log: DailyLog, habit: HabitDefinition): number {
  if (habit.id === "typing") {
    if (hasTypingData(log)) return typingDurationSeconds(log) / 60;
    return log.metrics[habit.id] ?? 0;
  }

  const sessions = log.sessions?.[habit.id] ?? (habit.id === "reading" ? log.reading : undefined);
  if (habit.type === "session" || (sessions && sessions.length > 0)) {
    const list = sessions ?? [];
    if (habit.unit === "count") return list.length;
    const safeNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    return list.reduce((sum, session) => {
      if (habit.unit === "chapters") return sum + safeNum(session.chapters);
      if (habit.unit === "minutes") return sum + safeNum(session.minutes);
      if ((habit.unit === "hours" || habit.unit === "seconds") && session.minutes !== undefined) {
        return sum + safeNum(session.minutes) * (habit.unit === "hours" ? 1 / 60 : 60);
      }
      if (habit.unit === "reps") return sum + safeNum(session.reps);
      return sum + (safeNum(session.pages) || safeNum(session.count));
    }, 0);
  }

  return log.metrics[habit.id] ?? 0;
}

export function typingDurationSeconds(log: DailyLog): number {
  return log.typing.imported.length > 0
    ? log.typing.imported.reduce((sum, item) => sum + item.durationSeconds, 0)
    : log.typing.manualDurationSeconds;
}

export function typingTestCount(log: DailyLog): number {
  return log.typing.imported.length > 0 ? log.typing.imported.length : log.typing.manualTests;
}

export function hasTypingData(log: DailyLog): boolean {
  return log.typing.manualTests > 0 || log.typing.manualDurationSeconds > 0 || log.typing.imported.length > 0;
}

export function periodBounds(date: string, cadence: HabitCadence | string): { startDate: string; endDate: string } {
  if (cadence === "daily") return { startDate: date, endDate: date };
  if (cadence === "weekly") {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const startDate = addDays(date, -daysSinceMonday);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  if (cadence === "monthly") {
    const startDate = `${date.slice(0, 7)}-01`;
    const afterMonth = new Date(`${startDate}T12:00:00Z`);
    afterMonth.setUTCMonth(afterMonth.getUTCMonth() + 1);
    return { startDate, endDate: addDays(afterMonth.toISOString().slice(0, 10), -1) };
  }
  if (cadence === "quarterly") {
    const year = date.slice(0, 4);
    const month = Number(date.slice(5, 7));
    const quarterIndex = Math.floor((month - 1) / 3);
    const startMonth = String(quarterIndex * 3 + 1).padStart(2, "0");
    const endMonth = String(quarterIndex * 3 + 3).padStart(2, "0");
    const lastDay = (quarterIndex === 0 || quarterIndex === 3) ? "31" : "30";
    return {
      startDate: `${year}-${startMonth}-01`,
      endDate: `${year}-${endMonth}-${lastDay}`
    };
  }
  if (cadence === "annual" || cadence === "yearly") {
    const year = date.slice(0, 4);
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`
    };
  }
  return { startDate: date, endDate: date };
}

export function datesFromPeriodStart(date: string, cadence: HabitCadence): string[] {
  const { startDate } = periodBounds(date, cadence);
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= date; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

export interface GoalProgressResult {
  progress: number;
  isOverCeiling: boolean;
  excess: number;
}

export function calculateGoalProgress(value: number, target: TargetVersion | undefined, habit?: HabitDefinition): GoalProgressResult {
  // 1. Tracker habit: zero goal / non-streak
  if (habit?.type === "tracker") {
    return { progress: value > 0 ? 1 : 0, isOverCeiling: false, excess: 0 };
  }

  // 2. Avoidance / negative habit: success is value <= max (default max 0)
  if (habit?.type === "avoidance") {
    const maxLimit = target?.max ?? 0;
    if (value <= maxLimit) {
      return { progress: 1, isOverCeiling: false, excess: 0 };
    }
    const excess = value - maxLimit;
    return { progress: 0, isOverCeiling: true, excess };
  }

  // 3. Habit with no targets defined
  if (!target || (target.min === undefined && target.max === undefined)) {
    return { progress: value > 0 ? 1 : 0, isOverCeiling: false, excess: 0 };
  }

  // 4. Habit with maximum ceiling target exceeded
  if (target.max !== undefined && value > target.max) {
    const excess = value - target.max;
    const baseline = target.max > 0 ? target.max : 1;
    const penalty = excess / baseline;
    const progress = Math.max(0, Math.round((1 - penalty) * 100) / 100);
    return { progress, isOverCeiling: true, excess };
  }

  // 5. Value in optimal green zone (between min and max)
  const meetsMin = target.min === undefined || value >= target.min;
  const meetsMax = target.max === undefined || value <= target.max;
  if (meetsMin && meetsMax) {
    if (target.min !== undefined && target.min > 0 && target.max === undefined) {
      const progress = Math.round((value / target.min) * 100) / 100;
      return { progress, isOverCeiling: false, excess: 0 };
    }
    return { progress: 1, isOverCeiling: false, excess: 0 };
  }

  // 6. Below minimum target
  if (target.min !== undefined && target.min > 0) {
    const progress = Math.max(0, Math.round((value / target.min) * 100) / 100);
    return { progress, isOverCeiling: false, excess: 0 };
  }

  return { progress: 0, isOverCeiling: false, excess: 0 };
}

function evaluationStatus(value: number, target: TargetVersion | undefined, habit?: HabitDefinition): HabitEvaluation["status"] {
  if (habit?.type === "tracker") return "not-applicable";
  if (habit?.type === "avoidance") {
    const maxLimit = target?.max ?? 0;
    return value <= maxLimit ? "complete" : "empty";
  }
  if (!target || (target.min === undefined && target.max === undefined)) return "not-applicable";
  const withinMin = target.min === undefined || value >= target.min;
  const withinMax = target.max === undefined || value <= target.max;
  return withinMin && withinMax ? "complete" : value > 0 ? "partial" : "empty";
}

export function evaluatePeriodGoal(habit: HabitDefinition, date: string, logs: Map<string, DailyLog>): PeriodEvaluation {
  const { startDate, endDate } = periodBounds(date, habit.cadence);
  const target = targetForDate(habit, date);
  const value = datesFromPeriodStart(date, habit.cadence)
    .reduce((sum, logDate) => sum + valueForHabit(logs.get(logDate) ?? emptyDailyLog(logDate), habit), 0);
  const status = habit.enabled ? evaluationStatus(value, target, habit) : "not-applicable";
  const { progress } = calculateGoalProgress(value, target, habit);
  return { habit, target, value, status, startDate, endDate, progress };
}

export function evaluateDailyLog(log: DailyLog, date: string, settings: HabitSettings): DayEvaluation {
  const habits: HabitEvaluation[] = settings.habits.map((habit) => {
    const target = targetForDate(habit, date);
    const value = valueForHabit(log, habit);
    const status: HabitEvaluation["status"] = habit.enabled && habit.cadence === "daily"
      ? evaluationStatus(value, target, habit)
      : "not-applicable";
    return { habit, target, value, status };
  });
  const eligible = habits.filter((item) => item.status !== "not-applicable").length;
  const completed = habits.filter((item) => item.status === "complete").length;
  return { date, habits, eligible, completed, score: eligible ? completed / eligible : null };
}

export function mergeImportedResults(existing: ImportedTypingResult[], additions: ImportedTypingResult[]): ImportedTypingResult[] {
  const known = new Set(existing.map((result) => result.id));
  return [...existing, ...additions.filter((result) => !known.has(result.id))];
}

export function calculateDailyStreak(
  today: string,
  getEvaluation: (date: string) => DayEvaluation | undefined
): { streak: number; coversToday: boolean } {
  const todayEvaluation = getEvaluation(today);
  const coversToday = todayEvaluation?.score === 1;
  let cursor = coversToday ? today : addDays(today, -1);
  let streak = 0;
  while (streak < 10000) {
    const evaluation = getEvaluation(cursor);
    if (evaluation?.score !== 1) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { streak, coversToday };
}

export function bestDailyStreak(
  dates: string[],
  getEvaluation: (date: string) => DayEvaluation | undefined
): number {
  let best = 0;
  let current = 0;
  for (const date of dates) {
    const evaluation = getEvaluation(date);
    if (evaluation && evaluation.score === 1) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

