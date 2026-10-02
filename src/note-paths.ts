import { App, moment, normalizePath } from "obsidian";
import { hasInvalidPathChar } from "./paths";

export interface NotePathSettings {
  mode: "flat" | "nested" | "custom";
  format: string;
}
export const DEFAULT_NOTE_PATH: NotePathSettings = { mode: "flat", format: "YYYY-MM-DD" };

export function restoreNotePath(value: unknown): NotePathSettings {
  const raw = value && typeof value === "object" ? value as Partial<NotePathSettings> : {};
  return {
    mode: ["nested", "custom"].includes(raw.mode ?? "") ? raw.mode! : "flat",
    format: typeof raw.format === "string" && raw.format.trim() ? raw.format.trim() : DEFAULT_NOTE_PATH.format
  };
}

export function noteFormat(app: App, settings: NotePathSettings): string {
  if (settings.mode === "nested") return "YYYY/MM/YYYY-MM-DD";
  return settings.mode === "custom" ? settings.format : DEFAULT_NOTE_PATH.format;
}

export function isLogDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && moment.utc(value, "YYYY-MM-DD", true).isValid();
}

export function formattedLogPath(folder: string, date: string, format: string): string {
  if (!isLogDate(date)) throw new Error("Habit logs require a valid YYYY-MM-DD date.");
  const day = moment.utc(date, "YYYY-MM-DD", true);
  const name = day.format(format);
  const parsed = moment.utc(name, format, true);
  if (!parsed.isValid() || parsed.format("YYYY-MM-DD") !== date) {
    throw new Error("The note format must include a complete year, month, and day, such as YYYY-MM-DD.");
  }
  const segments = name.split("/");
  if (!name || segments.some(segment => !segment.trim() || segment.startsWith(".") || hasInvalidPathChar(segment) || /[. ]$/.test(segment)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new Error("The note format must produce a valid relative file path inside Habit Logs.");
  }
  return normalizePath(`${folder}/${name}.md`);
}

/** Check leap days and year boundaries as well as the live preview date. */
export function validateNoteFormat(folder: string, format: string): void {
  for (const date of ["2023-12-31", "2024-01-01", "2024-02-29", "2024-11-30", "2025-01-01"]) formattedLogPath(folder, date, format);
}
