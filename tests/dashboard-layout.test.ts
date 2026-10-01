import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDGET_CONFIGS,
  parseDashboardLayout,
  renderDashboardDocument
} from "../src/dashboard/layout-loader";

describe("declarative dashboard layout loader", () => {
  it("falls back to the standard 5-widget layout when frontmatter is empty or missing", () => {
    expect(parseDashboardLayout(null).widgets).toEqual(DEFAULT_WIDGET_CONFIGS);
    expect(parseDashboardLayout({}).widgets).toEqual(DEFAULT_WIDGET_CONFIGS);
    expect(parseDashboardLayout({ layout: [] }).widgets).toEqual(DEFAULT_WIDGET_CONFIGS);
  });

  it("parses user-reordered and customized widgets from layout array", () => {
    const custom = {
      temperans: "dashboard",
      version: 1,
      layout: [
        { widget: "header" },
        { widget: "day-detail" },
        { widget: "stats", config: { cards: ["consistency", "volume"] } },
        { widget: "calendar" }
      ]
    };
    const parsed = parseDashboardLayout(custom);
    expect(parsed.widgets).toHaveLength(4);
    expect(parsed.widgets[0].widget).toBe("header");
    expect(parsed.widgets[1].widget).toBe("day-detail");
    expect(parsed.widgets[2].widget).toBe("stats");
    expect(parsed.widgets[2].config).toEqual({ cards: ["consistency", "volume"] });
    expect(parsed.widgets[3].widget).toBe("calendar");
  });

  it("supports string shorthand array in layout frontmatter", () => {
    const shorthand = {
      layout: ["header", "stats", "calendar"]
    };
    const parsed = parseDashboardLayout(shorthand);
    expect(parsed.widgets).toEqual([
      { widget: "header" },
      { widget: "stats" },
      { widget: "calendar" }
    ]);
  });

  it("parses direct top-level configuration properties and maps heatmap alias to calendar", () => {
    const richLayout = {
      temperans: "dashboard",
      version: 1,
      layout: [
        {
          widget: "header",
          showActions: false,
          showPeriodNav: true
        },
        {
          widget: "stats",
          cards: ["consistency", "total-volume", "current-streak", "best-streak"]
        },
        {
          widget: "heatmap",
          showLegend: false,
          mode: "month"
        },
        {
          widget: "day-detail",
          showSessions: false,
          showNotes: false
        }
      ]
    };
    const parsed = parseDashboardLayout(richLayout);
    expect(parsed.widgets).toHaveLength(4);
    expect(parsed.widgets[0]).toEqual({
      widget: "header",
      config: { showActions: false, showPeriodNav: true }
    });
    expect(parsed.widgets[1]).toEqual({
      widget: "stats",
      config: { cards: ["consistency", "total-volume", "current-streak", "best-streak"] }
    });
    expect(parsed.widgets[2]).toEqual({
      widget: "calendar",
      config: { showLegend: false, mode: "month" }
    });
    expect(parsed.widgets[3]).toEqual({
      widget: "day-detail",
      config: { showSessions: false, showNotes: false }
    });
  });

  it("renders a documented Dashboard.md markdown template", () => {
    const doc = renderDashboardDocument({
      version: 1,
      widgets: DEFAULT_WIDGET_CONFIGS
    });
    expect(doc).toContain("temperans: dashboard");
    expect(doc).toContain("widget: header");
    expect(doc).toContain("widget: calendar");
    expect(doc).toContain("# Dashboard Configuration");
  });
});
