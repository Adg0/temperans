import { requestUrl } from "obsidian";
import { hasProtectedHabitEntries } from "../data-ownership";
import { isLogDate } from "../note-paths";
import { startOfDayInZone } from "../date";
import { addDays, todayInZone } from "../date";
import { StandardDataOwnershipPolicy } from "../data-ownership";
import {
  DailyLog,
  EndpointAggregation,
  EndpointConfig,
  EndpointResponseConfig,
  EndpointValueTransform,
  HabitDefinition,
  ImportedTypingResult
} from "../types";

export interface EndpointItemData {
  id: string;
  timestamp: number;
  durationSeconds: number;
  value: number;
  raw: Record<string, unknown>;
}

export interface EndpointDailyData {
  date: string;
  value: number;
  count: number;
  items: EndpointItemData[];
}

export type HttpRequester = (params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  throw?: boolean;
  timeout?: number;
}) => Promise<{ status: number; json: unknown; text?: string }>;

export interface EndpointTemplateVars {
  today: string;
  startDate: string;
  endDate: string;
  startMillis: number;
  endMillis: number;
  startSeconds: number;
  endSeconds: number;
}

export interface EndpointSyncSummary {
  habitId: string;
  habitName: string;
  daysImported: number;
  daysUpdated: number;
  daysProtected: number;
  daysSkipped: number;
  totalValue: number;
}

export function buildTemplateVars(endDate: string, days = 7, timezone = "UTC"): EndpointTemplateVars {
  const startDate = addDays(endDate, -(days - 1));
  const startMillis = startOfDayInZone(startDate, timezone);
  const endMillis = startOfDayInZone(addDays(endDate, 1), timezone) - 1;
  return {
    today: endDate,
    startDate,
    endDate,
    startMillis,
    endMillis,
    startSeconds: Math.floor(startMillis / 1000),
    endSeconds: Math.floor(endMillis / 1000)
  };
}

export function interpolateEndpointUrl(template: string, vars: EndpointTemplateVars): string {
  return template
    .replace(/\{\{today\}\}/g, vars.today)
    .replace(/\{\{startDate\}\}/g, vars.startDate)
    .replace(/\{\{endDate\}\}/g, vars.endDate)
    .replace(/\{\{startMillis\}\}/g, String(vars.startMillis))
    .replace(/\{\{endMillis\}\}/g, String(vars.endMillis))
    .replace(/\{\{startSeconds\}\}/g, String(vars.startSeconds))
    .replace(/\{\{endSeconds\}\}/g, String(vars.endSeconds));
}

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function parseRecordDate(value: unknown, timezone: string): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isLogDate(trimmed) ? trimmed : null;
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return formatDateInZone(parsed, timezone);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // If timestamp is in seconds (< 1e11), convert to milliseconds
    const millis = value < 1e11 ? value * 1000 : value;
    return formatDateInZone(millis, timezone);
  }
  return null;
}

function formatDateInZone(timestamp: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(timestamp));
    const findPart = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
    return `${findPart("year")}-${findPart("month")}-${findPart("day")}`;
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

