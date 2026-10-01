import { addDays, todayInZone } from "../date";
import { ExternalMetricImport, HabitDefinition, HabitId, HabitSession, HabitSource, RESERVED_HABIT_IDS } from "../types";
import { IntegrationDescriptor } from "./contracts";

/** Versioned JSON contract shared with the Android Health Connect companion. */
export const HEALTH_CONNECT_STAGE_FILE = ".temperance-staging.json";
export const HEALTH_CONNECT_STAGE_SCHEMA_VERSION = 1;

export const HEALTH_CONNECT_INTEGRATION: IntegrationDescriptor = {
  id: "health-connect",
  name: "Health Connect",
  status: "ready",
  description: "Imports a manually exported Health Connect staging file from the vault."
};

export interface HealthConnectMetricSession {
  value: number;
  note?: string;
  title?: string;
}

export interface HealthConnectMetricValue {
  value: number;
  unit: string;
  source?: string;
  sessions?: HealthConnectMetricSession[];
}

export interface HealthConnectDailyRecord {
  date: string;
  calories?: HealthConnectMetricValue;
  hydration?: HealthConnectMetricValue;
  sleep?: HealthConnectMetricValue;
  pullups?: HealthConnectMetricValue;
  [metricId: string]: HealthConnectMetricValue | string | undefined;
}

export interface HealthConnectStagingDocument {
  schemaVersion: typeof HEALTH_CONNECT_STAGE_SCHEMA_VERSION;
  integration: "health-connect";
  generatedAt: string;
  timezone: string;
  sources: string[];
  records: HealthConnectDailyRecord[];
}

type ValidationResult =
  | { ok: true; value: HealthConnectStagingDocument }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asFiniteNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const STANDARD_METRIC_UNITS: Record<string, string> = {
  calories: "kcal",
  hydration: "ml",
  sleep: "minutes",
  pullups: "reps"
};


function canonicalUnit(unit: string): string {
  const aliases: Record<string, string> = { min: "minutes", minute: "minutes", 分钟: "minutes", 小时: "hours", h: "hours", hr: "hours", hour: "hours", s: "seconds", sec: "seconds", second: "seconds", 秒: "seconds", 次: "reps", milliliters: "ml", millilitres: "ml", liters: "L", litres: "L", l: "L", meters: "m", metres: "m", kilometers: "km" };
  return aliases[unit.trim()] ?? unit.trim();
}

function unitFactor(source: string, destination: string): number {
  source = canonicalUnit(source); destination = canonicalUnit(destination);
  if (source === destination) return 1;
  const units: Record<string, [string, number]> = { seconds: ["time", 1], minutes: ["time", 60], hours: ["time", 3600], ml: ["volume", 1], L: ["volume", 1000], m: ["distance", 1], km: ["distance", 1000], miles: ["distance", 1609.344] };
  const from = units[source], to = units[destination];
  if (from && to && from[0] === to[0]) return from[1] / to[1];
  throw new Error("Cannot import " + source + " as " + destination + ". Match the companion sync ID to a habit with compatible units. The staging file was kept.");
}

function convertAmount(value: number, factor: number): number {
  const converted = value * factor;
  if (!Number.isFinite(converted)) throw new Error("Unit conversion exceeded the supported numeric range. The staging file was kept.");
  return converted;
}

function parseSessions(rawSessions: unknown): HealthConnectMetricSession[] | undefined {
  if (!Array.isArray(rawSessions) || rawSessions.length > 1000) return undefined;
  const sessions: HealthConnectMetricSession[] = [];
  for (const item of rawSessions) {
    if (!item || typeof item !== "object") return undefined;
    const obj = item as Record<string, unknown>;
    const val = asFiniteNonNegativeNumber(obj.value);
    if (val === null) return undefined;
    const note = typeof obj.note === "string" ? obj.note.trim() : undefined;
    const title = typeof obj.title === "string" ? obj.title.trim() : undefined;
    sessions.push({
      value: val,
      ...(note ? { note } : {}),
      ...(title ? { title } : {})
    });
  }
  return sessions;
}

function parseMetric(value: unknown, expectedUnit?: string): HealthConnectMetricValue | null {
  const raw = asRecord(value);
  const unit = typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : null;
  if (!unit) return null;
  if (expectedUnit && canonicalUnit(unit) !== expectedUnit) return null;
  const amount = asFiniteNonNegativeNumber(raw.value);
  if (amount === null) return null;

  const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : undefined;
  const sessions = parseSessions(raw.sessions);
  if (raw.sessions !== undefined && sessions === undefined) return null;

  return {
    value: amount,
    unit: canonicalUnit(unit),
    ...(source ? { source } : {}),
    ...(sessions ? { sessions } : {})
  };
}

