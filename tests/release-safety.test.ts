import { afterEach, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
vi.mock("obsidian", async original => ({ ...await original<object>(), parseYaml: parse, stringifyYaml: stringify }));
import { HabitStore } from "../src/data";
import { memoryVault } from "./helpers/memory-vault";
import { DebouncedTask } from "../src/async";
import { healthConnectStagePath } from "../src/integrations/health-connect";
import { PeerSyncFiles } from "../src/peer-sync/files";
import { descriptorForContent } from "../src/peer-sync/protocol";
import { startOfDayInZone } from "../src/date";
import { extractEndpointDailyValues, syncHabitFromEndpoint } from "../src/integrations/endpoint-runner";
import { HabitDefinition } from "../src/types";
const day = "2026-09-26";
const habit = (id: string): HabitDefinition => ({ id, name: id, unit: "count", cadence: "daily", enabled: true, targetHistory: [] });
function fixture() {
  const f = memoryVault();
  f.put("Habit Logs/Settings.md", "---\n" + stringify({ timezone: "UTC", habits: [habit("a"), habit("b"), { ...habit("typing"), unit: "minutes" }, habit("reading")] }) + "---\nKeep this settings body.\n");
  return { ...f, store: new HabitStore(f.app, "Habit Logs") };
}
afterEach(() => vi.useRealTimers());
it("coordinates simultaneous creation and settings edits with real YAML", async () => {
  const f = fixture();
  await Promise.all([f.store.recordMetric(day, "a", 10), f.store.recordMetric(day, "b", 20)]);
  f.store.invalidate();
  expect((await f.store.getLog(day)).metrics).toMatchObject({ a: 10, b: 20 });
  await Promise.all([f.store.addHabit(habit("c")), f.store.addHabit(habit("d"))]);
  expect((await f.store.loadSettings()).habits.map(h => h.id)).toEqual(["a", "b", "typing", "reading", "c", "d"]);
  expect(f.contents.get("Habit Logs/Settings.md")).toContain("Keep this settings body.");
});
it.each(["---\nhabits: [broken\n---\n", "---\nhabits: []\n", "---\n- invalid\n---\n"])("preserves malformed YAML: %s", async contents => {
  const f = fixture(); f.put("Habit Logs/Settings.md", contents);
  await expect(f.store.loadSettings()).rejects.toThrow("invalid YAML");
  await expect(f.store.addHabit(habit("c"))).rejects.toThrow();
  expect(f.contents.get("Habit Logs/Settings.md")).toBe(contents);
});
it("preserves manual typing and session ownership after reload", async () => {
  const f = fixture();
  await f.store.recordManualTyping(day, 900, 3);
  await f.store.addSession(day, "reading", { title: "Manual reading", pages: 10 });
  f.store.invalidate();
  const imported = await f.store.applyHealthConnectMetrics([{ date: day, source: "health-connect", metrics: { typing: 60, reading: 40 }, sessions: { reading: [{ title: "Imported", pages: 40 }] } }]);
  expect(imported.metricsProtected).toBe(2);
  const log = await f.store.getLog(day);
  expect(log.typing.manualDurationSeconds).toBe(900);
  expect(log.reading[0].title).toBe("Manual reading");
});
it("rejects a peer overwrite when the document changes after its checksum read", async () => {
  const f = fixture(); await f.store.recordMetric(day, "a", 10);
  const path = await f.store.pathFor(day), file = f.entries.get(path)!;
  const snapshot = f.contents.get(path)!;
  const expected = await descriptorForContent(day + ".md", snapshot);
  const incoming = await descriptorForContent(day + ".md", "incoming");
  const process = f.vault.process.getMockImplementation()!;
  f.vault.process.mockImplementation(async (file, update) => { f.contents.set(file.path, snapshot + "Concurrent edit"); return process(file, update); });
  const peer = new PeerSyncFiles(f.app, "Habit Logs", undefined, f.store);
  await expect(peer.writePayload(day + ".md", new TextEncoder().encode("incoming"), incoming.sha256, expected.sha256)).rejects.toThrow("changed after comparison");
  expect(f.contents.get(path)).toContain("Concurrent edit");
});
it("settles coalesced refresh failures and pending unload work", async () => {
  vi.useFakeTimers();
  const refresh = new DebouncedTask(async () => { throw new Error("Render failed"); });
  const results = Promise.allSettled([refresh.schedule(), refresh.schedule()]);
  await vi.advanceTimersByTimeAsync(200);
  expect((await results).map(r => r.status)).toEqual(["rejected", "rejected"]);
  const pending = refresh.schedule(); refresh.stop(); await expect(pending).resolves.toBeUndefined();
});
it.each(["Elsewhere/data.json", "/Habit Logs/data.json", "C:\\Habit Logs\\data.json", "Habit Logs/../data.json", "Habit Logs-old/data.json", "Habit Logs/.obsidian/data.json", "Habit Logs/Exports/CON.json"])("confines staging imports: %s", path => {
  expect(() => healthConnectStagePath("Habit Logs", path)).toThrow();
});
it("supports nested operation folders while excluding their siblings", () => {
  expect(healthConnectStagePath("Personal/Habits", "Personal/Habits/Exports/data.json")).toBe("Personal/Habits/Exports/data.json");
  expect(() => healthConnectStagePath("Personal/Habits", "Personal/data.json")).toThrow();
});
it("resolves local midnight across fixed-offset and DST transitions", () => {
  expect(new Date(startOfDayInZone(day, "Asia/Shanghai")).toISOString()).toBe("2026-09-25T16:00:00.000Z");
  expect(startOfDayInZone("2026-03-09", "America/New_York") - startOfDayInZone("2026-03-08", "America/New_York")).toBe(23 * 3600000);
  expect(startOfDayInZone("2026-11-02", "America/New_York") - startOfDayInZone("2026-11-01", "America/New_York")).toBe(25 * 3600000);
});
it("skips malformed endpoint values instead of converting them to zero", () => {
  const result = extractEndpointDailyValues({ [day]: { value: "bad" }, "2026-09-25": { value: -1 }, "2026-02-31": { value: 4 } }, undefined, "UTC");
  expect(result.size).toBe(0);
});
it("an endpoint checks the latest manual value inside its atomic write", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(day + "T12:00:00Z"));
  const f = fixture();
  const endpointHabit = { ...habit("a"), endpoint: { url: "https://example.com/metrics" } };
  const update = f.store.updateLog.bind(f.store);
  f.store.updateLog = async (date, change) => { await update(date, log => ({ ...log, metrics: { ...log.metrics, a: 5 }, metricSources: { ...log.metricSources, a: "manual" } })); return update(date, change); };
  const result = await syncHabitFromEndpoint(endpointHabit, f.store, null, 1, async () => ({ status: 200, json: { [day]: { value: 20 } } }));
  expect(result.daysProtected).toBe(1);
  expect((await f.store.getLog(day)).metrics.a).toBe(5);
});
