import { parseYaml } from "obsidian";
import { HabitId } from "../types";
import { DashboardWidgetConfig } from "./types";

export interface CodeblockConfig {
  habit?: string;
  year?: number;
  widgets?: Array<string | DashboardWidgetConfig>;
}

export function parseYamlSafe(source: string): Record<string, unknown> {
  try {
    const parsed: unknown = parseYaml(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function parseCodeblockConfig(source: string): { habitFilter: "overall" | HabitId; year: number; widgets: DashboardWidgetConfig[] } {
  const currentYear = new Date().getFullYear();
  const parsed = parseYamlSafe(source);

  const habit = typeof parsed.habit === "string" && parsed.habit.trim() ? parsed.habit.trim() : "overall";
  const year = typeof parsed.year === "number" && Number.isInteger(parsed.year) ? parsed.year : currentYear;

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
    habitFilter: habit as "overall" | HabitId,
    year,
    widgets: widgets.length > 0 ? widgets : [{ widget: "stats" }, { widget: "calendar" }, { widget: "day-detail" }]
  };
}
