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
});
