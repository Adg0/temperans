import { expect, it, vi } from "vitest";
import { HabitStore } from "../src/data";
import { memoryVault } from "./helpers/memory-vault";
import { StagedDashboard, widgetDates } from "../src/dashboard/staged-renderer";
import { VisibilityGate } from "../src/dashboard/visibility";
import { WidgetContext } from "../src/dashboard/types";
import { Element } from "./helpers/obsidian-ui";
import { daysInYear } from "../src/date";
import { emptyDailyLog } from "../src/log-schema";
import { evaluateDailyLog, evaluatePeriodGoal } from "../src/evaluation";
import { calculateHabitAnalytics } from "../src/analytics";
import { abortable } from "../src/async";

function fixture(ids: string[] = ["header", "stats", "calendar", "day-detail"]) {
  const root = new Element();
  const habits = [{ id: "a", name: "A", enabled: true, cadence: "daily", unit: "count", targetHistory: [{ effectiveDate: "2000-01-01", min: 1 }] }];
  const store = { dataRevision: 0, logsForDates: vi.fn(async (_dates: string[], _signal?: AbortSignal) => new Map()), evaluate: evaluateDailyLog };
  const ctx = { host: { store }, year: 2024, month: 3, selectedDate: "2024-03-15", today: "2024-03-15", settings: { timezone: "UTC", habits },
    dates: daysInYear(2024), logs: new Map(), evaluations: new Map(), analytics: new Map(), habitFilter: "overall", calendarMode: "month", onRefresh: vi.fn() } as unknown as WidgetContext;
  const entries = ids.map(id => ({ container: root.createDiv().element(), widget: { id, name: id, description: "", render: vi.fn(), update: vi.fn() } }));
  const controller = new AbortController();
  const renderer = new StagedDashboard(entries, ctx, controller.signal);
  const widget = (id: string) => entries.find(e => e.widget.id === id)!.widget;
  return { root, ctx, store, entries, controller, renderer, widget };
}
it("renders controls and daily details while annual statistics are blocked", async () => {
  const f = fixture(["header", "day-detail", "stats"]);
  let release!: () => void;
  f.store.logsForDates.mockImplementation(async dates => {
    if (dates.length > 1) await new Promise<void>(resolve => { release = resolve; });
    return new Map();
  });
  const rendering = f.renderer.run();
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(f.widget("header").render).toHaveBeenCalledOnce();
  expect(f.widget("day-detail").render).toHaveBeenCalledOnce();
  expect(f.widget("stats").render).not.toHaveBeenCalled();
  expect(f.root.all().some(el => el.textContent === "Loading statistics…")).toBe(true);
  release(); await rendering;
  expect(f.widget("stats").render).toHaveBeenCalledOnce();
});
it("header-only embeds never request history", async () => {
  const f = fixture(["header"]); await f.renderer.run();
  expect(f.store.logsForDates).not.toHaveBeenCalled();
});
it("month-only calendars request only eligible visible dates", async () => {
  const f = fixture(["calendar"]); await f.renderer.run();
  expect(f.store.logsForDates.mock.calls[0][0]).toEqual(Array.from({ length: 15 }, (_, i) => "2024-03-" + String(i + 1).padStart(2, "0")));
});
it("loads a single daily detail without year-wide history", async () => {
  const f = fixture(["day-detail"]); await f.renderer.run();
  expect(f.store.logsForDates).toHaveBeenCalledTimes(1);
  expect(f.store.logsForDates.mock.calls[0][0]).toEqual(["2024-03-15"]);
});
it("keeps yearly statistics yearly in month mode", async () => {
  const f = fixture(["stats"]); f.ctx.habitFilter = "a";
  const first = emptyDailyLog("2024-01-01"); first.metrics.a = 10;
  f.store.logsForDates.mockResolvedValue(new Map([[first.date, first]]));
  await f.renderer.run();
  expect(f.store.logsForDates.mock.calls[0][0]).toContain("2024-01-01");
  expect(f.ctx.analytics.get("a")).toEqual(calculateHabitAnalytics(f.ctx.settings.habits[0], f.ctx.dates, new Map([[first.date, first]]), f.ctx.today));
});
it("includes December contributions in January weekly totals", async () => {
  const f = fixture(["day-detail"]);
  f.ctx.selectedDate = f.ctx.today = "2025-01-01"; f.ctx.year = 2025; f.ctx.dates = daysInYear(2025);
  f.ctx.settings.habits[0].cadence = "weekly";
  const previous = emptyDailyLog("2024-12-30"); previous.metrics.a = 5;
  f.store.logsForDates.mockImplementation(async dates => new Map(dates.includes(previous.date) ? [[previous.date, previous]] : []));
  expect(widgetDates("day-periods", f.ctx)).toContain(previous.date);
  await f.renderer.run();
  expect(evaluatePeriodGoal(f.ctx.settings.habits[0], f.ctx.today, f.ctx.logs).value).toBe(5);
  expect(f.ctx.evaluations.has(previous.date)).toBe(false);
  expect(f.ctx.periodsPending).toBe(false);
});
it("shows pending period totals until their complete range arrives", async () => {
  const f = fixture(["day-detail"]); f.ctx.settings.habits[0].cadence = "annual";
  let release!: () => void;
  const states: boolean[] = [];
  f.widget("day-detail").render.mockImplementation(() => states.push(!!f.ctx.periodsPending));
  f.widget("day-detail").update.mockImplementation(() => states.push(!!f.ctx.periodsPending));
  f.store.logsForDates.mockImplementation(async dates => { if (dates.length > 1) await new Promise<void>(resolve => { release = resolve; }); return new Map(); });
  const run = f.renderer.run(); await vi.waitFor(() => expect(release).toBeDefined());
  expect(states).toEqual([true]); release(); await run; expect(states).toEqual([true, false]);
});
it("cancels an obsolete render without painting statistics", async () => {
  const f = fixture(["header", "stats"]);
  f.store.logsForDates.mockImplementation((_dates, signal) => abortable(new Promise(() => {}), signal));
  const run = f.renderer.run();
  const assertion = expect(run).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(f.store.logsForDates).toHaveBeenCalled());
  f.controller.abort(); await assertion; expect(f.widget("stats").render).not.toHaveBeenCalled();
});
it("offers retry when a range fails without rendering false-zero statistics", async () => {
  const f = fixture(["header", "stats"]); f.store.logsForDates.mockRejectedValue(new Error("Offline"));
  await expect(f.renderer.run()).rejects.toThrow("Offline");
  expect(f.widget("stats").render).not.toHaveBeenCalled(); expect(f.root.button("Retry")).toBeDefined();
});
it("reuses analytics between consumers but invalidates them after a data revision", async () => {
  const f = fixture(["stats"]); f.ctx.habitFilter = "a"; await f.renderer.run();
  const first = f.ctx.analytics;
  const next = fixture(["stats"]); next.ctx.habitFilter = "a"; next.ctx.host = f.ctx.host; await new StagedDashboard(next.entries, next.ctx, next.controller.signal).run();
  expect(next.ctx.analytics).toBe(first);
  f.store.dataRevision++;
  const edited = fixture(["stats"]); edited.ctx.habitFilter = "a"; edited.ctx.host = f.ctx.host; await new StagedDashboard(edited.entries, edited.ctx, edited.controller.signal).run();
  expect(edited.ctx.analytics).not.toBe(first);
});
it("defers an offscreen surface and resumes only when visible", async () => {
  let callback!: (entries: Array<{ isIntersecting: boolean }>) => void;
  const disconnect = vi.fn(), changed = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof callback) { callback = cb; } observe() {} disconnect = disconnect; });
  try {
    const gate = new VisibilityGate(new Element().element(), changed), ready = gate.start();
    callback([{ isIntersecting: false }]); await ready;
    expect(gate.visible).toBe(false); expect(changed).not.toHaveBeenCalled();
    callback([{ isIntersecting: true }]); expect(changed).toHaveBeenLastCalledWith(true);
    gate.stop(); callback([{ isIntersecting: false }]); expect(changed).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it("bounds real log reads at each visible stage", async () => {
  const f = fixture(); const vault = memoryVault();
  const metadata = new Map<string, any>();
  for (const date of daysInYear(2024)) {
    const fm = { temperans: "habit-log", temperans_schema: 3, date, a: { value: 1, source: "manual" } };
    const path = "Habit Logs/" + date + ".md";
    vault.put(path, "---\n" + JSON.stringify(fm) + "\n---\n"); metadata.set(path, { frontmatter: fm });
  }
  vault.app.metadataCache.getFileCache = file => metadata.get(file.path) ?? null;
  f.ctx.host.store = new HabitStore(vault.app, "Habit Logs");
  const reads: Record<string, number> = {};
  for (const entry of f.entries) entry.widget.render.mockImplementation(() => { reads[entry.widget.id] = vault.vault.read.mock.calls.length; });
  await new StagedDashboard(f.entries, f.ctx, f.controller.signal).run();
  expect(reads).toEqual({ header: 0, "day-detail": 1, calendar: 15, stats: 75 });
});

it("does not cache older render data under a newer store revision", async () => {
  const stale = fixture(["stats"]); stale.ctx.habitFilter = "a";
  stale.store.dataRevision++;
  await stale.renderer.run();
  const fresh = fixture(["stats"]); fresh.ctx.habitFilter = "a"; fresh.ctx.host = stale.ctx.host;
  await new StagedDashboard(fresh.entries, fresh.ctx, fresh.controller.signal).run();
  expect(fresh.ctx.analytics).not.toBe(stale.ctx.analytics);
});
