import { vi } from "vitest";
import { parse } from "yaml";
vi.mock("obsidian", async original => ({ ...await original<object>(), parseYaml: parse }));
import { describe, expect, it } from "vitest";
import { parseCodeblockConfig } from "../src/dashboard/codeblock-parser";

describe("temperans-dashboard markdown codeblock config parser", () => {
  it("defaults to overall consistency and standard widgets when empty", () => {
    const config = parseCodeblockConfig("");
    expect(config.habitFilter).toBe("overall");
    expect(config.year).toBe(new Date().getFullYear());
    expect(config.widgets.map((w) => w.widget)).toEqual(["stats", "calendar", "day-detail"]);
  });

  it("parses specific habit and custom year", () => {
    const yaml = `
habit: guitar
year: 2025
widgets:
  - stats
  - calendar
`;
    const config = parseCodeblockConfig(yaml);
    expect(config.habitFilter).toBe("guitar");
    expect(config.year).toBe(2025);
    expect(config.widgets.map((w) => w.widget)).toEqual(["stats", "calendar"]);
  });

  it("parses widgets with custom configuration options", () => {
    const yaml = `
habit: reading
widgets:
  - widget: stats
    cards:
      - consistency
      - total-volume
  - widget: heatmap
    showLegend: false
  - widget: day-detail
    showSessions: false
`;
    const config = parseCodeblockConfig(yaml);
    expect(config.habitFilter).toBe("reading");
    expect(config.widgets).toHaveLength(3);
    expect(config.widgets[0]).toEqual({
      widget: "stats",
      config: { cards: ["consistency", "total-volume"] }
    });
    // heatmap alias maps to calendar
    expect(config.widgets[1]).toEqual({
      widget: "calendar",
      config: { showLegend: false }
    });
    expect(config.widgets[2]).toEqual({
      widget: "day-detail",
      config: { showSessions: false }
    });
  });

  it("parses custom date and logger widget for daily note embeds", () => {
    const yaml = `
habit: reading
date: 2026-10-21
widgets:
  - widget: logger
    title: "Daily Reading Log"
  - day-detail
`;
    const config = parseCodeblockConfig(yaml);
    expect(config.habitFilter).toBe("reading");
    expect(config.habitFilters).toEqual(["reading"]);
    expect(config.date).toBe("2026-10-21");
    expect(config.year).toBe(2026);
    expect(config.widgets).toEqual([
      { widget: "logger", config: { title: "Daily Reading Log" } },
      { widget: "day-detail" }
    ]);
  });

  it("parses multiple habit filters via array or comma-separated string", () => {
    const arrayConfig = parseCodeblockConfig(`
habits:
  - reading
  - sleep
  - hydration
widgets:
  - logger
`);
    expect(arrayConfig.habitFilter).toBe("overall");
    expect(arrayConfig.habitFilters).toEqual(["reading", "sleep", "hydration"]);

    const csvConfig = parseCodeblockConfig(`
habit: reading, sleep, hydration
widgets:
  - logger
`);
    expect(csvConfig.habitFilter).toBe("overall");
    expect(csvConfig.habitFilters).toEqual(["reading", "sleep", "hydration"]);
  });
});
