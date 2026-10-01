import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { evaluateDailyLog } from "../src/evaluation";
import { emptyDailyLog } from "../src/log-schema";
import type { DashboardHost, WidgetContext } from "../src/dashboard/types";
import { HabitDashboardView } from "../src/dashboard/view";

const widgets = vi.hoisted(() => ({ render: vi.fn(), update: vi.fn(), mode: "auto" }));
vi.mock("../src/dashboard/registry", () => ({ defaultWidgetRegistry: {
  get: (id: string) => ({ id, ...widgets })
} }));
vi.mock("../src/dashboard/layout-loader", () => ({
  ensureDashboardFile: vi.fn().mockResolvedValue(undefined),
  loadDashboardLayout: async () => ({ widgets: [{ widget: "calendar", config: { mode: widgets.mode } }, { widget: "day-detail" }] })
}));

it("reuses analytics while selecting days and recomputes it after refreshed data", async () => {
  const settings = { timezone: "UTC", habits: [] };
  const store = {
    folderPath: "Habit Logs", loadSettings: vi.fn().mockResolvedValue(settings),
    logsForDates: vi.fn().mockResolvedValue(new Map()), evaluate: evaluateDailyLog
  };
  const view = new HabitDashboardView({ app: {} } as unknown as WorkspaceLeaf, { store, state: { heatmapColor: "#00ff00" } } as unknown as DashboardHost);
  await view.refresh();
  const initial = widgets.render.mock.calls[0][1] as WidgetContext;
  initial.onSelectDay(`${initial.year}-${String(initial.month).padStart(2, "0")}-01`);
  await vi.waitFor(() => expect(widgets.update).toHaveBeenCalled());
  const selected = widgets.update.mock.calls.at(-1)![1] as WidgetContext;
  expect(selected.selectedDate).toBe(`${initial.year}-${String(initial.month).padStart(2, "0")}-01`);
  expect(selected.analytics).toBe(initial.analytics);
  expect(selected.dates).toBe(initial.dates);
  expect(store.logsForDates).toHaveBeenCalledTimes(2);
  store.logsForDates.mockResolvedValue(new Map([[selected.selectedDate!, emptyDailyLog(selected.selectedDate!)]]));
  await view.refresh();
  const refreshed = (view as unknown as { renderedContext: WidgetContext }).renderedContext;
  expect(refreshed.analytics).not.toBe(initial.analytics);
  expect(refreshed.logs.has(selected.selectedDate!)).toBe(true);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-03-31T12:00:00Z"));
  widgets.mode = "auto";
});
afterEach(() => vi.useRealTimers());

async function navigationFixture(width: number, mode = "auto") {
  widgets.mode = mode;
  const store = {
    folderPath: "Habit Logs", loadSettings: async () => ({ timezone: "UTC", habits: [] }),
    logsForDates: async () => new Map(), evaluate: evaluateDailyLog
  };
  const view = new HabitDashboardView({ app: {} } as unknown as WorkspaceLeaf,
    { store, state: { heatmapColor: "#00ff00" } } as unknown as DashboardHost);
  Object.defineProperty(view.contentEl, "clientWidth", { value: width });
  await view.refresh();
  const context = () => (view as unknown as { renderedContext: WidgetContext }).renderedContext;
  const navigate = async (delta: number) => { context().onNavigatePeriod(delta); await view.refresh(); return context(); };
  return { view, context, navigate };
}

it.each([[500, "auto"], [1000, "month"]])("navigates months at width %s in %s mode without snapping back", async (width, mode) => {
  const { view, context, navigate } = await navigationFixture(Number(width), String(mode));
  expect(context().calendarMode).toBe("month");
  expect(await navigate(-1)).toMatchObject({ year: 2024, month: 2, selectedDate: "2024-02-29" });
  context().onSelectDay("2024-02-01");
  await view.refresh();
  expect(context()).toMatchObject({ month: 2, selectedDate: "2024-02-01" });
  expect(await navigate(-2)).toMatchObject({ year: 2023, month: 12, selectedDate: "2023-12-31" });
  expect(await navigate(1)).toMatchObject({ year: 2024, month: 1, selectedDate: "2024-01-31" });
  context().onGoToToday();
  await view.refresh();
  expect(context()).toMatchObject({ year: 2024, month: 3, selectedDate: "2024-03-31" });
});

it.each([[1000, "auto"], [500, "year"]])("keeps year navigation at width %s in %s mode", async (width, mode) => {
  const { navigate, context } = await navigationFixture(Number(width), String(mode));
  expect(context().calendarMode).toBe("year");
  expect(await navigate(-1)).toMatchObject({ year: 2023, selectedDate: "2023-12-31" });
  expect(await navigate(1)).toMatchObject({ year: 2024, month: 3, selectedDate: "2024-03-31" });
});

it("does not render after closing during settings loading", async () => {
  let release!: (value: unknown) => void;
  const store = { folderPath: "Habit Logs", loadSettings: () => new Promise(resolve => { release = resolve; }), logsForDates: vi.fn() };
  const view = new HabitDashboardView({ app: {} } as unknown as WorkspaceLeaf, { store, state: { heatmapColor: "#00ff00" } } as unknown as DashboardHost);
  const pending = view.refresh(); await view.onClose();
  release({ timezone: "UTC", habits: [] }); await pending;
  expect(widgets.render).not.toHaveBeenCalled(); expect(store.logsForDates).not.toHaveBeenCalled();
});
it("switches periods without waiting for a cancelled slow range", async () => {
  let oldSignal: AbortSignal | undefined;
  const store = {
    folderPath: "Habit Logs", loadSettings: async () => ({ timezone: "UTC", habits: [] }), evaluate: evaluateDailyLog,
    logsForDates: vi.fn(async (dates: string[], signal: AbortSignal) => {
      if (dates.length > 1 && dates[0].startsWith("2024")) {
        oldSignal = signal;
        await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
      }
      return new Map();
    })
  };
  const view = new HabitDashboardView({ app: {} } as unknown as WorkspaceLeaf, { store, state: { heatmapColor: "#00ff00" } } as unknown as DashboardHost);
  const first = view.refresh();
  await vi.waitFor(() => expect(oldSignal).toBeDefined());
  const context = () => (view as unknown as { renderedContext: WidgetContext }).renderedContext;
  context().onNavigatePeriod(-1);
  await view.refresh(); await first;
  expect(oldSignal?.aborted).toBe(true); expect(context().year).toBe(2023);
});
