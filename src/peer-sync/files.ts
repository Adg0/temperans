import { serialized } from "../async";
import { App, TFile, normalizePath } from "obsidian";
import { HabitStore } from "../data";
import {
  PeerSyncFilePayload, PeerSyncManifest, PEER_SYNC_MAX_FILE_BYTES,
  bytesToBase64, decodeVerifiedPeerContent, descriptorForContent, isPeerSyncPath, logicalSyncKey, sha256ForBytes
} from "./protocol";
import { PeerSyncConflictError } from "./server-protocol";

/** Wire paths identify dates; each device resolves them using its own note layout. */
export class PeerSyncFiles {
  private readonly store: HabitStore;

  constructor(private readonly app: App, folder: string, private readonly onWrite?: (path: string) => Promise<void> | void, store?: HabitStore) {
    this.store = store ?? new HabitStore(app, folder);
  }

  async createManifest(): Promise<PeerSyncManifest> {
    const files: PeerSyncManifest["files"] = [];
    const settings = this.app.vault.getAbstractFileByPath(this.store.settingsPath);
    if (settings instanceof TFile) files.push(await descriptorForContent("Settings.md", await this.app.vault.read(settings)));
    for (const [date, file] of await this.store.dailyFiles()) {
      files.push(await descriptorForContent(`${date}.md`, await this.app.vault.read(file)));
    }
    return { version: 1, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  }

  async readPayload(relativePath: string): Promise<PeerSyncFilePayload> {
    const file = this.app.vault.getAbstractFileByPath(await this.fullPath(relativePath));
    if (!(file instanceof TFile)) throw new Error("The requested habit-log file does not exist.");
    const content = await this.app.vault.read(file);
    const descriptor = await descriptorForContent(relativePath, content);
    return { path: relativePath, contentBase64: bytesToBase64(new TextEncoder().encode(content)), sha256: descriptor.sha256 };
  }

  async writePayload(relativePath: string, contentBytes: Uint8Array, incomingSha256: string, expectedDestinationSha256: string | null): Promise<void> {
    return serialized(this.app.vault, this.store.folderPath + "/" + (relativePath === "Settings.md" ? relativePath : logicalSyncKey(relativePath)), async () => {
    const fullPath = await this.fullPath(relativePath, true);
    if (contentBytes.byteLength > PEER_SYNC_MAX_FILE_BYTES) throw new Error("The incoming file exceeds the peer-sync size limit.");
    if (await sha256ForBytes(contentBytes) !== incomingSha256) throw new Error("The incoming file checksum does not match its payload.");
    const file = this.app.vault.getAbstractFileByPath(fullPath);
    const snapshot = file instanceof TFile ? await this.app.vault.read(file) : null;
    const destinationSha256 = snapshot !== null ? (await descriptorForContent(relativePath, snapshot)).sha256 : null;
    if (destinationSha256 !== expectedDestinationSha256) throw new PeerSyncConflictError();
    const content = new TextDecoder().decode(contentBytes);
    if (file instanceof TFile) await this.app.vault.process(file, current => {
      if (current !== snapshot) throw new PeerSyncConflictError();
      return content;
    });
    else {
      await this.ensureParentFolders(fullPath);
      await this.app.vault.create(fullPath, content);
    }
    this.store.invalidate(fullPath);
    await this.onWrite?.(fullPath);
    });
  }

  private async ensureParentFolders(fullPath: string): Promise<void> {
    const parts = fullPath.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const path = normalizePath(current);
      if (!this.app.vault.getAbstractFileByPath(path) && !(await this.app.vault.adapter.exists(path))) {
        try { await this.app.vault.createFolder(path); }
        catch (error) { if (!(await this.app.vault.adapter.exists(path))) throw error; }
      }
    }
  }

  async writeRemotePayload(payload: PeerSyncFilePayload, expectedDestinationSha256: string | null): Promise<void> {
    await this.writePayload(payload.path, await decodeVerifiedPeerContent(payload.contentBase64, payload.sha256), payload.sha256, expectedDestinationSha256);
  }

  private async fullPath(relativePath: string, forWrite = false): Promise<string> {
    if (!isPeerSyncPath(relativePath)) throw new Error("This file is outside the peer-sync allowlist.");
    return relativePath === "Settings.md" ? this.store.settingsPath : this.store.pathFor(logicalSyncKey(relativePath), forWrite);
  }
}
