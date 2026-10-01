import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<object>(), Plugin: class {}, MarkdownRenderChild: class {} }));
import TemperansPlugin from "../src/main";
import { HabitStore } from "../src/data";

function fixture() {
  const host = { store: { folderPath: "Habit Logs" } as HabitStore, state: { healthConnectStagingPath: "" }, saveData: vi.fn().mockResolvedValue(undefined) };
  return { host, control: () => TemperansPlugin.prototype.healthConnectPathControl.call(host as never),
    path: () => TemperansPlugin.prototype.getHealthConnectStagingPath.call(host as never) };
}
it("persists a custom path, resets to the current folder, and avoids redundant writes", async () => {
  const f = fixture();
  expect(f.path()).toBe("Habit Logs/.temperance-staging.json");
  await f.control().save(" Habit Logs/Exports/health.json ");
  expect(f.path()).toBe("Habit Logs/Exports/health.json");
  expect(f.host.saveData).toHaveBeenCalledWith(expect.objectContaining({ healthConnectStagingPath: "Habit Logs/Exports/health.json" }));
  await f.control().save("Habit Logs/Exports/health.json");
  expect(f.host.saveData).toHaveBeenCalledOnce();
  await f.control().save("");
  f.host.store = { folderPath: "New Habits" } as HabitStore;
  expect(f.path()).toBe("New Habits/.temperance-staging.json");
});
it("retains the saved path if validation or persistence fails", async () => {
  const f = fixture();
  await expect(f.control().save("../export.json")).rejects.toThrow();
  expect(f.host.saveData).not.toHaveBeenCalled();
  f.host.saveData.mockRejectedValueOnce(new Error("Disk unavailable"));
  await expect(f.control().save("Habit Logs/Exports/health.json")).rejects.toThrow("Disk unavailable");
  expect(f.path()).toBe("Habit Logs/.temperance-staging.json");
});
