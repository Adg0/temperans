import { DailyLog, HabitSession, HabitSource, ImportedTypingResult } from "./types";

/**
 * Storage v3 is deliberately top-level and uniform. Each task owns one YAML
 * map, including its value, provenance, and task-specific details.
 */
export const DAILY_LOG_SCHEMA_VERSION = 3;

const OWNED_TOP_LEVEL_KEYS = new Set([
  // v3 envelope
  "temperans", "temperans_schema", "date",
  // v1 nested schema
  "metrics", "metricSources", "typing", "reading",
  // v2 flat + metadata schema
  "temperans_meta", "typing_duration_seconds", "typing_tests"
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumber(value: unknown): number {
  return Math.max(0, numberOrUndefined(value) ?? 0);
}

function optionalNote(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceOrUndefined(value: unknown): HabitSource | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_\s-]{1,64}$/.test(trimmed) ? trimmed : undefined;
}

function parseImportedTyping(value: unknown): ImportedTypingResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const id = typeof raw.id === "string" ? raw.id : "";
    const timestamp = numberOrUndefined(raw.timestamp);
    if (!id || timestamp === undefined) return [];
    return [{ id, timestamp, durationSeconds: positiveNumber(raw.durationSeconds) }];
  });
}

function parseSessions(value: unknown): HabitSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) return [];
    const pages = numberOrUndefined(raw.pages);
    const chapters = numberOrUndefined(raw.chapters);
    const minutes = numberOrUndefined(raw.minutes);
    const reps = numberOrUndefined(raw.reps);
    const count = numberOrUndefined(raw.count);
    const note = typeof raw.note === "string" ? raw.note : undefined;
    return [{
      title,
      ...(pages !== undefined ? { pages } : {}),
      ...(chapters !== undefined ? { chapters } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
      ...(reps !== undefined ? { reps } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(note ? { note } : {})
    }];
  });
}

function logDate(raw: Record<string, unknown>, fallbackDate: string): string {
  return typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallbackDate;
}

export function emptyDailyLog(date: string): DailyLog {
  return {
    date,
    metrics: {},
    metricSources: {},
    metricNotes: {},
    sessions: {},
    typing: { manualTests: 0, manualDurationSeconds: 0, imported: [] },
    reading: []
  };
}

export function isTemperansHabitLog(raw: Record<string, unknown>): boolean {
  return raw.temperans === "habit-log" || asRecord(raw.temperans).type === "habit-log";
}

export function isUnifiedDailyLog(raw: Record<string, unknown>): boolean {
  return raw.temperans === "habit-log" && numberOrUndefined(raw.temperans_schema) === DAILY_LOG_SCHEMA_VERSION;
}

export function parseDailyLog(raw: Record<string, unknown>, fallbackDate: string): DailyLog {
  const date = logDate(raw, fallbackDate);
  if (isUnifiedDailyLog(raw)) return parseUnifiedDailyLog(raw, date);
  if (isFlatV2DailyLog(raw)) return parseFlatV2DailyLog(raw, date);
  return parseLegacyDailyLog(raw, date);
}

function parseUnifiedDailyLog(raw: Record<string, unknown>, date: string): DailyLog {
  const metrics: DailyLog["metrics"] = {};
  const metricSources: DailyLog["metricSources"] = {};
  const metricNotes: DailyLog["metricNotes"] = {};
  const sessions: Record<string, HabitSession[]> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (OWNED_TOP_LEVEL_KEYS.has(id)) continue;
    if (id === "typing" || id === "reading") continue;
    const habit = asRecord(entry);
    if (Array.isArray(habit.sessions)) {
      sessions[id] = parseSessions(habit.sessions);
    }
    const value = numberOrUndefined(habit.value);
    if (value !== undefined) metrics[id] = Math.max(0, value);
    const source = sourceOrUndefined(habit.source);
    if (source) metricSources[id] = source;
    const note = optionalNote(habit.note);
    if (note) metricNotes[id] = note;
  }
  const typing = asRecord(raw.typing);
  const reading = asRecord(raw.reading);
  const typingNote = optionalNote(typing.note);
  const typingSourceVal = sourceOrUndefined(typing.source);
  if (typingSourceVal) {
    metricSources.typing = typingSourceVal;
  }
  const readingSource = sourceOrUndefined(reading.source);
  if (readingSource) metricSources.reading = readingSource;
  if (numberOrUndefined(reading.value) !== undefined) metrics.reading = positiveNumber(reading.value);
  const typingImported = parseImportedTyping(typing.imported);
  if (typingSourceVal || positiveNumber(typing.value) || typingImported.length) {
    metrics.typing = numberOrUndefined(typing.metric_value) ?? Math.round((positiveNumber(typing.value) + typingImported.reduce((sum, item) => sum + item.durationSeconds, 0)) / 60);
    if (!typingSourceVal && positiveNumber(typing.value)) metricSources.typing = "manual";
  }
  const readingSessions = parseSessions(reading.sessions);
  if (readingSessions.length) sessions.reading = readingSessions;

  return {
    date,
    metrics,
    metricSources,
    metricNotes,
    sessions,
    typing: {
      manualTests: positiveNumber(typing.tests),
      manualDurationSeconds: positiveNumber(typing.value),
      imported: parseImportedTyping(typing.imported),
      ...(typingNote ? { note: typingNote } : {})
    },
    reading: readingSessions
  };
}

