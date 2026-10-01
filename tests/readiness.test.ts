/** Regressions promoted from the production-readiness audit. */
import { afterEach, expect, it, vi } from "vitest";
import { HabitStore } from "../src/data";
import { memoryVault } from "./helpers/memory-vault";
import { importHealthConnectStaging } from "../src/integrations/health-connect";
import { PeerSyncSessionManager, dispatchPeerSyncRequest } from "../src/peer-sync/server-protocol";
import { PEER_SYNC_API_PREFIX } from "../src/peer-sync/protocol";
import { encryptPeerPayload } from "../src/peer-sync/crypto";

vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<object>(), Plugin: class {}, MarkdownRenderChild: class {}
}));
import { DebouncedTask } from "../src/async";

afterEach(() => vi.useRealTimers());
const date = "2026-09-26";
const habit = (id: string, enabled = true) => ({ id, name: id, enabled, unit: "minutes", cadence: "daily", type: "session", targetHistory: [] });
function storeFixture(habits = [habit("a"), habit("b")]) {
  const f = memoryVault();
  f.put("Habit Logs/Settings.md", "---\n" + JSON.stringify({ timezone: "UTC", habits }) + "\n---\n");
  return { ...f, store: new HabitStore(f.app, "Habit Logs") };
}

it("R1: concurrent saves to different habits preserve both values", async () => {
  const f = storeFixture();
  await f.store.recordMetric(date, "seed", 1);
  await Promise.all([f.store.recordMetric(date, "a", 10), f.store.recordMetric(date, "b", 20)]);
  f.store.invalidate();
  expect((await f.store.getLog(date)).metrics).toMatchObject({ a: 10, b: 20 });
});

it("R2: all debounced refresh callers settle after the refresh runs", async () => {
  vi.useFakeTimers();
  const refresh = new DebouncedTask(async () => {});
  const settled = [false, false];
  void refresh.schedule().then(() => { settled[0] = true; });
  void refresh.schedule().then(() => { settled[1] = true; });
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toEqual([true, true]);
});

it("R3: Health Connect preserves a manually added session", async () => {
  const { store } = storeFixture();
  await store.addSession(date, "a", { title: "Manual practice", minutes: 10 });
  await store.applyHealthConnectMetrics([{ date, source: "health-connect", metrics: { a: 30 }, sessions: { a: [{ title: "Imported session", minutes: 30 }] } }]);
  expect((await store.getLog(date)).sessions.a).toContainEqual({ title: "Manual practice", minutes: 10 });
});

it("R4: Health Connect skips a disabled habit", async () => {
  const { store } = storeFixture([habit("a", false)]);
  await store.applyHealthConnectMetrics([{ date, source: "health-connect", metrics: { a: 30 } }]);
  expect((await store.getLog(date)).metrics.a).toBeUndefined();
});

function stagingFixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date(date + "T12:00:00Z"));
  const document = { schemaVersion: 1, integration: "health-connect", generatedAt: date + "T10:00:00Z", timezone: "UTC", sources: ["temperans-companion"], records: [{ date, hydration: { value: 1500, unit: "ml" } }] };
  let contents: string | null = JSON.stringify(document);
  const adapter = { exists: async () => true, read: async () => contents!, remove: vi.fn(async () => { contents = null; }) };
  const apply = vi.fn(async () => ({ metricsImported: 1, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 }));
  const host = { app: { vault: { getAbstractFileByPath: () => null, adapter } }, store: { folderPath: "Habit Logs", loadSettings: async () => ({ timezone: "UTC", habits: [] }), applyHealthConnectMetrics: apply }, refreshAllDashboards: async () => {} };
  return { host, adapter, apply, contents: () => contents, replace: (value: string) => { contents = value; } };
}

it("R5: import cleanup retains a newer export at the same path", async () => {
  const f = stagingFixture();
  f.apply.mockImplementation(async () => { f.replace("new export contents"); return { metricsImported: 1, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 }; });
  await importHealthConnectStaging(f.host as never);
  expect(f.contents()).toBe("new export contents");
});

it("R6: all-skipped imports retain their source for configuration and retry", async () => {
  const f = stagingFixture();
  f.apply.mockResolvedValue({ metricsImported: 0, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 1 });
  await importHealthConnectStaging(f.host as never);
  expect(f.adapter.remove).not.toHaveBeenCalled();
});

const files = () => ({ createManifest: vi.fn(async () => ({ version: 1 as const, files: [] })), readPayload: vi.fn(), writePayload: vi.fn() });

it("R7: host rejects legacy unencrypted requests", async () => {
  const result = await dispatchPeerSyncRequest(files(), "secret", { method: "GET", pathname: PEER_SYNC_API_PREFIX + "/manifest", authorization: "Bearer secret" });
  expect(result.status).not.toBe(200);
});

it("R8: changing the pairing secret invalidates an existing session", async () => {
  const sessions = new PeerSyncSessionManager();
  const hello = await sessions.handleHello("old-secret", { clientNonce: "test-nonce" });
  const session = sessions.getSession(hello.sessionSalt)!;
  const data = await encryptPeerPayload({ action: "manifest" }, session.keys.aesKey);
  const result = await dispatchPeerSyncRequest(files(), "new-secret", { method: "POST", pathname: PEER_SYNC_API_PREFIX + "/rpc", sessionSalt: hello.sessionSalt, sessionAuth: session.expectedClientProof, body: JSON.stringify({ encrypted: true, data }) }, sessions);
  expect(result.status).toBe(401);
});


it("rejects replayed encrypted requests before reading files again", async () => {
  const manager = new PeerSyncSessionManager();
  const hello = await manager.handleHello("secret", { clientNonce: "fresh" });
  const session = manager.getSession(hello.sessionSalt)!;
  const data = await encryptPeerPayload({ action: "manifest" }, session.keys.aesKey);
  const request = { method: "POST", pathname: PEER_SYNC_API_PREFIX + "/rpc", sessionSalt: hello.sessionSalt, sessionAuth: session.expectedClientProof, body: JSON.stringify({ encrypted: true, data }) };
  const fileStore = files();
  expect((await dispatchPeerSyncRequest(fileStore, "secret", request, manager)).status).toBe(200);
  expect((await dispatchPeerSyncRequest(fileStore, "secret", request, manager)).status).toBe(409);
  expect(fileStore.createManifest).toHaveBeenCalledOnce();
});
it("limits simultaneous unauthenticated handshakes and cancels old-key work", async () => {
  const manager = new PeerSyncSessionManager();
  const results = Promise.allSettled([manager.handleHello("secret", { clientNonce: "a" }), manager.handleHello("secret", { clientNonce: "b" }), manager.handleHello("secret", { clientNonce: "c" })]);
  manager.bindSecret("new-secret");
  const completed = await results;
  expect(completed.every(result => result.status === "rejected")).toBe(true);
  const fresh = await manager.handleHello("new-secret", { clientNonce: "fresh" });
  expect(manager.getSession(fresh.sessionSalt)).toBeDefined();
  manager.clear();
  expect(manager.getSession(fresh.sessionSalt)).toBeUndefined();
});
