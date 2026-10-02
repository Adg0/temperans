import { beforeEach, describe, expect, it, vi } from "vitest";
import { Element, notices, Platform } from "./helpers/obsidian-ui";
import type { App } from "obsidian";
import type TemperansHabitsPlugin from "../src/main";
import type { DashboardActionsHost } from "../src/dashboard-actions-modal";
import type { HabitStore } from "../src/data";
import type { PeerSyncService } from "../src/peer-sync/service";

vi.mock("obsidian", () => import("./helpers/obsidian-ui"));
vi.mock("../src/dropdown", () => ({
  createTemperansDropdown: (parent: Element, config: { onChange(value: string): void }) => { parent.dropdown = config; }
}));

import { TemperansSettingTab } from "../src/settings";
import { DashboardActionsModal } from "../src/dashboard-actions-modal";
import { renderAddHabitForm } from "../src/habit-form";
import { renderHealthConnectPanel } from "../src/integrations/health-connect-panel";
import { renderPeerSyncSettings } from "../src/peer-sync/settings-panel";
import { renderAnalyticsPanel } from "../src/analytics-panel";
import { emptyDailyLog } from "../src/log-schema";

const makeStore = () => ({
  loadSettings: vi.fn().mockResolvedValue({ timezone: "UTC", habits: ["reading", "reading-2"].map(id => ({ id, name: id, unit: "pages", cadence: "daily", enabled: true, targetHistory: [] })) }),
  addHabit: vi.fn().mockResolvedValue(undefined)
});
const storeType = (store: ReturnType<typeof makeStore>) => store as unknown as HabitStore;
const change = (root: Element, name: string, value: unknown) => root.field(name).controls[0].change(value);
const choose = (root: Element, name: string, value: string) => root.field(name).controlEl.dropdown!.onChange(value);
const action = (root: Element, title: string) => root.find(node => node.attrs["aria-label"]?.startsWith(`${title}:`) ?? false).onclick!();

beforeEach(() => { notices.length = 0; Platform.isDesktopApp = true; Platform.isMobileApp = false; });

