import { DebouncedTask } from "./async";
import { operationFolder } from "./paths";
import { healthConnectStagePath } from "./integrations/health-connect";
import { HealthConnectPathControl } from "./integrations/health-connect-panel";
import { DEFAULT_NOTE_PATH, NotePathSettings, noteFormat, restoreNotePath, validateNoteFormat } from "./note-paths";
import { Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import { HabitStore } from "./data";
import { DASHBOARD_VIEW_TYPE, HabitDashboardView } from "./dashboard";
import { DASHBOARD_FILE, ensureDashboardFile } from "./dashboard/layout-loader";
import { TemperansCodeblockChild } from "./dashboard/codeblock";
import { todayInZone } from "./date";
import { HabitLogModal } from "./modals";
import { HabitAnalyticsModal } from "./analytics-modal";
import { HealthConnectImportSummary, importHealthConnectStaging, openThirdPartySyncHub } from "./integrations";
import { syncHabitFromEndpoint, testEndpointConnection } from "./integrations/endpoint-runner";
import { PeerSyncModal } from "./peer-sync/modal";
import { PeerSyncService } from "./peer-sync/service";
import { TemperansSettingTab } from "./settings";
import { HabitId, PluginState } from "./types";

const DEFAULT_STATE: PluginState = {
  folder: "Habit Logs",
  healthConnectStagingPath: "",
  notePath: { ...DEFAULT_NOTE_PATH },
  lastMonkeytypeTimestamp: 0,
  monkeytypeSecretName: "temperans-habits-monkeytype-apekey",
  heatmapColor: "#22c55e",
  dashboardTitle: "Temperans Habits",
  dashboardSubtitle: "Local habit history, stored in Markdown.",
  peerSyncPort: 43887,
  peerSyncRemoteUrl: "",
  peerSyncHostSecretName: "temperans-habits-peer-host-secret",
  peerSyncRemoteSecretName: "temperans-habits-peer-remote-secret"
};

function restoreState(value: unknown): PluginState {
  const saved = value && typeof value === "object" ? value as Partial<PluginState> : {};
  return {
    notePath: restoreNotePath(saved.notePath),
    healthConnectStagingPath: typeof saved.healthConnectStagingPath === "string" ? saved.healthConnectStagingPath : "",
    folder: typeof saved.folder === "string" && saved.folder.trim() ? saved.folder : DEFAULT_STATE.folder,
    lastMonkeytypeTimestamp: typeof saved.lastMonkeytypeTimestamp === "number" && Number.isFinite(saved.lastMonkeytypeTimestamp)
      ? saved.lastMonkeytypeTimestamp
      : DEFAULT_STATE.lastMonkeytypeTimestamp,
    monkeytypeSecretName: typeof saved.monkeytypeSecretName === "string" && saved.monkeytypeSecretName.trim()
      ? saved.monkeytypeSecretName
      : DEFAULT_STATE.monkeytypeSecretName,
    heatmapColor: typeof saved.heatmapColor === "string" && /^#[0-9a-f]{6}$/i.test(saved.heatmapColor)
      ? saved.heatmapColor
      : DEFAULT_STATE.heatmapColor,
    dashboardTitle: typeof saved.dashboardTitle === "string" && saved.dashboardTitle.trim()
      ? saved.dashboardTitle.trim()
      : DEFAULT_STATE.dashboardTitle,
    dashboardSubtitle: typeof saved.dashboardSubtitle === "string"
      ? saved.dashboardSubtitle
      : DEFAULT_STATE.dashboardSubtitle,
    peerSyncPort: typeof saved.peerSyncPort === "number" && Number.isInteger(saved.peerSyncPort) && saved.peerSyncPort >= 1024 && saved.peerSyncPort <= 65535
      ? saved.peerSyncPort
      : DEFAULT_STATE.peerSyncPort,
    peerSyncRemoteUrl: typeof saved.peerSyncRemoteUrl === "string" ? saved.peerSyncRemoteUrl : DEFAULT_STATE.peerSyncRemoteUrl,
    peerSyncHostSecretName: typeof saved.peerSyncHostSecretName === "string" && saved.peerSyncHostSecretName.trim()
      ? saved.peerSyncHostSecretName
      : DEFAULT_STATE.peerSyncHostSecretName,
    peerSyncRemoteSecretName: typeof saved.peerSyncRemoteSecretName === "string" && saved.peerSyncRemoteSecretName.trim()
      ? saved.peerSyncRemoteSecretName
      : DEFAULT_STATE.peerSyncRemoteSecretName
  };
}

export default class TemperansHabitsPlugin extends Plugin {
  state: PluginState = { ...DEFAULT_STATE };
  store!: HabitStore;
  peerSync!: PeerSyncService;
  private habitCommandIds = new Set<string>();
  private habitCommandRefresh: Promise<void> = Promise.resolve();
  private readonly refreshQueue = new DebouncedTask(async () => {
    const updates: Promise<void>[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof HabitDashboardView) updates.push(leaf.view.refresh());
    }
    for (const child of this.activeCodeblocks) updates.push(child.render());
    await Promise.all(updates);
  });
  private activeCodeblocks = new Set<TemperansCodeblockChild>();

  registerCodeblockChild(child: TemperansCodeblockChild): void {
    this.activeCodeblocks.add(child);
  }

  unregisterCodeblockChild(child: TemperansCodeblockChild): void {
    this.activeCodeblocks.delete(child);
  }

  async onload(): Promise<void> {
    let savedState: unknown = null;
    try {
      savedState = await this.loadData();
    } catch (error) {
      console.error("Temperans Habits could not read its saved state; using safe defaults.", error);
    }
    this.state = restoreState(savedState);
    this.store = new HabitStore(this.app, this.state.folder, () => this.state.notePath);
    this.peerSync = new PeerSyncService(this);
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new HabitDashboardView(leaf, this));
    this.addRibbonIcon("chart-no-axes-combined", "Open Temperans Habits", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open habit dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "log-today", name: "Log a habit today", callback: () => void this.openLogModal() });
    this.addCommand({ id: "test-monkeytype-connection", name: "Test Monkeytype ApeKey connection", callback: () => void this.testMonkeytypeConnection() });
    this.addCommand({ id: "sync-monkeytype", name: "Import last 7 days from Monkeytype", callback: () => void this.syncMonkeytype() });
    this.addCommand({ id: "migrate-habit-log-format", name: "Migrate habit-log format", callback: () => void this.migrateHabitLogFormat() });
    this.addCommand({ id: "sync-all-endpoints", name: "Sync all external endpoints", callback: () => void this.syncAllEndpoints() });
    this.addCommand({ id: "open-analytics-summary", name: "Open habit analytics summary", callback: () => this.openAnalyticsSummary() });
    this.addCommand({ id: "customize-dashboard-layout", name: "Customize dashboard layout (Dashboard.md)", callback: () => void this.openDashboardConfig() });
    this.addCommand({ id: "open-third-party-sync", name: "Open third-party sync", callback: () => this.openThirdPartySync() });
    this.addCommand({ id: "import-health-connect", name: "Import Health Connect staged data", callback: () => void this.importHealthConnect() });
    this.addCommand({ id: "open-peer-sync", name: "Open local peer sync", callback: () => this.openPeerSync() });
    this.addSettingTab(new TemperansSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("temperans-dashboard", (source, el, ctx) => {
      const child = new TemperansCodeblockChild(this.app, this, source, el, (c) => this.unregisterCodeblockChild(c));
      this.registerCodeblockChild(child);
      ctx.addChild(child);
    });

    this.registerObsidianProtocolHandler("temperans-pair", async (params) => {
      let host = params.host;
      let port = params.port ? Number(params.port) : 43887;
      let code = params.code || params.secret || "";
      let url = params.url;
      if (!url && host) {
        const cleanHost = host.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+.*$/, "").trim();
        url = `http://${cleanHost}:${port}`;
      }
      if (url && code) {
        try {
          await this.peerSync.saveRemoteProfile(url, code);
          new Notice("Temperans Habits: Paired with desktop host.");
          this.openPeerSync();
        } catch (e) {
          new Notice("Failed to pair: " + (e instanceof Error ? e.message : String(e)));
        }
      } else {
        new Notice("Invalid pairing link.");
      }
    });

    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.store.ensureInitialized();
        await this.rebuildHabitCommands();
      } catch (error) {
        console.error("Temperans Habits could not initialize Habit Logs.", error);
        new Notice("Temperans Habits started, but Habit Logs could not be initialized. Check the configured folder in plugin settings.");
      }
    });

    const react = (file: TAbstractFile | null) => {
      if (!file || !file.path.startsWith(`${this.store.folderPath}/`)) return;
      if (file instanceof TFile && file.extension !== "md") return;
      this.store.invalidate(file instanceof TFolder ? undefined : file.path);
      if (file.path === this.store.settingsPath) this.queueHabitCommandRefresh();
      void this.refreshDashboards().catch(error => { new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."); });
    };
    this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
      if (this.store.metadataChanged(file, cache.frontmatter ?? {})) {
        void this.refreshDashboards().catch(error => new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."));
      }
    }));
    this.registerEvent(this.app.vault.on("modify", react));
    this.registerEvent(this.app.vault.on("create", react));
    this.registerEvent(this.app.vault.on("delete", react));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file.path.startsWith(`${this.store.folderPath}/`) || oldPath.startsWith(`${this.store.folderPath}/`)) {
        if (file instanceof TFile && file.extension !== "md" && !oldPath.endsWith(".md")) return;
        if (file instanceof TFolder) this.store.invalidate();
        else { this.store.invalidate(oldPath); this.store.invalidate(file.path); }
        if (file.path === this.store.settingsPath || oldPath === this.store.settingsPath) this.queueHabitCommandRefresh();
        void this.refreshDashboards().catch(error => { new Notice(error instanceof Error ? error.message : "Dashboard refresh failed."); });
      }
    }));
  }

  async savePluginState(): Promise<void> {
    await this.saveData(this.state);
  }

  async setFolder(folder: string): Promise<void> {
    const nextFolder = operationFolder(folder.trim() || "Habit Logs");
    if (nextFolder === this.state.folder) return;
    await this.peerSync.stopHost();
    const previous = { folder: this.state.folder, staging: this.state.healthConnectStagingPath, store: this.store };
    const nextStore = new HabitStore(this.app, nextFolder, () => this.state.notePath);
    await nextStore.ensureInitialized();
    this.state.folder = nextFolder;
    if (previous.staging.startsWith(previous.folder + "/")) this.state.healthConnectStagingPath = nextFolder + previous.staging.slice(previous.folder.length);
    this.store = nextStore;
    try { await this.savePluginState(); }
    catch (error) { this.state.folder = previous.folder; this.state.healthConnectStagingPath = previous.staging; this.store = previous.store; throw error; }
    this.cancelHistoryConsumers();
    previous.store.stop();
    await this.rebuildHabitCommands();
    await this.refreshDashboards();
  }

  async setNotePath(settings: NotePathSettings): Promise<void> {
    const next = restoreNotePath(settings);
    validateNoteFormat(this.store.folderPath, noteFormat(this.app, next));
    this.state.notePath = next;
    this.store.invalidate();
    await this.savePluginState();
    await this.refreshDashboards();
  }

  async setHeatmapColor(color: string): Promise<void> {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    this.state.heatmapColor = color;
    await this.savePluginState();
    await this.refreshDashboards();
  }

  async setDashboardTitle(title: string): Promise<void> {
    this.state.dashboardTitle = title.trim() || DEFAULT_STATE.dashboardTitle;
    await this.savePluginState();
    await this.refreshDashboards();
  }

  async setDashboardSubtitle(subtitle: string): Promise<void> {
    this.state.dashboardSubtitle = subtitle;
    await this.savePluginState();
    await this.refreshDashboards();
  }

  async openSettingsNote(): Promise<void> {
    const file = await this.store.openSettingsFile();
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  async openDashboardConfig(): Promise<void> {
    const dashboardPath = normalizePath(`${this.store.folderPath}/${DASHBOARD_FILE}`);
    await ensureDashboardFile(this.app, this.store.folderPath);
    const file = this.app.vault.getAbstractFileByPath(dashboardPath);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
    }
  }

  async openDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async openLogModal(habitId?: HabitId): Promise<void> {
    const settings = await this.store.loadSettings();
    const habits = settings.habits.filter((habit) => habit.enabled);
    if (habitId && !habits.some((habit) => habit.id === habitId)) {
      new Notice("That task is no longer in Habit Logs/Settings.md.");
      return;
    }
    if (!habits.length) {
      new Notice("Enable at least one habit in Habit Logs/Settings.md.");
      return;
    }
    new HabitLogModal(
      this.app,
      this.store,
      todayInZone(settings.timezone),
      habits,
      habitId,
      async () => this.refreshDashboards(),
      async (id) => this.syncEndpointHabit(id)
    ).open();
  }

  async testMonkeytypeConnection(): Promise<void> {
    await this.testEndpointHabit("typing");
  }

  async syncMonkeytype(): Promise<void> {
    await this.syncEndpointHabit("typing");
  }

  async testEndpointHabit(habitId: HabitId): Promise<boolean> {
    const settings = await this.store.loadSettings();
    const habit = settings.habits.find((h) => h.id === habitId);
    if (!habit || !habit.endpoint) {
      new Notice(`No external endpoint configured for ${habitId}.`);
      return false;
    }
    const secretKey = habit.endpoint.auth?.secretKey || this.state.monkeytypeSecretName;
    const secret = await this.getSecretValue(secretKey);
    const today = todayInZone(settings.timezone);
    const result = await testEndpointConnection(habit.endpoint, secret, today, requestUrl, settings.timezone);
    if (result.ok) {
      new Notice(`Endpoint connection for ${habit.name} verified.`);
      return true;
    }
    new Notice(`Endpoint test for ${habit.name} failed (${result.error || `HTTP ${result.status}`}).`);
    return false;
  }

  async syncEndpointHabit(habitId: HabitId): Promise<void> {
    const settings = await this.store.loadSettings();
    const habit = settings.habits.find((h) => h.id === habitId);
    if (!habit || !habit.endpoint) {
      new Notice(`No external endpoint configured for ${habitId}.`);
      return;
    }
    const secretKey = habit.endpoint.auth?.secretKey || this.state.monkeytypeSecretName;
    const secret = await this.getSecretValue(secretKey);
    try {
      const summary = await syncHabitFromEndpoint(habit, this.store, secret, 7, requestUrl);
      if (summary.daysImported === 0 && summary.daysUpdated === 0) {
        new Notice(`${summary.habitName}: ${summary.daysProtected} protected, ${summary.daysSkipped} skipped. No new values written.`);
      } else {
        new Notice(`Synced ${summary.habitName}: ${summary.daysImported} imported, ${summary.daysUpdated} updated.`);
      }
      await this.refreshDashboards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      new Notice(`Sync failed for ${habit.name}: ${message}`);
    }
  }

  async syncAllEndpoints(): Promise<void> {
    const settings = await this.store.loadSettings();
    const endpointHabits = settings.habits.filter((h) => h.enabled && h.endpoint);
    if (!endpointHabits.length) {
      new Notice("No habits with external endpoints are configured in Settings.md.");
      return;
    }
    for (const habit of endpointHabits) {
      await this.syncEndpointHabit(habit.id);
    }
  }

  async reorderHabits(ids: HabitId[]): Promise<void> {
    await this.store.reorderHabits(ids);
    await this.refreshDashboards();
  }

  async migrateHabitLogFormat(): Promise<void> {
    const result = await this.store.migrateHabitLogFormat();
    await this.refreshDashboards();
    const current = result.alreadyCurrent ? ` ${result.alreadyCurrent} already used the current format.` : "";
    new Notice(`Migrated ${result.migrated} habit log${result.migrated === 1 ? "" : "s"}.${current}`);
  }

  openThirdPartySync(): void {
    openThirdPartySyncHub(this.app, this);
  }

  getHealthConnectStagingPath(): string {
    return healthConnectStagePath(this.store.folderPath, this.state.healthConnectStagingPath);
  }

  healthConnectPathControl(): HealthConnectPathControl {
    return {
      path: this.state.healthConnectStagingPath,
      defaultPath: healthConnectStagePath(this.store.folderPath),
      save: async (path) => {
        const normalized = path.trim() ? healthConnectStagePath(this.store.folderPath, path) : "";
        if (normalized === this.state.healthConnectStagingPath) return;
        const previous = this.state.healthConnectStagingPath;
        this.state.healthConnectStagingPath = normalized;
        try { await this.saveData(this.state); }
        catch (error) { this.state.healthConnectStagingPath = previous; throw error; }
      }
    };
  }

  async importHealthConnect(weekEnding?: string): Promise<HealthConnectImportSummary | null> {
    try {
      const summary = await importHealthConnectStaging(this, weekEnding);
      new Notice(`Health Connect: ${summary.imported} imported, ${summary.updated} updated, ${summary.protected} protected, ${summary.skipped} skipped. Export retained for retry.`);
      if (summary.unconfiguredMetrics && summary.unconfiguredMetrics.length > 0) {
        new Notice(`Found staged data for ${summary.unconfiguredMetrics.join(", ")}. Add matching habits in settings to track them.`);
      }
      return summary;
    } catch (error) {
      console.error("Temperans Health Connect import failed.", error);
      new Notice(error instanceof Error ? error.message : "Health Connect import failed. The staging file was kept.");
      return null;
    }
  }

  openPeerSync(): void {
    new PeerSyncModal(this.app, this.peerSync).open();
  }

  openAnalyticsSummary(): void {
    new HabitAnalyticsModal(this.app, this.store).open();
  }

  getSecretValue(secretName: string): string | null {
    if (!secretName) return null;
    return this.app.secretStorage?.getSecret(secretName) ?? null;
  }

  async getApeKey(): Promise<string | null> {
    return this.getSecretValue(this.state.monkeytypeSecretName);
  }

  async refreshAllDashboards(): Promise<void> {
    await this.refreshDashboards();
  }

  /** Rebuild direct task commands from the current Settings.md habit list. */
  private async rebuildHabitCommands(): Promise<void> {
    for (const id of this.habitCommandIds) this.removeCommand(id);
    this.habitCommandIds.clear();
    const settings = await this.store.loadSettings();
    for (const habit of settings.habits.filter((item) => item.enabled)) {
      const id = `log-${habit.id}`;
      this.addCommand({
        id,
        name: `Log ${habit.name} today`,
        callback: () => void this.openLogModal(habit.id)
      });
      this.habitCommandIds.add(id);

      if (habit.endpoint) {
        const syncId = `sync-endpoint-${habit.id}`;
        this.addCommand({
          id: syncId,
          name: `Sync ${habit.name} from endpoint`,
          callback: () => void this.syncEndpointHabit(habit.id)
        });
        this.habitCommandIds.add(syncId);
      }
    }
  }

  private queueHabitCommandRefresh(): void {
    this.habitCommandRefresh = this.habitCommandRefresh
      .catch(() => undefined)
      .then(() => this.rebuildHabitCommands())
      .catch((error: unknown) => console.error("Temperans Habits could not refresh task commands.", error));
  }

  refreshDashboards(immediate = false): Promise<void> {
    return this.refreshQueue.schedule(immediate);
  }

  private cancelHistoryConsumers(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof HabitDashboardView) leaf.view.cancelRender();
    }
    for (const child of this.activeCodeblocks) child.cancelRender();
  }

  onunload(): void {
    this.refreshQueue.stop();
    this.cancelHistoryConsumers();
    this.store?.stop();
    for (const child of this.activeCodeblocks) child.unload();
    this.activeCodeblocks.clear();
    void this.peerSync?.stopHost();
  }
}
