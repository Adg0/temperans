import { DailyLog } from "./types";

/** Approximate UTF-16 serialized payload budget, not a claim about exact JS heap size. */
export class LogCache {
  private entries = new Map<string, { log: DailyLog; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries = 800, private maxBytes = 16 * 1024 * 1024) {}
  get usage(): { entries: number; estimatedBytes: number } { return { entries: this.entries.size, estimatedBytes: this.bytes }; }
  get(path: string): DailyLog | undefined {
    const entry = this.entries.get(path);
    if (!entry) return;
    this.entries.delete(path); this.entries.set(path, entry);
    return entry.log;
  }
  set(path: string, log: DailyLog): void {
    this.delete(path);
    const bytes = JSON.stringify(log).length * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(path, { log, bytes }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  delete(path: string): void { this.bytes -= this.entries.get(path)?.bytes ?? 0; this.entries.delete(path); }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