function validMetricNumber(value: unknown): boolean {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function transformValue(value: number, transform?: EndpointValueTransform): number {
  if (!Number.isFinite(value)) return 0;
  if (transform === "divideBy:60") return value / 60;
  if (transform === "multiplyBy:60") return value * 60;
  return value;
}

export function extractEndpointDailyData(
  payload: unknown,
  config: EndpointResponseConfig | undefined,
  timezone: string
): Map<string, EndpointDailyData> {
  const result = new Map<string, EndpointDailyData>();
  const recordsPath = config?.recordsPath ?? "";
  const rawArray = resolvePath(payload, recordsPath);

  if (!Array.isArray(rawArray)) {
    if (rawArray && typeof rawArray === "object") {
      for (const [key, item] of Object.entries(rawArray as Record<string, unknown>)) {
        const date = parseRecordDate(key, timezone);
        if (!date) continue;
        const rawVal = config?.valueField ? resolvePath(item, config.valueField) : (typeof item === "number" ? item : (item as { value?: unknown })?.value);
        if (!validMetricNumber(rawVal)) continue;
        const val = transformValue(Number(rawVal), config?.valueTransform);
        const rounded = Math.round(val * 100) / 100;
        const rawRecord = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { value: item };
        result.set(date, {
          date,
          value: rounded,
          count: 1,
          items: [{
            id: date,
            timestamp: Date.parse(`${date}T12:00:00Z`) || Date.now(),
            durationSeconds: Math.round(Number(rawVal) || 0),
            value: rounded,
            raw: rawRecord
          }]
        });
      }
    }
    return result;
  }

  const aggregation: EndpointAggregation = config?.aggregation ?? "sum";
  const dateField = config?.dateField ?? "timestamp";
  const valueField = config?.valueField ?? "value";

  const grouped = new Map<string, EndpointItemData[]>();
  for (const item of rawArray) {
    if (!item || typeof item !== "object") continue;
    const rawRecord = item as Record<string, unknown>;
    const rawDate = resolvePath(rawRecord, dateField);
    const date = parseRecordDate(rawDate, timezone);
    if (!date) continue;

    const rawVal = aggregation === "count" ? 1 : resolvePath(rawRecord, valueField);
    if (!validMetricNumber(rawVal)) continue;
    const num = Number(rawVal);
    const value = transformValue(Number.isFinite(num) ? num : 0, config?.valueTransform);
    const timestamp = typeof rawDate === "number"
      ? (rawDate < 1e11 ? rawDate * 1000 : rawDate)
      : Date.parse(String(rawDate)) || Date.now();
    const id = typeof rawRecord._id === "string" ? rawRecord._id
      : typeof rawRecord.id === "string" ? rawRecord.id
      : `${date}-${(grouped.get(date)?.length ?? 0) + 1}`;
    const durationSeconds = typeof rawRecord.testDuration === "number" ? rawRecord.testDuration
      : typeof rawRecord.durationSeconds === "number" ? rawRecord.durationSeconds
      : typeof rawVal === "number" ? rawVal
      : 0;

    const existing = grouped.get(date) ?? [];
    existing.push({
      id,
      timestamp,
      durationSeconds: Math.max(0, durationSeconds),
      value,
      raw: rawRecord
    });
    grouped.set(date, existing);
  }

  for (const [date, items] of grouped.entries()) {
    let aggregated = 0;
    if (aggregation === "count") {
      aggregated = items.length;
    } else if (aggregation === "max") {
      aggregated = items.reduce((max, item) => Math.max(max, item.value), 0);
    } else if (aggregation === "latest") {
      items.sort((left, right) => left.timestamp - right.timestamp);
      aggregated = items.at(-1)?.value ?? 0;
    } else {
      aggregated = items.reduce((sum, item) => sum + item.value, 0);
    }
    result.set(date, {
      date,
      value: Math.round(aggregated * 100) / 100,
      count: items.length,
      items
    });
  }

  return result;
}

export function extractEndpointDailyValues(
  payload: unknown,
  config: EndpointResponseConfig | undefined,
  timezone: string
): Map<string, number> {
  const data = extractEndpointDailyData(payload, config, timezone);
  const values = new Map<string, number>();
  for (const [date, item] of data.entries()) {
    values.set(date, item.value);
  }
  return values;
}

export function buildEndpointHeaders(config: EndpointConfig, secret: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (config.auth && config.auth.type === "header" && secret) {
    const headerName = config.auth.headerName?.trim() || "Authorization";
    const prefix = config.auth.prefix ?? "";
    headers[headerName] = `${prefix}${secret.trim()}`;
  }
  return headers;
}

export function buildEndpointUrl(config: EndpointConfig, vars: EndpointTemplateVars, secret: string | null): string {
  let url = interpolateEndpointUrl(config.url, vars);
  if (config.auth && config.auth.type === "query" && secret) {
    const paramName = config.auth.paramName?.trim() || "api_key";
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(secret.trim())}`;
  }
  return url;
}

export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.username = ""; parsed.password = ""; parsed.hash = "";
    return parsed.toString();
  } catch {
    return "Invalid URL";
  }
}

export function validateEndpointUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid endpoint URL: ${redactUrl(rawUrl)}`);
  }
  const isHttps = parsed.protocol === "https:";
  const isLocalHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (!isHttps && !isLocalHttp) {
    throw new Error(`Endpoint protocol "${parsed.protocol}" is not allowed. Only HTTPS (or HTTP on localhost/127.0.0.1) is supported.`);
  }
}

const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB

export async function testEndpointConnection(
  config: EndpointConfig,
  secret: string | null,
  today: string,
  requester?: HttpRequester,
  timezone = "UTC"
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const vars = buildTemplateVars(today, 1, timezone);
    const testUrlTemplate = config.testUrl || config.url;
    let url = interpolateEndpointUrl(testUrlTemplate, vars);
    if (config.auth && config.auth.type === "query" && secret) {
      const paramName = config.auth.paramName?.trim() || "api_key";
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(secret.trim())}`;
    }
    validateEndpointUrl(url);
    const headers = buildEndpointHeaders(config, secret);
    const request = requester ?? requestUrl;
    if (!request) throw new Error("No HTTP requester is available.");
    const response = await request({
      url,
      method: config.method || "GET",
      headers,
      throw: false,
      timeout: 15000
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status
    };
  } catch {
    return { ok: false, error: "Connection failed. Check the URL, credentials, and network." };
  }
}

export interface EndpointStoreHost {
  loadSettings(): Promise<{ timezone: string }>;
  getLog(date: string): Promise<{ metrics: Record<string, number>; metricSources: Partial<Record<string, string>> }>;
  updateLog(date: string, update: (log: DailyLog) => DailyLog): Promise<DailyLog | null>;
}

export async function syncHabitFromEndpoint(
  habit: HabitDefinition,
  store: EndpointStoreHost,
  secret: string | null,
  days = 7,
  requester?: HttpRequester
): Promise<EndpointSyncSummary> {
  if (!habit.enabled) throw new Error("Enable this habit before syncing its endpoint.");
  if (!habit.endpoint) {
    throw new Error(`The task “${habit.name}” does not have an external endpoint configured.`);
  }

  const settings = await store.loadSettings();
  const endDate = todayInZone(settings.timezone);
  const vars = buildTemplateVars(endDate, days, settings.timezone);
  const url = buildEndpointUrl(habit.endpoint, vars, secret);
  validateEndpointUrl(url);
  const headers = buildEndpointHeaders(habit.endpoint, secret);

  const request = requester ?? requestUrl;
  if (!request) throw new Error("No HTTP requester is available.");
  const response = await request({
    url,
    method: habit.endpoint.method || "GET",
    headers,
    timeout: 15000,
    throw: false
  }).catch(() => { throw new Error("Endpoint request failed. Check the connection and credentials."); });
  if (response.status < 200 || response.status >= 300) throw new Error(`Endpoint returned HTTP ${response.status}.`);

  if (new TextEncoder().encode(response.text ?? JSON.stringify(response.json)).byteLength > MAX_PAYLOAD_SIZE) {
    throw new Error(`Response payload exceeded maximum size limit (${MAX_PAYLOAD_SIZE} bytes).`);
  }

  const dailyData = extractEndpointDailyData(response.json, habit.endpoint.response, settings.timezone);

  let daysImported = 0;
  let daysUpdated = 0;
  let daysProtected = 0;
  let daysSkipped = 0;
  let totalValue = 0;

  const effectiveSource = habit.endpoint.sourceName?.trim() || "endpoint";

  for (let cursor = vars.startDate; cursor <= vars.endDate; cursor = addDays(cursor, 1)) {
    const dayData = dailyData.get(cursor);
    if (!dayData) {
      daysSkipped += 1;
      continue;
    }

    let decision: "import" | "update" | "protect" | "skip" = "skip";
    await store.updateLog(cursor, (log) => {
      decision = hasProtectedHabitEntries(log, habit.id, effectiveSource)
        ? "protect" : StandardDataOwnershipPolicy.decide({
          existingValue: log.metrics[habit.id], existingSource: log.metricSources[habit.id],
          incomingValue: dayData.value, incomingSource: effectiveSource
        });
      if (decision === "protect" || decision === "skip") return log;
      const metrics = { ...log.metrics, [habit.id]: dayData.value };
      const metricSources = { ...log.metricSources, [habit.id]: effectiveSource };
      let typing = log.typing;
      if (habit.id === "typing") {
        const importedItems: ImportedTypingResult[] = dayData.items.map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          durationSeconds: Math.round(item.durationSeconds)
        }));
        typing = {
          ...log.typing,
          manualTests: 0,
          manualDurationSeconds: 0,
          imported: importedItems
        };
      }
      return { ...log, metrics, metricSources, typing };
    });
    switch (decision as string) {
      case "import": daysImported++; totalValue += dayData.value; break;
      case "update": daysUpdated++; totalValue += dayData.value; break;
      case "protect": daysProtected++; break;
      default: daysSkipped++;
    }
  }

  return {
    habitId: habit.id,
    habitName: habit.name,
    daysImported,
    daysUpdated,
    daysProtected,
    daysSkipped,
    totalValue
  };
}