function parseRecord(value: unknown): HealthConnectDailyRecord | null {
  const raw = asRecord(value);
  const date = typeof raw.date === "string" ? raw.date : "";
  if (!isValidDate(date)) return null;

  const record: HealthConnectDailyRecord = { date };
  let metricCount = 0;

  for (const [key, val] of Object.entries(raw)) {
    if (key === "date") continue;
    const metricId = key.replace(/_/g, "-");
    if (!/^[a-z0-9-]+$/.test(metricId) || RESERVED_HABIT_IDS.has(metricId) || metricId in record) return null;
    const expectedUnit = STANDARD_METRIC_UNITS[metricId];
    const metric = parseMetric(val, expectedUnit);
    if (!metric) return null;
    record[metricId] = metric;
    metricCount += 1;
  }

  return metricCount > 0 ? record : null;
}

/** Strict validation before any vault Markdown is changed. */
export function validateHealthConnectStagingDocument(value: unknown, expectedTimezone: string, today = todayInZone(expectedTimezone)): ValidationResult {
  if (!isValidDate(today) || today > todayInZone(expectedTimezone)) return { ok: false, error: "Choose a valid recovery week ending today or earlier." };
  const raw = asRecord(value);
  if (raw.schemaVersion !== HEALTH_CONNECT_STAGE_SCHEMA_VERSION || raw.integration !== "health-connect") {
    return { ok: false, error: "This is not a supported Temperans Health Connect staging file." };
  }
  const timezone = typeof raw.timezone === "string" ? raw.timezone : "";
  if (!isValidTimezone(timezone)) return { ok: false, error: "The staging file has an invalid time zone." };
  if (timezone !== expectedTimezone) return { ok: false, error: `Health Connect export time zone (${timezone}) does not match Settings.md (${expectedTimezone}).` };
  const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : "";
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) return { ok: false, error: "The staging file has an invalid generatedAt timestamp." };
  if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > 64) return { ok: false, error: "The staging file must identify one or more Health Connect provenance sources." };
  const sources = raw.sources.filter((source): source is string => typeof source === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(source));
  if (sources.length !== raw.sources.length || new Set(sources).size !== sources.length) return { ok: false, error: "The staging file contains an invalid or duplicate Health Connect source ID." };
  if (!Array.isArray(raw.records) || raw.records.length > 7) return { ok: false, error: "The staging file contains an invalid record list." };
  const startDate = addDays(today, -6);
  const seenDates = new Set<string>();
  const records: HealthConnectDailyRecord[] = [];
  for (const value of raw.records) {
    const record = parseRecord(value);
    if (!record) return { ok: false, error: "The staging file contains an invalid daily value or unit." };
    if (record.date < startDate || record.date > today) return { ok: false, error: `The staging file contains ${record.date}, which is outside the permitted seven-day window.` };
    if (seenDates.has(record.date)) return { ok: false, error: `The staging file contains duplicate data for ${record.date}.` };
    seenDates.add(record.date);
    records.push(record);
  }
  return { ok: true, value: { schemaVersion: HEALTH_CONNECT_STAGE_SCHEMA_VERSION, integration: "health-connect", generatedAt, timezone, sources, records } };
}

export function normalizeHealthConnectRecord(
  record: HealthConnectDailyRecord,
  habits?: HabitDefinition[]
): ExternalMetricImport {
  const metrics: Record<string, number> = {};
  const metricSources: Record<string, HabitSource> = {};
  const sessions: Record<HabitId, HabitSession[]> = {};

  for (const [key, val] of Object.entries(record)) {
    if (key === "date") continue;
    if (val && typeof val === "object" && typeof (val as HealthConnectMetricValue).value === "number") {
      const metricVal = val as HealthConnectMetricValue;
      const habitDef = habits?.find((h) => h.id === key);
      const factor = habitDef ? unitFactor(metricVal.unit, habitDef.unit) : 1;
      metrics[key] = convertAmount(metricVal.value, factor);

      if (metricVal.source) {
        metricSources[key] = metricVal.source;
      }

      if (Array.isArray(metricVal.sessions)) {
        const unit = canonicalUnit(habitDef?.unit ?? metricVal.unit);
        if (habitDef && unit === "count" && (metricVal.value !== metricVal.sessions.length || metricVal.sessions.some(session => session.value !== 1))) {
          throw new Error("This Obsidian habit counts sessions. Use a quantity unit such as reps for multi-amount counter sessions. The staging file was kept.");
        }
        sessions[key] = metricVal.sessions.map((s) => {
          const valNum = convertAmount(s.value, factor);
          const noteText = s.note?.trim();
          const title = s.title?.trim() || noteText || `${habitDef?.name ?? key} session`;
          return {
            title,
            ...(unit === "minutes" || unit === "hours" || unit === "seconds" ? { minutes: convertAmount(valNum, unit === "hours" ? 60 : unit === "seconds" ? 1 / 60 : 1) }
              : unit === "reps" ? { reps: valNum }
              : unit === "pages" ? { pages: valNum }
              : unit === "chapters" ? { chapters: valNum }
              : { count: valNum }),
            ...(s.title && noteText && noteText !== title ? { note: noteText } : {})
          };
        });
      }
    }
  }

  return {
    source: "health-connect",
    date: record.date,
    metrics,
    ...(Object.keys(metricSources).length > 0 ? { metricSources } : {}),
    ...(Object.keys(sessions).length > 0 ? { sessions } : {})
  };
}
