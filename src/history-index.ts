import { App, TFile, TFolder } from "obsidian";
import { isTemperansHabitLog } from "./log-schema";
import { isLogDate } from "./note-paths";
import { abortable, checkAbort, isAbort, yieldToHost } from "./async";

export function indexedDate(file: TFile, frontmatter: Record<string, unknown>): string | null {
  const date = isTemperansHabitLog(frontmatter) && isLogDate(frontmatter.date) ? frontmatter.date : file.basename;
  return isLogDate(date) ? date : null;
}

/** Lightweight discovery only. File contents are opened only when metadata is unavailable or invalidated. */
export class HistoryIndex {
  private dates = new Map<string, string | null>();
  private candidates = new Map<string, Map<string, TFile>>();
  private selected = new Map<string, TFile>();
  private pending = new Map<string, { forceRead: boolean }>();
  private unverified = new Set<string>();
  private initialized = false;
  private generation = 0;
  private worker: Promise<void> | null = null;
  private stopped = false;
  private consumers = new Set<symbol>();
  constructor(private app: App, private folder: string,
    private read: (file: TFile) => Promise<Record<string, unknown>>) {}

  accepts(path: string): boolean {
    return path.startsWith(this.folder + "/") && path.endsWith(".md")
      && path !== this.folder + "/Settings.md" && path !== this.folder + "/Dashboard.md";
  }
  invalidate(path?: string): void {
    if (!path) {
      this.generation++;
      this.initialized = false;
      this.unverified.clear(); this.dates.clear(); this.candidates.clear(); this.selected.clear(); this.pending.clear();
    } else if (this.accepts(path)) {
      this.remove(path);
      // Vault modify can arrive before Obsidian's metadata update. Never reuse that stale hint.
      this.pending.set(path, { forceRead: true });
    }
  }
  remember(file: TFile, date: string | null, verified = true): void {
    this.remove(file.path);
    this.pending.delete(file.path);
    this.dates.set(file.path, date);
    if (!verified) this.unverified.add(file.path);
    if (!date) return;
    let entries = this.candidates.get(date);
    if (!entries) { entries = new Map(); this.candidates.set(date, entries); }
    entries.set(file.path, file);
    this.choose(date);
  }
  metadataChanged(file: TFile, frontmatter: Record<string, unknown>): boolean {
    return this.dates.has(file.path) && this.dates.get(file.path) !== indexedDate(file, frontmatter);
  }
  private remove(path: string): void {
    this.unverified.delete(path);
    const date = this.dates.get(path);
    this.dates.delete(path);
    if (!date) return;
    this.candidates.get(date)?.delete(path);
    this.choose(date);
  }
  private choose(date: string): void {
    const entries = this.candidates.get(date);
    if (!entries?.size) { this.candidates.delete(date); this.selected.delete(date); return; }
    const nested = this.folder + "/" + date.slice(0, 4) + "/" + date.slice(5, 7) + "/" + date + ".md";
    this.selected.set(date, entries.get(nested) ?? [...entries.values()].sort((a,b) => a.path.localeCompare(b.path))[0]);
  }
  private checkActive(): void { if (this.stopped) throw new Error("History loading was cancelled."); }
  private async reconcile(): Promise<void> {
    let lastYield = performance.now();
    while (true) {
      this.checkActive();
      if (!this.consumers.size) throw new DOMException("Loading cancelled", "AbortError");
      if (!this.initialized) {
        const generation = this.generation;
        const root = this.app.vault.getAbstractFileByPath(this.folder);
        const queue = root instanceof TFolder ? [...root.children] : [];
        for (let i = 0; i < queue.length; i++) {
          this.checkActive();
          if (!this.consumers.size) throw new DOMException("Loading cancelled", "AbortError");
          if (generation !== this.generation) break;
          const file = queue[i];
          if (file instanceof TFolder) queue.push(...file.children);
          else if (file instanceof TFile && this.accepts(file.path) && !this.dates.has(file.path) && !this.pending.has(file.path)) {
            this.pending.set(file.path, { forceRead: false });
          }
          if (performance.now() - lastYield >= 8) { await yieldToHost(); lastYield = performance.now(); }
        }
        if (generation !== this.generation) continue;
        this.initialized = true;
      }
      for (const [path, entry] of this.pending) {
        this.checkActive();
        if (!this.consumers.size) throw new DOMException("Loading cancelled", "AbortError");
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) { this.pending.delete(path); continue; }
        const generation = this.generation;
        const metadata = !entry.forceRead ? this.app.metadataCache.getFileCache(file) : null;
        const frontmatter = metadata ? metadata.frontmatter ?? {} : await this.read(file);
        this.checkActive();
        if (generation !== this.generation) break;
        if (this.pending.get(path) === entry) this.remember(file, indexedDate(file, frontmatter), !metadata);
        if (performance.now() - lastYield >= 8) { await yieldToHost(); lastYield = performance.now(); }
      }
      if (this.initialized && !this.pending.size) return;
    }
  }
  async files(signal?: AbortSignal): Promise<Map<string, TFile>> {
    checkAbort(signal); this.checkActive();
    const consumer = Symbol(); this.consumers.add(consumer);
    try {
      while (true) {
        checkAbort(signal); this.checkActive();
        if (!this.worker && (!this.initialized || this.pending.size)) {
          this.worker = this.reconcile().finally(() => { this.worker = null; });
        }
        try { await abortable(this.worker ?? Promise.resolve(), signal); }
        catch (error) { if (isAbort(error) && !signal?.aborted && !this.stopped) continue; throw error; }
        checkAbort(signal); this.checkActive();
        if (this.initialized && !this.pending.size) return this.selected;
      }
    } finally { this.consumers.delete(consumer); }
  }
  /** Before creating a date, rule out an existing custom note hidden by a stale hint. */
  async confirmForCreation(): Promise<void> {
    await this.files();
    for (const path of this.unverified) this.pending.set(path, { forceRead: true });
    await this.files();
  }
  stop(): void { this.stopped = true; this.invalidate(); }
}
