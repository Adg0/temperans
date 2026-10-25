import { addDays, todayInZone } from "../date";
import { ExternalMetricImport, HabitDefinition, HabitId, HabitSession, HabitSource, RESERVED_HABIT_IDS } from "../types";
import { IntegrationDescriptor } from "./contracts";

/** Companion export filenames shared with the Android app. */
export const HEALTH_CONNECT_STAGE_FILE = "habit-sync-staging.json";
export const HEALTH_CONNECT_STAGE_CSV_FILE = "habit-sync-staging.csv";
export const HEALTH_CONNECT_STAGE_SCHEMA_VERSION = 1;

export const HEALTH_CONNECT_INTEGRATION: IntegrationDescriptor = {
  id: "health-connect",
  name: "Companion data",
  status: "ready",
  description: "Imports health metrics and habit sessions from a companion JSON or CSV export."
};

export interface HealthConnectMetricSession {
  value: number;
  id?: string;
  values?: number[];
  note?: string;
  title?: string;
}

export interface HealthConnectMetricValue {
  value: number;
  unit: string;
  values?: number[];
  units?: string[];
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

function parseNumberVector(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return undefined;
  const values = value.map(asFiniteNonNegativeNumber);
  return values.every((item): item is number => item !== null) ? values : undefined;
}

function parseUnitVector(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return undefined;
  const units = value.map((item) => typeof item === "string" ? item.trim() : "");
  return units.every((item) => item.length > 0 && item.length <= 64) ? units : undefined;
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

export function canConvertUnit(source: string, destination: string): boolean {
  source = canonicalUnit(source); destination = canonicalUnit(destination);
  if (source === destination) return true;
  const units: Record<string, [string, number]> = { seconds: ["time", 1], minutes: ["time", 60], hours: ["time", 3600], ml: ["volume", 1], L: ["volume", 1000], m: ["distance", 1], km: ["distance", 1000], miles: ["distance", 1609.344] };
  const from = units[source], to = units[destination];
  return Boolean(from && to && from[0] === to[0]);
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
    const values = obj.values === undefined ? undefined : parseNumberVector(obj.values);
    if (obj.values !== undefined && (!values || values[0] !== val)) return undefined;
    const id = typeof obj.id === "string" && obj.id.trim().length <= 200 ? obj.id.trim() : undefined;
    const note = typeof obj.note === "string" ? obj.note.trim() : undefined;
    const title = typeof obj.title === "string" ? obj.title.trim() : undefined;
    sessions.push({
      value: val,
      ...(id ? { id } : {}),
      ...(values ? { values } : {}),
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

  const values = raw.values === undefined ? undefined : parseNumberVector(raw.values);
  const units = raw.units === undefined ? undefined : parseUnitVector(raw.units);
  if (raw.values !== undefined && (!values || values[0] !== amount)) return null;
  if (raw.units !== undefined && !units) return null;
  if (values && units && values.length !== units.length) return null;
  if (units && canonicalUnit(units[0]) !== canonicalUnit(unit)) return null;

  const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : undefined;
  const sessions = parseSessions(raw.sessions);
  if (raw.sessions !== undefined && sessions === undefined) return null;
  if (sessions?.some((session) => {
    if (!session.values) return false;
    return (units !== undefined && session.values.length !== units.length)
      || (values !== undefined && session.values.length !== values.length);
  })) return null;

  return {
    value: amount,
    unit: canonicalUnit(unit),
    ...(values ? { values } : {}),
    ...(units ? { units: units.map(canonicalUnit) } : {}),
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
    return { ok: false, error: "This is not a supported companion staging export." };
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

interface CsvFieldGroup {
  units: string[];
  source: string;
  rows: Array<{ values: number[]; note: string; kind?: "metric" | "session" }>;
}

function parseCsvRows(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let i = 0; i < contents.length; i += 1) {
    const char = contents[i];
    if (quoted) {
      if (char === '"' && contents[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
      } else if (char === "\n" || char === "\r") {
        row.push(field);
        field = "";
        if (row.some((value) => value.length > 0)) rows.push(row);
        row = [];
        afterQuote = false;
        if (char === "\r" && contents[i + 1] === "\n") i += 1;
      } else {
        throw new Error("The companion CSV contains characters after a quoted field.");
      }
    } else if (char === '"') {
      if (field.length > 0) throw new Error("The companion CSV contains a malformed quoted field.");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (char === "\r" && contents[i + 1] === "\n") i += 1;
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("The companion CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

/** Converts the companion's CSV export into the same validated shape as its JSON export. */
export function parseHealthConnectCsv(contents: string, timezone: string, generatedAt = new Date().toISOString()): unknown {
  const rows = parseCsvRows(contents.replace(/^\uFEFF/, ""));
  const header = rows.shift()?.map((field) => field.trim().toLowerCase());
  const expectedHeader = ["date", "metric", "value", "unit", "source", "note"];
  if (!header || header.length < 6
    || expectedHeader.some((name, index) => header[index] !== name)
    || (header.length > 6 && header[6] !== "type")) {
    throw new Error("The companion CSV must use the Date, Metric, Value, Unit, Source, Note columns, with an optional Type column.");
  }
  const dimensionStart = header.length > 6 ? 7 : 6;
  const extraColumns = header.length - dimensionStart;
  if (extraColumns < 0 || extraColumns % 2 !== 0) {
    throw new Error("The companion CSV has incomplete value and unit columns.");
  }
  for (let index = 0; index < extraColumns / 2; index += 1) {
    if (header[dimensionStart + index * 2] !== `value ${index + 2}`
      || header[dimensionStart + index * 2 + 1] !== `unit ${index + 2}`) {
      throw new Error("The companion CSV has unexpected dimension column names.");
    }
  }
  if (rows.length > 10000) throw new Error("The companion CSV contains too many rows.");

  const grouped = new Map<string, Map<string, CsvFieldGroup>>();
  const sourceIds = new Set<string>();
  for (const row of rows) {
    if (row.length !== header.length) throw new Error("The companion CSV contains a row with the wrong number of columns.");
    const date = row[0].trim();
    if (!isValidDate(date)) throw new Error(`The companion CSV contains an invalid date: ${date || "(blank)"}.`);
    const metricId = row[1].trim().replace(/_/g, "-");
    if (!/^[a-z0-9-]+$/.test(metricId) || RESERVED_HABIT_IDS.has(metricId)) {
      throw new Error(`The companion CSV contains an invalid metric ID: ${metricId || "(blank)"}.`);
    }
    const amount = asFiniteNonNegativeNumber(row[2].trim());
    if (amount === null) throw new Error(`The companion CSV contains an invalid value for ${metricId} on ${date}.`);
    const unit = row[3].trim();
    const source = row[4].trim();
    if (!unit || !source || !/^[A-Za-z0-9._-]{1,200}$/.test(source)) {
      throw new Error(`The companion CSV contains an invalid unit or source for ${metricId} on ${date}.`);
    }
    const kindTextWithDimensions = header.length > 6 ? (row[6] ?? "").trim().toLowerCase() : "";
    const kind = kindTextWithDimensions ? (kindTextWithDimensions === "metric" || kindTextWithDimensions === "session" ? kindTextWithDimensions : null) : undefined;
    if (kind === null) throw new Error(`The companion CSV contains an unsupported row type for ${metricId} on ${date}.`);
    const values = [amount];
    const units = [canonicalUnit(unit)];
    let blankDimensionSeen = false;
    for (let index = 0; index < extraColumns / 2; index += 1) {
      const valueText = row[dimensionStart + index * 2].trim();
      const unitText = row[dimensionStart + index * 2 + 1].trim();
      if (!valueText && !unitText) {
        blankDimensionSeen = true;
        continue;
      }
      const dimensionValue = asFiniteNonNegativeNumber(valueText);
      if (blankDimensionSeen || dimensionValue === null || !unitText) {
        throw new Error(`The companion CSV contains an invalid dimension for ${metricId} on ${date}.`);
      }
      values.push(dimensionValue);
      units.push(canonicalUnit(unitText));
    }
    const byMetric = grouped.get(date) ?? new Map<string, CsvFieldGroup>();
    const existing = byMetric.get(metricId);
    if (existing) {
      if (JSON.stringify(existing.units) !== JSON.stringify(units) || existing.source !== source) {
        throw new Error(`The companion CSV mixes units or sources for ${metricId} on ${date}.`);
      }
      if (existing.rows.length >= 1000) throw new Error(`The companion CSV contains too many sessions for ${metricId} on ${date}.`);
      existing.rows.push({ values, note: row[5], ...(kind ? { kind } : {}) });
    } else {
      byMetric.set(metricId, { units, source, rows: [{ values, note: row[5], ...(kind ? { kind } : {}) }] });
    }
    grouped.set(date, byMetric);
    sourceIds.add(source);
  }

  const records: HealthConnectDailyRecord[] = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => {
    const record: HealthConnectDailyRecord = { date };
    for (const [metricId, group] of metrics) {
      const explicitKinds = new Set(group.rows.map((item) => item.kind).filter((kind): kind is "metric" | "session" => Boolean(kind)));
      if (explicitKinds.size > 1) throw new Error(`The companion CSV mixes aggregate and session rows for ${metricId} on ${date}.`);
      const isSession = explicitKinds.has("session") || (explicitKinds.size === 0 && group.source === "companion");
      if (!isSession && group.rows.length > 1) throw new Error(`The companion CSV repeats aggregate metric ${metricId} on ${date}.`);
      const values = group.units.map((_, dimension) =>
        group.rows.reduce((total, item) => total + (item.values[dimension] ?? 0), 0)
      );
      const value = values[0] ?? 0;
      const sessions = isSession
        ? group.rows.map((item) => ({
          value: item.values[0],
          values: item.values,
          ...(item.note.trim() ? { note: item.note.trim() } : {})
        }))
        : undefined;
      record[metricId] = {
        value,
        unit: group.units[0],
        values,
        units: group.units,
        source: group.source,
        ...(sessions ? { sessions } : {})
      };
    }
    return record;
  });

  return {
    schemaVersion: HEALTH_CONNECT_STAGE_SCHEMA_VERSION,
    integration: "health-connect",
    generatedAt,
    timezone,
    sources: [...sourceIds].sort(),
    records
  };
}

export function normalizeHealthConnectRecord(
  record: HealthConnectDailyRecord,
  habits?: HabitDefinition[]
): ExternalMetricImport {
  const metrics: Record<string, number> = {};
  const metricSources: Record<string, HabitSource> = {};
  const metricNotes: Record<string, string> = {};
  const sessions: Record<HabitId, HabitSession[]> = {};

  for (const [key, val] of Object.entries(record)) {
    if (key === "date") continue;
    if (val && typeof val === "object" && typeof val.value === "number") {
      const metricVal = val;
      const habitDef = habits?.find((h) => h.id === key);

      let matchedDimension = 0;
      let matchedSourceUnit = metricVal.unit;
      if (habitDef) {
        if (canConvertUnit(metricVal.unit, habitDef.unit)) {
          matchedDimension = 0;
          matchedSourceUnit = metricVal.unit;
        } else if (metricVal.units && metricVal.values && metricVal.units.length > 1) {
          const fallbackIndex = metricVal.units.findIndex((u) => canConvertUnit(u, habitDef.unit));
          if (fallbackIndex >= 0) {
            matchedDimension = fallbackIndex;
            matchedSourceUnit = metricVal.units[fallbackIndex];
          }
        }
      }

      const factor = habitDef ? unitFactor(matchedSourceUnit, habitDef.unit) : 1;
      const baseValue = (matchedDimension > 0 && metricVal.values && metricVal.values[matchedDimension] !== undefined)
        ? metricVal.values[matchedDimension]
        : metricVal.value;
      metrics[key] = convertAmount(baseValue, factor);

      if (metricVal.source) {
        metricSources[key] = metricVal.source;
      }

      if (Array.isArray(metricVal.sessions) && metricVal.sessions.length > 0) {
        const unit = canonicalUnit(habitDef?.unit ?? matchedSourceUnit);
        if (habitDef && unit === "count" && (baseValue !== metricVal.sessions.length || metricVal.sessions.some(session => session.value !== 1))) {
          throw new Error("This Obsidian habit counts sessions. Use a quantity unit such as reps for multi-amount counter sessions. The staging file was kept.");
        }

        const hasMultipleDimensions = (metricVal.units?.length ?? 0) > 1
          || (metricVal.values?.length ?? 0) > 1
          || metricVal.sessions.some((session) => (session.values?.length ?? 0) > 1);
        if (metricVal.sessions.length === 1 && key !== "reading" && !hasMultipleDimensions) {
          const single = metricVal.sessions[0];
          const sessionNote = single.note?.trim();
          if (sessionNote) {
            metricNotes[key] = sessionNote;
          }
        } else {
          sessions[key] = metricVal.sessions.map((s) => {
            const rawSessionVal = (matchedDimension > 0 && s.values && s.values[matchedDimension] !== undefined)
              ? s.values[matchedDimension]
              : s.value;
            const valNum = convertAmount(rawSessionVal, factor);
            const noteText = s.note?.trim();
            const title = s.title?.trim() || noteText || `${habitDef?.name ?? key} session`;
            const sessionValues = s.values ?? [s.value];
            const sessionUnits = metricVal.units?.length === sessionValues.length ? metricVal.units : undefined;
            return {
              title,
              ...(s.id ? { id: s.id } : {}),
              ...(hasMultipleDimensions ? {
                values: sessionValues,
                ...(sessionUnits ? { units: sessionUnits } : {})
              } : {}),
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
  }

  return {
    source: "health-connect",
    date: record.date,
    metrics,
    ...(Object.keys(metricSources).length > 0 ? { metricSources } : {}),
    ...(Object.keys(metricNotes).length > 0 ? { metricNotes } : {}),
    ...(Object.keys(sessions).length > 0 ? { sessions } : {})
  };
}
