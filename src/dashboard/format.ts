import { formatSleepDuration } from "../durations";
import { HabitDefinition } from "../types";

export function formatValue(value: number, unit: string, habit?: HabitDefinition): string {
  if (habit?.displayFormat === "duration" || habit?.id === "sleep") return formatSleepDuration(value);
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const label = value === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return unit === "minutes" ? `${rendered} min` : `${rendered} ${label}`;
}

/** Compact analytics only; storage and goal labels retain their original units. */
export function formatStatValue(value: number, unit: string, habit?: HabitDefinition): string {
  let label = unit;
  const timeUnit = habit?.displayFormat === "duration" || habit?.id === "sleep" || habit?.id === "typing" ? "minutes" : unit.toLowerCase();
  const timeScale: Record<string, number> = { seconds: 1, second: 1, sec: 1, minutes: 60, minute: 60, min: 60, hours: 3600, hour: 3600, h: 3600, days: 86400, day: 86400 };
  if (timeScale[timeUnit]) {
    const seconds = value * timeScale[timeUnit];
    const scale = Math.max(timeScale[timeUnit], Math.abs(seconds) >= 86400 ? 86400 : Math.abs(seconds) >= 3600 ? 3600 : Math.abs(seconds) >= 60 ? 60 : 1);
    value = seconds / scale;
    label = scale === 86400 ? (Math.abs(value) === 1 ? "day" : "days") : scale === 3600 ? "h" : scale === 60 ? "min" : "s";
  } else {
    const larger: Record<string, string> = { ml: "L", g: "kg", m: "km" };
    if (larger[unit.toLowerCase()] && Math.abs(value) >= 1000) {
      value /= 1000;
      label = larger[unit.toLowerCase()];
    }
  }
  const magnitude = Math.abs(value);
  const divisor = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1;
  const suffix = divisor === 1e9 ? "bn" : divisor === 1e6 ? "mn" : divisor === 1e3 ? "k" : "";
  const number = Number((value / divisor).toFixed(1));
  return (number + suffix + " " + label).trim();
}

export function targetLabel(target?: { min?: number; max?: number }, habit?: HabitDefinition): string {
  if (habit?.type === "tracker") return "Zero-goal tracking";
  const format = (v: number) => formatValue(v, habit?.unit ?? "count", habit);
  if (habit?.type === "avoidance") {
    const maxVal = target?.max ?? 0;
    return `max ${format(maxVal)}`;
  }
  if (!target || (target.min === undefined && target.max === undefined)) return "No target";
  if (target.min !== undefined && target.max !== undefined) return `${format(target.min)}–${format(target.max)}`;
  if (target.min !== undefined) return format(target.min);
  if (target.max !== undefined) return `up to ${format(target.max)}`;
  return "No target";
}

export function cadenceLabel(cadence: string): string {
  return cadence[0].toUpperCase() + cadence.slice(1);
}

export function calendarModeFor(isCompact: boolean, mode?: unknown): "month" | "year" {
  return mode === "month" || mode === "year" ? mode : isCompact ? "month" : "year";
}
