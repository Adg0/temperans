import { HabitLoggingConfig, LoggingField, QuickEntryConfig } from "./types";

/** YAML-only presentation options; never accepts executable markup or CSS. */
export function parseLoggingConfig(value: unknown): HabitLoggingConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const result: HabitLoggingConfig = {};
  for (const key of ["amount", "remark", "title"] as const) {
    const field = raw[key];
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    const options: LoggingField = {};
    for (const property of ["label", "placeholder", "description"] as const) {
      const text = (field as Record<string, unknown>)[property];
      if (typeof text === "string") options[property] = text;
    }
    if (Object.keys(options).length) result[key] = options;
  }
  if (raw.quickEntry === false) result.quickEntry = false;
  else if (raw.quickEntry && typeof raw.quickEntry === "object" && !Array.isArray(raw.quickEntry)) {
    const rawQuick = raw.quickEntry as Record<string, unknown>;
    const quick: QuickEntryConfig = {};
    if (Array.isArray(rawQuick.values)) quick.values = rawQuick.values.filter((item): item is number | string =>
      typeof item === "number" ? Number.isFinite(item) && item >= 0 : typeof item === "string" && item.trim().length > 0);
    if (rawQuick.mode === "add" || rawQuick.mode === "set") quick.mode = rawQuick.mode;
    if (typeof rawQuick.showClear === "boolean") quick.showClear = rawQuick.showClear;
    if (Object.keys(quick).length) result.quickEntry = quick;
  }
  return Object.keys(result).length ? result : undefined;
}