describe("shared habit creation", () => {
  it.each(["settings", "actions"])("retains the %s entry point, save and return navigation", async (entry) => {
    const store = makeStore();
    const refreshed = vi.fn().mockResolvedValue(undefined);
    let root: Element;
    if (entry === "settings") {
      const tab = new TemperansSettingTab({} as App, { store, state: {}, refreshDashboards: refreshed } as unknown as TemperansHabitsPlugin);
      tab.display();
      root = tab.containerEl as unknown as Element;
      await action(root, "Configure habits");
      // Navigation launches the async subpage, so wait for the visible form.
      await action(root, "Create a new habit");
    } else {
      const modal = new DashboardActionsModal({} as App, { store } as unknown as DashboardActionsHost, refreshed);
      modal.onOpen();
      root = modal.contentEl as unknown as Element;
      await action(root, "Add a habit");
    }
    await vi.waitFor(() => expect(root.field("Habit name")).toBeDefined());
    change(root, "Habit name", " Reading ");
    change(root, "Minimum target", "15");
    change(root, "Maximum target", "60");
    change(root, "Multi-entry sessions", true);
    expect(root.all().some(node => node.setting?.name === "Use H:MM time format")).toBe(false);
    choose(root, "Unit", "custom");
    change(root, "Custom unit name", " pomodoros ");
    choose(root, "Goal cadence", "quarterly");
    await root.button("Create habit").onclick!();
    expect(store.addHabit).toHaveBeenCalledWith(expect.objectContaining({
      id: "reading-3", name: "Reading", unit: "pomodoros", cadence: "quarterly", type: "session",
      enabled: true, targetHistory: [{ effectiveDate: expect.any(String), min: 15, max: 60 }]
    }));
    expect(refreshed).toHaveBeenCalledOnce();
    expect(root.all().some(node => node.textContent === (entry === "settings" ? "Configure habits" : "Habit actions"))).toBe(true);
  });

  it.each(["Avoidance habit", "Metric tracker"])("saves %s with the correct target and keyboard selection", async title => {
    const root = new Element(), store = makeStore();
    await renderAddHabitForm(root.element(), storeType(store), vi.fn());
    change(root, "Habit name", "New Habit");
    const preventDefault = vi.fn();
    root.find(node => node.attrs["aria-label"] === title).onkeydown!({ key: " ", preventDefault });
    await root.button("Create habit").onclick!();
    const habit = store.addHabit.mock.calls[0][0];
    expect(habit.type).toBe(title === "Avoidance habit" ? "avoidance" : "tracker");
    expect(habit.targetHistory[0]).toEqual({ effectiveDate: expect.any(String), ...(title === "Avoidance habit" ? { max: 0 } : {}) });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it.each([["", "30", ""], ["date", "30", ""], ["Read", "-1", ""], ["Read", "30", "20"], ["Read", "Infinity", ""]])(
    "rejects invalid input (%s, %s, %s) without writing", async (name, min, max) => {
      const root = new Element(), store = makeStore(), done = vi.fn();
      await renderAddHabitForm(root.element(), storeType(store), done);
      change(root, "Habit name", name);
      change(root, "Minimum target", min);
      change(root, "Maximum target", max);
      await root.button("Create habit").onclick!();
      expect(store.addHabit).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
      expect(notices).toHaveLength(1);
    }
  );
});

describe("shared sync and analytics panels", () => {
  it.each([false, true])("imports staged health data on mobile=%s", async mobile => {
    Platform.isMobileApp = mobile;
    const root = new Element(), importer = vi.fn().mockResolvedValue({ imported: 4 }), refreshed = vi.fn();
    renderHealthConnectPanel(root.element(), importer, refreshed);
    await root.button("Import staged data").onclick!();
    expect(importer).toHaveBeenCalledOnce();
    expect(refreshed).toHaveBeenCalledOnce();
    expect(root.button("Import staged data").disabled).toBe(false);
  });

  it("restores the import action after a failure and allows retrying", async () => {
    const root = new Element(), importer = vi.fn().mockRejectedValueOnce(new Error("Missing staging file")).mockResolvedValue({ imported: 1 }), refreshed = vi.fn();
    renderHealthConnectPanel(root.element(), importer, refreshed);
    await root.button("Import staged data").onclick!();
    expect(notices).toContain("Missing staging file");
    expect(refreshed).not.toHaveBeenCalled();
    expect(root.button("Import staged data").disabled).toBe(false);
    await root.button("Import staged data").onclick!();
    expect(refreshed).toHaveBeenCalledOnce();
  });

  it("preserves host controls and paired profile edits", async () => {
    const root = new Element(), refresh = vi.fn();
    const service = {
      isHosting: false, configuredPort: 43887, setHostPort: vi.fn(), startHost: vi.fn(),
      getRemoteProfile: vi.fn().mockResolvedValue({ url: "", secret: "" }),
      saveRemoteProfile: vi.fn(), forgetRemoteProfile: vi.fn()
    };
    await renderPeerSyncSettings(root.element(), service as unknown as PeerSyncService, refresh);
    await change(root, "Local host port", "45000");
    await root.field("Local host port").controls[1].click();
    expect(service.setHostPort).toHaveBeenCalledWith(45000);
    expect(service.startHost).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    await change(root, "Connection detail", "http://192.168.1.20:43887#abcdefghijklmnop");
    expect(service.saveRemoteProfile).toHaveBeenCalledWith("http://192.168.1.20:43887", "abcdefghijklmnop");
    await root.button("Forget paired device").onclick!();
    expect(service.forgetRemoteProfile).toHaveBeenCalledOnce();
  });

  it("preserves each analytics entry point's peak date display", async () => {
    const log = emptyDailyLog("2025-01-01");
    log.metrics.reading = 25;
    const store = {
      loadSettings: async () => ({ timezone: "UTC", habits: [{ id: "reading", name: "Reading", unit: "pages", cadence: "daily", enabled: true, targetHistory: [{ effectiveDate: "2020-01-01", min: 10 }] }] }),
      allLogsForYear: async () => new Map([[log.date, log]])
    };
    for (const showDate of [true, false]) {
      const root = new Element();
      await renderAnalyticsPanel(root.element(), store as unknown as HabitStore, 2025, showDate);
      const row = root.find(node => node.children.some(child => child.textContent === "Single-day peak"));
      expect(row.children[1].textContent.startsWith("25 pages")).toBe(true);
      expect(row.children[1].textContent.includes("2025")).toBe(showDate);
    }
  });
});


it("saves the edited staging path before importing and blocks import if saving fails", async () => {
  const root = new Element(), importer = vi.fn().mockResolvedValue({ imported: 1 }), refreshed = vi.fn();
  const save = vi.fn().mockRejectedValueOnce(new Error("Invalid staging path"));
  renderHealthConnectPanel(root.element(), importer, refreshed, { path: "", defaultPath: "Habit Logs/.temperance-staging.json", save });
  change(root, "Staging file path", "Habit Logs/Exports/health.json");
  await root.button("Import staged data").onclick!();
  expect(importer).not.toHaveBeenCalled();
  expect(notices).toContain("Invalid staging path");
  await root.button("Import staged data").onclick!();
  expect(save).toHaveBeenLastCalledWith("Habit Logs/Exports/health.json");
  expect(importer).toHaveBeenCalledOnce();
  expect(save.mock.invocationCallOrder[1]).toBeLessThan(importer.mock.invocationCallOrder[0]);
  change(root, "Staging file path", "");
  await root.field("Staging file path").controls[1].click();
  expect(save).toHaveBeenLastCalledWith("");
  expect(root.all().some(node => node.textContent === "File: Habit Logs/.temperance-staging.json")).toBe(true);
});
