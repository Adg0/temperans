import { App, Platform } from "obsidian";
import { HabitStore } from "../data";
import { PluginState } from "../types";
import { PeerSyncClient } from "./client";
import { PeerSyncFiles } from "./files";
import { PeerSyncHostInfo, PeerSyncHostServer } from "./host";
import { PeerSyncAction, PeerSyncManifest, PeerSyncPlanItem, createPairingCode, comparePeerManifests, normalizePeerUrl } from "./protocol";

export interface PeerSyncPluginHost {
  app: App;
  state: PluginState;
  store: HabitStore;
  savePluginState(): Promise<void>;
  refreshAllDashboards(): Promise<void>;
}

export interface PeerSyncComparison {
  localManifest: PeerSyncManifest;
  remoteManifest: PeerSyncManifest;
  plan: PeerSyncPlanItem[];
}

export interface PeerSyncTransferResult {
  path: string;
  action: PeerSyncAction;
  ok: boolean;
  message: string;
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export class PeerSyncService {
  private host: PeerSyncHostServer | null = null;
  private hostInfo: PeerSyncHostInfo | null = null;

  constructor(private readonly plugin: PeerSyncPluginHost) {}

  get isDesktop(): boolean {
    return Platform.isDesktopApp;
  }

  get isHosting(): boolean {
    return this.host?.running ?? false;
  }

  get activeHostInfo(): PeerSyncHostInfo | null {
    return this.hostInfo;
  }

  get configuredPort(): number {
    return this.plugin.state.peerSyncPort;
  }

  async startHost(): Promise<PeerSyncHostInfo> {
    if (!this.isDesktop) throw new Error("A peer-sync host can only run on desktop.");
    if (!validPort(this.plugin.state.peerSyncPort)) throw new Error("Host port must be between 1024 and 65535.");
    await this.plugin.store.ensureInitialized();
    const secret = await this.ensureHostSecret();
    const files = this.createFiles();
    const host = new PeerSyncHostServer(files);
    this.hostInfo = await host.start(this.plugin.state.peerSyncPort, secret);
    this.host = host;
    return this.hostInfo;
  }

  async stopHost(): Promise<void> {
    await this.host?.stop();
    this.host = null;
    this.hostInfo = null;
  }

  async setHostPort(value: number): Promise<void> {
    if (!validPort(value)) throw new Error("Host port must be between 1024 and 65535.");
    if (this.isHosting) throw new Error("Stop the host before changing its port.");
    this.plugin.state.peerSyncPort = value;
    await this.plugin.savePluginState();
  }

  async getHostPairingCode(): Promise<string> {
    return this.ensureHostSecret();
  }

  async regenerateHostPairingCode(): Promise<string> {
    const secret = createPairingCode();
    await this.setSecret(this.plugin.state.peerSyncHostSecretName, secret);
    this.host?.setSecret(secret);
    return secret;
  }

  async getRemoteProfile(): Promise<{ url: string; secret: string }> {
    return { url: this.plugin.state.peerSyncRemoteUrl, secret: await this.getSecret(this.plugin.state.peerSyncRemoteSecretName) };
  }

  async saveRemoteProfile(url: string, secret: string): Promise<void> {
    const normalizedUrl = normalizePeerUrl(url);
    if (!normalizedUrl) throw new Error("Enter a desktop address such as http://192.168.1.20:43887.");
    if (!secret.trim()) throw new Error("Enter the pairing code shown by the desktop host.");
    this.plugin.state.peerSyncRemoteUrl = normalizedUrl;
    await this.setSecret(this.plugin.state.peerSyncRemoteSecretName, secret.trim());
    await this.plugin.savePluginState();
  }

  async forgetRemoteProfile(): Promise<void> {
    this.plugin.state.peerSyncRemoteUrl = "";
    await this.setSecret(this.plugin.state.peerSyncRemoteSecretName, "");
    await this.plugin.savePluginState();
  }

  async compare(): Promise<PeerSyncComparison> {
    await this.plugin.store.ensureInitialized();
    const files = this.createFiles();
    const client = await this.createClient();
    const [localManifest, remoteManifest] = await Promise.all([files.createManifest(), client.getManifest()]);
    return { localManifest, remoteManifest, plan: comparePeerManifests(localManifest, remoteManifest) };
  }

  async transfer(plan: PeerSyncPlanItem[], actions: Map<string, PeerSyncAction>): Promise<PeerSyncTransferResult[]> {
    const files = this.createFiles();
    const client = await this.createClient();
    const results: PeerSyncTransferResult[] = [];
    for (const item of plan) {
      const action = actions.get(item.path) ?? item.defaultAction;
      if (action === "skip" || item.status === "same") continue;
      try {
        if (action === "upload") {
          if (!item.local) throw new Error("This device no longer has the selected file.");
          const payload = await files.readPayload(item.path);
          if (payload.sha256 !== item.local.sha256) throw new Error("This device changed the file after comparison. Refresh the preview.");
          await client.upload({ ...payload, expectedDestinationSha256: item.remote?.sha256 ?? null });
        } else {
          if (!item.remote) throw new Error("The paired device no longer has the selected file.");
          const payload = await client.download(item.path);
          if (payload.sha256 !== item.remote.sha256) throw new Error("The paired device changed the file after comparison. Refresh the preview.");
          await files.writeRemotePayload(payload, item.local?.sha256 ?? null);
        }
        results.push({ path: item.path, action, ok: true, message: "Transferred." });
      } catch (error) {
        results.push({ path: item.path, action, ok: false, message: error instanceof Error ? error.message : "Transfer failed." });
      }
    }
    return results;
  }

  private createFiles(): PeerSyncFiles {
    return new PeerSyncFiles(this.plugin.app, this.plugin.store.folderPath, async (path) => {
      this.plugin.store.invalidate(path);
      await this.plugin.refreshAllDashboards();
    }, this.plugin.store);
  }

  private async createClient(): Promise<PeerSyncClient> {
    const profile = await this.getRemoteProfile();
    return new PeerSyncClient(profile.url, profile.secret);
  }

  private async ensureHostSecret(): Promise<string> {
    const current = await this.getSecret(this.plugin.state.peerSyncHostSecretName);
    if (current) return current;
    const secret = createPairingCode();
    await this.setSecret(this.plugin.state.peerSyncHostSecretName, secret);
    return secret;
  }

  private async getSecret(name: string): Promise<string> {
    const storage = this.plugin.app.secretStorage;
    if (!storage) throw new Error("Peer sync requires Obsidian Secret Storage on this device.");
    return storage.getSecret(name) ?? "";
  }

  private async setSecret(name: string, value: string): Promise<void> {
    const storage = this.plugin.app.secretStorage;
    if (!storage) throw new Error("Peer sync requires Obsidian Secret Storage on this device.");
    storage.setSecret(name, value);
  }
}
