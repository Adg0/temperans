import { parseYaml } from "obsidian";
import { isLogDate } from "../note-paths";
import { HabitId } from "../types";
import { DashboardWidgetConfig } from "./types";

export interface CodeblockConfig {
  habit?: string | string[];
  habits?: string | string[];
  year?: number;
  date?: string;
  widgets?: Array<string | DashboardWidgetConfig>;
}

export function parseYamlSafe(source: string): Record<string, unknown> {
  try {
    const parsed: unknown = parseYaml(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function normalizeDateInput(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    return isLogDate(iso) ? iso : undefined;
  }
  if (typeof value === "string" && isLogDate(value.trim())) {
    return value.trim();
  }
  return undefined;
}

export function normalizeHabitList(value: unknown): HabitId[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseCodeblockConfig(source: string): {
  habitFilter: HabitId;
  habitFilters?: HabitId[];
  year: number;
  date?: string;
  widgets: DashboardWidgetConfig[];
} {
  const currentYear = new Date().getFullYear();
  const parsed = parseYamlSafe(source);

  const rawHabits = parsed.habits !== undefined ? parsed.habits : parsed.habit;
  const list = normalizeHabitList(rawHabits).filter((id) => id !== "overall");
  const habit = list.length === 1 ? list[0] : "overall";
  const habitFilters = list.length > 0 ? list : undefined;
  const date = normalizeDateInput(parsed.date);
  const year = typeof parsed.year === "number" && Number.isInteger(parsed.year)
    ? parsed.year
    : date
    ? Number(date.slice(0, 4))
    : currentYear;

  const rawWidgets = Array.isArray(parsed.widgets) ? parsed.widgets : ["stats", "calendar", "day-detail"];
  const widgets: DashboardWidgetConfig[] = [];

  for (const item of rawWidgets) {
    if (typeof item === "string" && item.trim()) {
      const name = item.trim() === "heatmap" ? "calendar" : item.trim();
      widgets.push({ widget: name });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const rawName = typeof obj.widget === "string" ? obj.widget.trim() : typeof obj.type === "string" ? obj.type.trim() : "";
      const widget = rawName === "heatmap" ? "calendar" : rawName;
      if (widget) {
        const { widget: _w, type: _t, config, ...rest } = obj;
        const finalConfig = { ...rest, ...(config && typeof config === "object" ? config : {}) };
        widgets.push({ widget, ...(Object.keys(finalConfig).length > 0 ? { config: finalConfig } : {}) });
      }
    }
  }

  return {
    habitFilter: habit,
    ...(habitFilters ? { habitFilters } : {}),
    year,
    ...(date ? { date } : {}),
    widgets: widgets.length > 0 ? widgets : [{ widget: "stats" }, { widget: "calendar" }, { widget: "day-detail" }]
  };
}
