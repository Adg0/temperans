import { expect, it, vi } from "vitest";
import { HabitStore } from "../src/data";
import { memoryVault } from "./helpers/memory-vault";
import { LogCache } from "../src/log-cache";
import { emptyDailyLog } from "../src/log-schema";

const doc = (date: string, value = 10) => "---\n" + JSON.stringify({ temperans: "habit-log", temperans_schema: 3, date, hydration: { value, source: "manual" } }) + "\n---\n";
function fixture(count = 365, ready = true) {
  const f = memoryVault();
  const metadata = new Map<string, any>();
  f.put("Habit Logs/Settings.md", "---\n" + JSON.stringify({ timezone: "UTC", habits: [] }) + "\n---\n");
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const path = "Habit Logs/custom-" + i + ".md";
    f.put(path, doc(date)); metadata.set(path, { frontmatter: JSON.parse(doc(date).split("\n")[1]) });
  }
  f.put("Habit Logs/Dashboard.md", "Layout");
  const cache = vi.fn(file => ready ? metadata.get(file.path) ?? {} : null);
  f.app.metadataCache.getFileCache = cache;
  return { ...f, metadata, cache, store: new HabitStore(f.app, "Habit Logs") };
}
it("initializes without touching historical logs", async () => {
  const f = fixture(1000); await f.store.loadSettings();
  expect(f.vault.read.mock.calls.map(([file]) => file.path)).toEqual(["Habit Logs/Settings.md"]);
  expect(f.cache).not.toHaveBeenCalled();
});
it.each([365, 3650])("reads only one requested date with %s metadata-indexed logs", async count => {
  const f = fixture(count);
  expect((await f.store.getLog("2024-01-01")).metrics.hydration).toBe(10);
  expect(f.vault.read).toHaveBeenCalledTimes(1);
});
it("loads only the requested year and shares simultaneous reads", async () => {
  const f = fixture(1100);
  const [first, second] = await Promise.all([f.store.allLogsForYear(2024), f.store.allLogsForYear(2024)]);
  expect(first.size).toBe(366); expect(second).toEqual(first);
  expect(f.vault.read).toHaveBeenCalledTimes(366);
  await f.store.allLogsForYear(2024);
  expect(f.vault.read).toHaveBeenCalledTimes(366);
});
it("updates one changed file despite stale metadata without rescanning other entries", async () => {
  const f = fixture(100); await f.store.dailyFiles(); f.cache.mockClear();
  f.put("Habit Logs/custom-0.md", doc("2026-01-01", 42)); f.store.invalidate("Habit Logs/custom-0.md");
  expect((await f.store.getLog("2026-01-01")).metrics.hydration).toBe(42);
  expect((await f.store.dailyFiles()).has("2024-01-01")).toBe(false);
  expect(f.vault.read).toHaveBeenCalledTimes(1); expect(f.cache).not.toHaveBeenCalled();
});
it("handles rename and deletion without a whole-history read", async () => {
  const f = fixture(100); await f.store.dailyFiles();
  f.entries.delete("Habit Logs/custom-0.md");
  f.put("Habit Logs/renamed.md", doc("2024-01-01"));
  f.store.invalidate("Habit Logs/custom-0.md"); f.store.invalidate("Habit Logs/renamed.md");
  expect((await f.store.dailyFiles()).get("2024-01-01")?.path).toBe("Habit Logs/renamed.md");
  expect(f.vault.read).toHaveBeenCalledTimes(1);
  f.entries.delete("Habit Logs/renamed.md"); f.store.invalidate("Habit Logs/renamed.md");
  expect((await f.store.dailyFiles()).has("2024-01-01")).toBe(false);
});
it("reuses discovery reads when metadata is unavailable", async () => {
  const f = fixture(100, false); await f.store.allLogsForYear(2024);
  expect(f.vault.read).toHaveBeenCalledTimes(100);
});
it("does not create a duplicate custom note hidden by stale metadata", async () => {
  const f = fixture(1);
  f.put("Habit Logs/custom-0.md", doc("2026-01-01"));
  await f.store.recordMetric("2026-01-01", "hydration", 25);
  expect(f.contents.has("Habit Logs/2026-01-01.md")).toBe(false);
  expect(f.contents.get("Habit Logs/custom-0.md")).toContain('"value":25');
});
it("keeps nested-over-flat duplicate selection stable", async () => {
  const f = fixture(0, false);
  f.put("Habit Logs/2024-01-01.md", doc("2024-01-01", 1));
  f.put("Habit Logs/2024/01/2024-01-01.md", doc("2024-01-01", 2));
  expect((await f.store.getLog("2024-01-01")).metrics.hydration).toBe(2);
});
it("retries failed discovery and never treats failed reads as missing notes", async () => {
  const f = fixture(1, false); f.vault.read.mockRejectedValueOnce(new Error("Offline"));
  await expect(f.store.recordMetric("2026-01-01", "hydration", 1)).rejects.toThrow("Offline");
  expect(f.contents.has("Habit Logs/2026-01-01.md")).toBe(false);
  expect((await f.store.getLog("2024-01-01")).metrics.hydration).toBe(10);
});
it("does not cache an in-flight read invalidated by an external edit", async () => {
  const f = fixture(1); await f.store.dailyFiles();
  let release!: (contents: string) => void;
  f.vault.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.store.getLog("2024-01-01");
  await vi.waitFor(() => expect(release).toBeDefined());
  f.put("Habit Logs/custom-0.md", doc("2024-01-01", 99)); f.store.invalidate("Habit Logs/custom-0.md");
  release(doc("2024-01-01", 10));
  expect((await pending).metrics.hydration).toBe(99);
});
it("yields large discovery and stops further reads after unload", async () => {
  const f = fixture(1000, false);
  const pending = f.store.getLog("2024-01-01");
  const readsBeforeStop = f.vault.read.mock.calls.length;
  f.store.stop();
  await expect(pending).rejects.toThrow("cancelled");
  expect(f.vault.read).toHaveBeenCalledTimes(readsBeforeStop);
});
it("bounds cache entries and payload bytes using least-recently-used eviction", () => {
  const cache = new LogCache(2, 2000), a = emptyDailyLog("2024-01-01");
  cache.set("a", a); cache.set("b", a); cache.get("a"); cache.set("c", a);
  expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")).toBe(a);
  cache.set("large", { ...a, metricNotes: { hydration: "x".repeat(3000) } });
  expect(cache.get("large")).toBeUndefined(); expect(cache.usage.estimatedBytes).toBeLessThanOrEqual(2000);
});

