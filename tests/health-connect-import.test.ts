import { afterEach, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { normalizeHealthConnectRecord, validateHealthConnectStagingDocument } from "../src/integrations/health-connect-schema";
import { healthConnectStagePath, importHealthConnectStaging } from "../src/integrations/health-connect";
import { Platform } from "./helpers/obsidian-ui";

afterEach(() => { vi.useRealTimers(); Platform.isMobileApp = false; });

function fixture(contents?: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  const document = { schemaVersion: 1, integration: "health-connect", generatedAt: "2026-09-26T10:00:00Z", timezone: "UTC",
    sources: ["temperans-companion"], records: [{ date: "2026-09-26", hydration: { value: 1500, unit: "ml" } }] };
  const adapter = { exists: vi.fn().mockResolvedValue(true), read: vi.fn().mockResolvedValue(contents ?? JSON.stringify(document)), remove: vi.fn() };
  const apply = vi.fn().mockResolvedValue({ metricsImported: 1, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 });
  const host = {
    app: { vault: { getAbstractFileByPath: () => null, adapter } } as unknown as App,
    store: { folderPath: "My Habits", loadSettings: async () => ({ timezone: "UTC", habits: [] }), applyHealthConnectMetrics: apply },
    refreshAllDashboards: vi.fn()
  };
  return { host, adapter, apply };
}

it.each([false, true])("imports an unindexed staging file on mobile=%s", async mobile => {
  Platform.isMobileApp = mobile;
  const { host, adapter, apply } = fixture();
  const summary = await importHealthConnectStaging(host);
  expect(adapter.read).toHaveBeenCalledWith("My Habits/.temperance-staging.json");
  expect(apply).toHaveBeenCalledWith([expect.objectContaining({ date: "2026-09-26", metrics: { hydration: 1500 }, source: "health-connect" })]);
  expect(summary.imported).toBe(1);
  expect(adapter.remove).not.toHaveBeenCalled();
  expect(host.refreshAllDashboards).toHaveBeenCalledOnce();
});

it("keeps malformed staging data without writing habit logs", async () => {
  const { host, adapter, apply } = fixture("invalid JSON");
  await expect(importHealthConnectStaging(host)).rejects.toThrow("not valid JSON");
  expect(apply).not.toHaveBeenCalled();
  expect(adapter.remove).not.toHaveBeenCalled();
});


it("imports and retains the configured file inside the operation folder", async () => {
  const { host, adapter } = fixture();
  const summary = await importHealthConnectStaging({ ...host, getHealthConnectStagingPath: () => "My Habits/Exports/health.json" });
  expect(adapter.read).toHaveBeenCalledWith("My Habits/Exports/health.json");
  expect(adapter.remove).not.toHaveBeenCalled();
  expect(summary.stagingPath).toBe("My Habits/Exports/health.json");
});

it.each(["../health.json", "/health.json", "C:\\health.json", ".obsidian/health.json", "Exports/../health.json", "My Habits/Exports/health.md", "https://example.com/health.json", "My Habits/Exports//health.json", "My Habits/Exports/CON.json"])("rejects unsafe staging path %s before reading", async path => {
  const { host, adapter, apply } = fixture();
  await expect(importHealthConnectStaging({ ...host, getHealthConnectStagingPath: () => path })).rejects.toThrow();
  expect(adapter.read).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it("resets to the current habit folder and normalizes Windows separators", () => {
  expect(healthConnectStagePath("My Habits", "   ")).toBe("My Habits/.temperance-staging.json");
  expect(healthConnectStagePath("My Habits", "My Habits\\Exports\\health.json")).toBe("My Habits/Exports/health.json");
});


it("rejects incompatible units before any habit log writes", async () => {
  const { host, apply } = fixture(JSON.stringify({ schemaVersion: 1, integration: "health-connect", generatedAt: "2026-09-26T10:00:00Z", timezone: "UTC", sources: ["temperans-companion"], records: [{ date: "2026-09-26", reading: { value: 30, unit: "minutes", sessions: [{ value: 30, note: "Chapter" }] } }] }));
  await expect(importHealthConnectStaging({ ...host, store: { ...host.store, loadSettings: async () => ({ timezone: "UTC", habits: [{ id: "reading", name: "Reading", unit: "pages", cadence: "daily" as const, enabled: true, targetHistory: [] }] }) } })).rejects.toThrow("Cannot import minutes as pages");
  expect(apply).not.toHaveBeenCalled();
});

it("converts compatible totals and session values together", () => {
  expect(normalizeHealthConnectRecord({ date: "2026-09-26", "reading-time": { value: 120, unit: "minutes", sessions: [{ value: 90, note: "Book" }, { value: 30 }] } },
    [{ id: "reading-time", name: "Reading time", unit: "hours", cadence: "daily", enabled: true, targetHistory: [] }])).toEqual(expect.objectContaining({ metrics: { "reading-time": 2 }, sessions: { "reading-time": [expect.objectContaining({ minutes: 90 }), expect.objectContaining({ minutes: 30 })] } }));
});

it("requires an explicit matching recovery week before importing old sessions", async () => {
  const { host, apply } = fixture(JSON.stringify({ schemaVersion: 1, integration: "health-connect", generatedAt: "2026-09-26T10:00:00Z", timezone: "UTC", sources: ["temperans-companion"], records: [{ date: "2026-09-01", pullups: { value: 20, unit: "reps" } }] }));
  await expect(importHealthConnectStaging(host)).rejects.toThrow("outside the permitted");
  expect(apply).not.toHaveBeenCalled();
  await importHealthConnectStaging(host, "2026-09-01");
  expect(apply).toHaveBeenCalledOnce();
  await expect(importHealthConnectStaging(host, "2026-09-30")).rejects.toThrow("valid recovery");
});

it("canonicalizes legacy wire IDs and rejects alias collisions", () => {
  const raw = { schemaVersion: 1, integration: "health-connect", generatedAt: "2026-09-26T10:00:00Z", timezone: "UTC", sources: ["temperans-companion"], records: [{ date: "2026-09-26", active_calories: { value: 20, unit: "kcal" } }] };
  const result = validateHealthConnectStagingDocument(raw, "UTC", "2026-09-26");
  expect(result.ok && result.value.records[0]["active-calories"]).toEqual({ value: 20, unit: "kcal" });
  expect(validateHealthConnectStagingDocument({ ...raw, records: [{ ...raw.records[0], "active-calories": { value: 30, unit: "kcal" } }] }, "UTC", "2026-09-26").ok).toBe(false);
});

it("identifies staged metrics that are not configured in settings", async () => {
  const { host } = fixture();
  const summary = await importHealthConnectStaging(host);
  expect(summary.unconfiguredMetrics).toEqual(["hydration"]);
});
