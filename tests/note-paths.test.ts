import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { HabitStore } from "../src/data";
import { DEFAULT_NOTE_PATH, NotePathSettings, formattedLogPath, noteFormat, restoreNotePath, validateNoteFormat } from "../src/note-paths";
import { memoryVault } from "./helpers/memory-vault";
import { PeerSyncFiles } from "../src/peer-sync/files";
import { comparePeerManifests } from "../src/peer-sync/protocol";
import { emptyDailyLog, serializeDailyLog } from "../src/log-schema";

function fixture(initial: NotePathSettings = { ...DEFAULT_NOTE_PATH }) {
  const f = memoryVault();
  f.put("Habit Logs/Settings.md", `---\n${JSON.stringify({ temperans: "settings", timezone: "UTC", habits: [] })}\n---\n`);
  let settings = initial;
  const store = new HabitStore(f.app, "Habit Logs", () => settings);
  return { ...f, store, setMode: (next: NotePathSettings) => { settings = next; store.invalidate(); } };
}
const custom = (format: string): NotePathSettings => ({ mode: "custom", format });

it("defaults to flat filenames and restores saved modes", () => {
  expect(restoreNotePath(undefined)).toEqual(DEFAULT_NOTE_PATH);
  expect(restoreNotePath({ mode: "bad", format: 12 })).toEqual(DEFAULT_NOTE_PATH);
  expect(restoreNotePath({ mode: "nested" })).toEqual({ ...DEFAULT_NOTE_PATH, mode: "nested" });
});
it.each([
  ["YYYY-MM-DD", "2026-09-26"], ["YYYY/MM/YYYY-MM-DD", "2026/09/2026-09-26"],
  ["YYYY/MMMM/DD-dddd", "2026/September/26-Saturday"], ["[Daily]/DD-MM-YYYY", "Daily/26-09-2026"],
  ["YYYY/MM/DD", "2026/09/26"]
])("formats and validates %s", (format, filename) => {
  validateNoteFormat("Habit Logs", format);
  expect(formattedLogPath("Habit Logs", "2026-09-26", format)).toBe(`Habit Logs/${filename}.md`);
});
it.each(["YYYY-MM", "MM-DD", "[same]", "../YYYY-MM-DD", "/YYYY-MM-DD", "YYYY//MM/DD", "[C:]/YYYY-MM-DD", "[.obsidian]/YYYY-MM-DD", "[NUL]/YYYY-MM-DD", "YYYY-MM-DD[.]"])("rejects incomplete or unsafe format %s", format => {
  expect(() => validateNoteFormat("Habit Logs", format)).toThrow();
});
it("restores removed naming modes without accessing another plugin", () => {
  const app = Object.defineProperty({}, "internalPlugins", { get: () => { throw new Error("Private API accessed"); } }) as App;
  const restored = restoreNotePath({ mode: "daily-notes", format: "YYYY-MM-DD" });
  expect(restored.mode).toBe("flat");
  expect(noteFormat(app, restored)).toBe("YYYY-MM-DD");
});