it("limits active reads across independent consumers", async () => {
  const f = fixture(30); await f.store.dailyFiles();
  let active = 0, peak = 0;
  f.vault.read.mockImplementation(async file => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--; return f.contents.get(file.path)!;
  });
  await Promise.all(Array.from({ length: 30 }, (_, i) => f.store.getLog("2024-01-" + String(i + 1).padStart(2, "0"))));
  expect(peak).toBeLessThanOrEqual(4); expect(f.vault.read).toHaveBeenCalledTimes(30);
});
it("corrects date membership when delayed metadata arrives", async () => {
  const f = fixture(1); await f.store.dailyFiles();
  const file = f.put("Habit Logs/custom-0.md", doc("2026-01-01"));
  expect(f.store.metadataChanged(file as any, { temperans: "habit-log", date: "2026-01-01" })).toBe(true);
  expect((await f.store.getLog("2026-01-01")).metrics.hydration).toBe(10);
});

it("cancels one range consumer without cancelling another shared read", async () => {
  const f = fixture(1); await f.store.dailyFiles();
  let release!: (text: string) => void;
  f.vault.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController();
  const a = f.store.logsForDates(["2024-01-01"], controller.signal);
  const rejected = expect(a).rejects.toMatchObject({ name: "AbortError" });
  const b = f.store.logsForDates(["2024-01-01"]);
  await vi.waitFor(() => expect(release).toBeDefined());
  controller.abort(); await rejected; release(doc("2024-01-01", 42));
  expect((await b).get("2024-01-01")?.metrics.hydration).toBe(42);
  expect(f.vault.read).toHaveBeenCalledTimes(1);
});
it("stops fallback discovery when its last consumer cancels and can resume later", async () => {
  const f = fixture(100, false);
  let release!: (text: string) => void;
  f.vault.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController();
  const pending = f.store.logsForDates(["2024-01-01"], controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(release).toBeDefined());
  controller.abort(); await rejected; release(doc("2024-01-01"));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(f.vault.read).toHaveBeenCalledTimes(1);
  expect((await f.store.getLog("2024-01-01")).metrics.hydration).toBe(10);
});
