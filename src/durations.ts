import type { HabitDefinition } from "./types";

function nonNegativeWhole(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

const SECONDS_PER_UNIT: Record<string, number> = { hours: 3600, minutes: 60, seconds: 1 };

export function isTimeUnit(unit: string): boolean {
  return Object.hasOwn(SECONDS_PER_UNIT, unit);
}

/** Bare numbers use the input unit; colon notation uses hours unless explicitly M:SS. */
export function parseTimeValue(value: string, unit = "minutes", inputUnit = unit, colonUnit = "hours"): number | null {
  const text = value.trim();
  if (!text || !isTimeUnit(unit) || !isTimeUnit(inputUnit) || !isTimeUnit(colonUnit)) return null;
  let seconds: number;
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) seconds = Number(text) * SECONDS_PER_UNIT[inputUnit];
  else {
    const colon = text.match(/^(\d+):([0-5]\d)$/);
    if (colon) seconds = (Number(colon[1]) + Number(colon[2]) / 60) * SECONDS_PER_UNIT[colonUnit];
    else {
      const parts = [...text.matchAll(/(\d+(?:\.\d+)?|\.\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi)];
      if (!parts.length || text.replace(/(\d+(?:\.\d+)?|\.\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi, "").trim()) return null;
      seconds = parts.reduce((total, part) => total + Number(part[1]) * ({ h: 3600, m: 60, s: 1 }[part[2][0].toLowerCase()] ?? 0), 0);
    }
  }
  const amount = seconds / SECONDS_PER_UNIT[unit];
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(9)) : null;
}

export function parseHabitAmount(value: string, habit: Pick<HabitDefinition, "unit">): number | null {
  if (isTimeUnit(habit.unit)) return parseTimeValue(value, habit.unit);
  const amount = value.trim() ? Number(value) : NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Existing sleep/duration habits store minutes, with bare numbers entered as hours. */
export function parseSleepDuration(value: string): number | null {
  return parseTimeValue(value, "minutes", "hours");
}

/** Existing typing fields keep M:SS and store seconds; bare numbers are minutes. */
export function parseTypingDuration(value: string): number | null {
  return parseTimeValue(value, "seconds", "minutes", "minutes");
}

export function sleepInputValue(totalMinutes: number): string {
  const minutes = nonNegativeWhole(totalMinutes);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function typingInputValue(totalSeconds: number): string {
  const seconds = nonNegativeWhole(totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatSleepDuration(totalMinutes: number): string {
  const minutes = nonNegativeWhole(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  const hourLabel = hours === 1 ? "hr" : "hrs";
  return remainingMinutes === 0 ? `${hours} ${hourLabel}` : `${hours} ${hourLabel} ${remainingMinutes} min`;
}

export function formatTypingDuration(totalSeconds: number): string {
  const seconds = nonNegativeWhole(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes} min` : `${minutes} min ${remainingSeconds} sec`;
}