describe("mixed note layouts", () => {
  it("creates flat by default, nests when enabled, and updates existing files in place", async () => {
    const f = fixture();
    await f.store.recordMetric("2026-09-24", "focus", 10);
    expect(f.contents.has("Habit Logs/2026-09-24.md")).toBe(true);
    f.setMode({ ...DEFAULT_NOTE_PATH, mode: "nested" });
    await f.store.recordMetric("2026-09-25", "focus", 20);
    await f.store.recordMetric("2026-09-24", "focus", 15);
    expect(f.contents.has("Habit Logs/2026/09/2026-09-25.md")).toBe(true);
    expect(f.contents.has("Habit Logs/2026/09/2026-09-24.md")).toBe(false);
    f.setMode(DEFAULT_NOTE_PATH);
    await f.store.recordMetric("2026-09-26", "focus", 30);
    expect((await f.store.allLogsForYear(2026)).size).toBe(3);
    expect((await f.store.getLog("2026-09-24")).metrics.focus).toBe(15);
  });
  it("discovers custom notes after restart or format changes and preserves their content", async () => {
    const f = fixture(custom("YYYY/MMMM/DD-dddd"));
    await f.store.recordMetric("2024-02-29", "focus", 25);
    const path = "Habit Logs/2024/February/29-Thursday.md";
    const raw = JSON.parse(f.contents.get(path)!.split("---\n")[1]);
    f.put(path, `---\n${JSON.stringify({ ...raw, tags: ["keep"] })}\n---\n# My writing\nKeep this body.\n`);
    const reopened = new HabitStore(f.app, "Habit Logs");
    expect((await reopened.allLogsForYear(2024)).get("2024-02-29")?.metrics.focus).toBe(25);
    await reopened.recordMetric("2024-02-29", "focus", 40);
    expect(f.contents.get(path)).toContain("Keep this body.");
    expect(f.contents.get(path)).toContain('"tags":["keep"]');
    expect(f.contents.has("Habit Logs/2024-02-29.md")).toBe(false);
  });
  it("refreshes modified custom-date metadata without rereading unchanged notes", async () => {
    const f = fixture(custom("DD-MM-YYYY"));
    await f.store.recordMetric("2026-09-25", "focus", 5);
    await f.store.recordMetric("2026-09-26", "focus", 6);
    const path = "Habit Logs/25-09-2026.md";
    f.put(path, f.contents.get(path)!.replace('"date": "2026-09-25"', '"date": "2026-09-24"').replace('"date":"2026-09-25"', '"date":"2026-09-24"'));
    f.store.invalidate(path);
    f.vault.read.mockClear();
    expect((await f.store.dailyFiles()).has("2026-09-24")).toBe(true);
    expect(f.vault.read.mock.calls.every(([file]) => file.path !== "Habit Logs/26-09-2026.md")).toBe(true);
  });
  it("rejects a date collision instead of overwriting another day's log", async () => {
    const f = fixture();
    const log = emptyDailyLog("2026-09-25");
    f.put("Habit Logs/2026-09-26.md", `---\n${JSON.stringify(serializeDailyLog(log, {}))}\n---\nKeep me`);
    await expect(f.store.recordMetric("2026-09-26", "focus", 6)).rejects.toThrow("belongs to");
    expect(f.contents.get("Habit Logs/2026-09-26.md")).toContain("Keep me");
  });
});

it("syncs across flat, nested and custom layouts without renaming existing notes", async () => {
  const sender = fixture(custom("YYYY/MMMM/DD"));
  const receiver = fixture();
  await sender.store.recordMetric("2026-09-26", "focus", 60);
  const send = new PeerSyncFiles(sender.app, "Habit Logs", undefined, sender.store);
  const receive = new PeerSyncFiles(receiver.app, "Habit Logs", undefined, receiver.store);
  const manifest = await send.createManifest();
  expect(manifest.files.map(file => file.path)).toContain("2026-09-26.md");
  const payload = await send.readPayload("2026/09/2026-09-26.md");
  await receive.writeRemotePayload(payload, null);
  expect(receiver.contents.has("Habit Logs/2026-09-26.md")).toBe(true);
  expect((await receiver.store.getLog("2026-09-26")).metrics.focus).toBe(60);
  receiver.setMode({ ...DEFAULT_NOTE_PATH, mode: "nested" });
  await receive.writeRemotePayload(payload, payload.sha256);
  expect(receiver.contents.has("Habit Logs/2026/09/2026-09-26.md")).toBe(false);
  expect(comparePeerManifests(await send.createManifest(), await receive.createManifest()).find(item => item.path.endsWith("2026-09-26.md"))?.status).toBe("same");
  await expect(receive.writeRemotePayload(payload, null)).rejects.toThrow();
  await expect(receive.readPayload("../Settings.md")).rejects.toThrow("allowlist");
  await sender.store.recordMetric("2026-09-27", "focus", 70);
  await receive.writeRemotePayload(await send.readPayload("2026-09-27.md"), null);
  expect(receiver.contents.has("Habit Logs/2026/09/2026-09-27.md")).toBe(true);
});