/** Supports every v2 log already written before explicit migration. */
function isFlatV2DailyLog(raw: Record<string, unknown>): boolean {
  return numberOrUndefined(asRecord(raw.temperans_meta).schema_version) === 2;
}

function parseFlatV2DailyLog(raw: Record<string, unknown>, date: string): DailyLog {
  const meta = asRecord(raw.temperans_meta);
  const sources = asRecord(meta.sources);
  const metrics: DailyLog["metrics"] = {};
  const metricSources: DailyLog["metricSources"] = {};
  for (const [id, value] of Object.entries(raw)) {
    if (OWNED_TOP_LEVEL_KEYS.has(id)) continue;
    const number = numberOrUndefined(value);
    if (number === undefined) continue;
    metrics[id] = Math.max(0, number);
    const source = sourceOrUndefined(sources[id]);
    if (source) metricSources[id] = source;
  }
  const typingMeta = asRecord(meta.typing);
  const readingSessions = parseSessions(raw.reading);
  return {
    date,
    metrics,
    metricSources,
    metricNotes: {},
    sessions: readingSessions.length ? { reading: readingSessions } : {},
    typing: {
      manualTests: positiveNumber(raw.typing_tests),
      manualDurationSeconds: positiveNumber(raw.typing_duration_seconds),
      imported: parseImportedTyping(typingMeta.imported)
    },
    reading: readingSessions
  };
}

function parseLegacyDailyLog(raw: Record<string, unknown>, date: string): DailyLog {
  const metricsRaw = asRecord(raw.metrics);
  const metrics: DailyLog["metrics"] = {};
  for (const [id, rawValue] of Object.entries(metricsRaw)) {
    const value = numberOrUndefined(rawValue);
    if (value !== undefined) metrics[id] = Math.max(0, value);
  }
  const metricSourcesRaw = asRecord(raw.metricSources);
  const metricSources: DailyLog["metricSources"] = {};
  for (const [id, value] of Object.entries(metricSourcesRaw)) {
    const source = sourceOrUndefined(value);
    if (metrics[id] !== undefined && source) metricSources[id] = source;
  }
  const typingRaw = asRecord(raw.typing);
  const readingSessions = parseSessions(raw.reading);
  return {
    date,
    metrics,
    metricSources,
    metricNotes: {},
    sessions: readingSessions.length ? { reading: readingSessions } : {},
    typing: {
      manualTests: positiveNumber(typingRaw.manualTests),
      manualDurationSeconds: positiveNumber(typingRaw.manualDurationSeconds ?? ((numberOrUndefined(typingRaw.manualMinutes) ?? 0) * 60)),
      imported: parseImportedTyping(typingRaw.imported)
    },
    reading: readingSessions
  };
}

function typingSource(log: DailyLog): HabitSource | undefined {
  if (log.metricSources.typing) return log.metricSources.typing;
  if (log.typing.imported.length > 0) return "monkeytype";
  if (log.typing.manualTests > 0 || log.typing.manualDurationSeconds > 0) return "manual";
  return undefined;
}

/** Writes uniform top-level habit maps while preserving unrelated frontmatter. */
export function serializeDailyLog(log: DailyLog, existing: Record<string, unknown>): Record<string, unknown> {
  const preserved = { ...existing };
  for (const key of OWNED_TOP_LEVEL_KEYS) delete preserved[key];
  // v2 custom habits were scalar fields, so replace them with their maps.
  for (const id of Object.keys(log.metrics)) delete preserved[id];
  if (log.sessions) {
    for (const id of Object.keys(log.sessions)) delete preserved[id];
  }

  const habits: Record<string, Record<string, unknown>> = {};
  const allHabitIds = new Set([...Object.keys(log.metrics), ...(log.sessions ? Object.keys(log.sessions) : [])]);

  for (const id of allHabitIds) {
    if (id === "typing" || id === "reading") continue;
    const value = log.metrics[id];
    const source = sourceOrUndefined(log.metricSources[id]);
    const note = optionalNote(log.metricNotes[id]);
    const habitSessions = log.sessions?.[id];
    habits[id] = {
      ...(value !== undefined ? { value } : {}),
      ...(source ? { source } : {}),
      ...(note ? { note } : {}),
      ...(habitSessions && habitSessions.length > 0 ? { sessions: habitSessions } : {})
    };
  }
  const typingSourceValue = log.metricSources.typing ?? typingSource(log);
  const typingNote = optionalNote(log.typing.note);
  habits.typing = {
    value: log.typing.manualDurationSeconds,
    value_unit: "seconds",
    ...(typingSourceValue || log.metrics.typing !== undefined ? { metric_value: log.metrics.typing ?? Math.round((log.typing.manualDurationSeconds + log.typing.imported.reduce((sum, item) => sum + item.durationSeconds, 0)) / 60) } : {}),
    tests: log.typing.manualTests,
    ...(typingSourceValue ? { source: typingSourceValue } : {}),
    ...(typingNote ? { note: typingNote } : {}),
    imported: log.typing.imported
  };
  const readingSessions = log.sessions?.reading ?? log.reading;
  habits.reading = {
    sessions: readingSessions,
    ...(log.metrics.reading !== undefined ? { value: log.metrics.reading } : {}),
    ...(log.metricSources.reading || readingSessions.length ? { source: log.metricSources.reading ?? "manual" } : {})
  };

  return {
    temperans: "habit-log",
    temperans_schema: DAILY_LOG_SCHEMA_VERSION,
    date: log.date,
    ...habits,
    ...preserved
  };
}
