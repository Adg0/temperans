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
  contentType?: string;
  body?: string;
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
  startDateIso: string;
  endDateIso: string;
  nowIso: string;
  todayIso: string;
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
  const nowIso = new Date().toISOString();
  const endOfDay = `${endDate}T23:59:59Z`;
  return {
    today: endDate,
    startDate,
    endDate,
    startMillis,
    endMillis,
    startSeconds: Math.floor(startMillis / 1000),
    endSeconds: Math.floor(endMillis / 1000),
    startDateIso: `${startDate}T00:00:00Z`,
    endDateIso: endOfDay > nowIso ? nowIso : endOfDay,
    nowIso,
    todayIso: `${endDate}T00:00:00Z`
  };
}

export function interpolateTemplateString(template: string, vars: EndpointTemplateVars): string {
  return template
    .replace(/\{\{todayIso\}\}/g, vars.todayIso)
    .replace(/\{\{nowIso\}\}/g, vars.nowIso)
    .replace(/\{\{startDateIso\}\}/g, vars.startDateIso)
    .replace(/\{\{endDateIso\}\}/g, vars.endDateIso)
    .replace(/\{\{today\}\}/g, vars.today)
    .replace(/\{\{startDate\}\}/g, vars.startDate)
    .replace(/\{\{endDate\}\}/g, vars.endDate)
    .replace(/\{\{startMillis\}\}/g, String(vars.startMillis))
    .replace(/\{\{endMillis\}\}/g, String(vars.endMillis))
    .replace(/\{\{startSeconds\}\}/g, String(vars.startSeconds))
    .replace(/\{\{endSeconds\}\}/g, String(vars.endSeconds));
}

export function interpolateEndpointUrl(template: string, vars: EndpointTemplateVars): string {
  return interpolateTemplateString(template, vars);
}

export function buildEndpointBody(body: unknown, vars: EndpointTemplateVars): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    const interpolated = interpolateTemplateString(body, vars);
    const trimmed = interpolated.trim();
    if (trimmed.startsWith("query") || trimmed.startsWith("mutation")) {
      return JSON.stringify({ query: trimmed });
    }
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && "query" in parsed) {
          return JSON.stringify(parsed);
        }
      } catch {
        return JSON.stringify({ query: trimmed });
      }
    }
    return interpolated;
  }
  const json = JSON.stringify(body);
  return interpolateTemplateString(json, vars);
}

export function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  return resolveParts(obj, parts);
}

function resolveParts(current: unknown, parts: string[]): unknown {
  if (parts.length === 0) return current;
  if (current === null || current === undefined) return undefined;

  const [head, ...tail] = parts;

  if (Array.isArray(current)) {
    if (/^\d+$/.test(head)) {
      return resolveParts(current[Number(head)], tail);
    }
    if (head === "*" || head === "[]") {
      const mapped = current.map((item) => resolveParts(item, tail));
      return mapped.flat();
    }
    const mapped = current.map((item) => resolveParts((item as Record<string, unknown>)?.[head], tail));
    return mapped.flat();
  }

  if (typeof current === "object") {
    if (head === "*") {
      const values = Object.values(current as Record<string, unknown>);
      const mapped = values.map((val) => resolveParts(val, tail)).filter((v) => v !== undefined);
      if (mapped.length === 1) return mapped[0];
      return mapped.flat();
    }
    const next = (current as Record<string, unknown>)[head];
    return resolveParts(next, tail);
  }

  return undefined;
}

export function parseRecordDate(value: unknown, timezone: string, today?: string): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "{{today}}" && today) return today;
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
  const match = transform?.match(/^(divideBy|multiplyBy):(\d+(?:\.\d+)?|\.\d+)$/);
  if (match) {
    const factor = Number(match[2]);
    if (factor > 0) return match[1] === "divideBy" ? value / factor : value * factor;
  }
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
  const today = todayInZone(timezone);

  if (typeof rawArray === "string" && config?.valuePattern) {
    const dateField = config.dateField;
    const dateVal = dateField && dateField !== "{{today}}" ? resolvePath(payload, dateField) : undefined;
    const date = dateField === "{{today}}"
      ? today
      : dateField
        ? parseRecordDate(dateVal, timezone, today)
        : today;
    if (!date) return result;

    try {
      const match = new RegExp(config.valuePattern).exec(rawArray);
      const rawVal = match?.[1] ?? match?.[0];
      if (validMetricNumber(rawVal)) {
        const val = transformValue(Number(rawVal), config.valueTransform);
        const rounded = Math.round(val * 100) / 100;
        result.set(date, {
          date,
          value: rounded,
          count: 1,
          items: [{
            id: date,
            timestamp: Date.parse(`${date}T12:00:00Z`) || Date.now(),
            durationSeconds: Math.round(Number(rawVal) || 0),
            value: rounded,
            raw: { value: Number(rawVal) }
          }]
        });
      }
    } catch (err) {
      console.warn("[Temperans] Invalid endpoint valuePattern:", err);
    }
    return result;
  }

  if (!Array.isArray(rawArray)) {
    if (rawArray && typeof rawArray === "object") {
      const recordObj = rawArray as Record<string, unknown>;
      const keys = Object.keys(recordObj);
      const isDateDictionary = keys.some((key) => parseRecordDate(key, timezone, today) !== null);

      if (isDateDictionary) {
        for (const [key, item] of Object.entries(recordObj)) {
          const date = parseRecordDate(key, timezone, today);
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
      } else {
        // Single entity object (e.g. Duolingo user profile with streak)
        const dateField = config?.dateField;
        const dateVal = dateField && dateField !== "{{today}}" ? resolvePath(recordObj, dateField) : undefined;
        const date = dateField === "{{today}}"
          ? today
          : dateField
            ? parseRecordDate(dateVal, timezone, today)
            : today;
        if (!date) return result;
        const rawVal = config?.valueField ? resolvePath(recordObj, config.valueField) : (typeof recordObj === "number" ? recordObj : (recordObj as { value?: unknown })?.value);
        if (validMetricNumber(rawVal)) {
          const val = transformValue(Number(rawVal), config?.valueTransform);
          const rounded = Math.round(val * 100) / 100;
          result.set(date, {
            date,
            value: rounded,
            count: 1,
            items: [{
              id: date,
              timestamp: Date.parse(`${date}T12:00:00Z`) || Date.now(),
              durationSeconds: Math.round(Number(rawVal) || 0),
              value: rounded,
              raw: recordObj
            }]
          });
        }
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
    const rawDate = dateField === "{{today}}" ? today : resolvePath(rawRecord, dateField);
    const date = parseRecordDate(rawDate, timezone, today);
    if (!date) continue;

    const rawVal = aggregation === "count" ? 1 : (valueField ? resolvePath(rawRecord, valueField) : 1);
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
    } else if (aggregation === "average") {
      aggregated = items.reduce((sum, item) => sum + item.value, 0) / items.length;
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

function methodHasBody(method?: string): boolean {
  return Boolean(method && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()));
}

export function buildEndpointHeaders(
  config: EndpointConfig,
  secret: string | null,
  vars?: EndpointTemplateVars
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    headers[name] = vars ? interpolateTemplateString(value, vars) : value;
  }
  if (config.auth && config.auth.type === "header" && secret) {
    const headerName = config.auth.headerName?.trim() || "Authorization";
    const prefix = config.auth.prefix ?? "";
    headers[headerName] = `${prefix}${secret.trim()}`;
  }
  if (methodHasBody(config.method) && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export function buildEndpointUrl(config: EndpointConfig, vars: EndpointTemplateVars, secret: string | null): string {
  let url = interpolateEndpointUrl(config.url, vars);
  if (config.auth && config.auth.type === "query" && secret) {
    const paramName = config.auth.paramName?.trim() || "api_key";
    const parsed = new URL(url);
    parsed.searchParams.set(paramName, secret.trim());
    url = parsed.toString();
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

export function extractGraphQLError(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "errors" in (payload as Record<string, unknown>)) {
    const errors = (payload as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((e) => e.message).filter(Boolean).join("; ") || "GraphQL query error";
    }
  }
  return null;
}

function resolveTimeout(configTimeout?: number): number {
  if (typeof configTimeout === "number" && configTimeout > 0) {
    return configTimeout < 1000 ? configTimeout * 1000 : configTimeout;
  }
  return 60000;
}

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
      const parsed = new URL(url);
      parsed.searchParams.set(paramName, secret.trim());
      url = parsed.toString();
    }
    validateEndpointUrl(url);
    const headers = buildEndpointHeaders(config, secret, vars);
    const request = requester ?? requestUrl;
    if (!request) throw new Error("No HTTP requester is available.");
    const method = config.testUrl ? "GET" : (config.method || "GET");
    const body = methodHasBody(method) ? buildEndpointBody(config.body, vars) : undefined;
    const timeoutMs = resolveTimeout(config.timeout);
    const contentType = headers["Content-Type"] || headers["content-type"] || (methodHasBody(method) ? "application/json" : undefined);
    const response = await request({
      url,
      method,
      headers,
      contentType,
      body,
      throw: false,
      timeout: timeoutMs
    });
    if (response.status < 200 || response.status >= 300) {
      const errorBody = typeof response.json === "object" && response.json !== null
        ? (response.json as { message?: string; errors?: Array<{ message?: string }> })
        : undefined;
      const detail = errorBody?.message || errorBody?.errors?.map((e) => e.message).join("; ") || response.text || "";
      return { ok: false, status: response.status, error: detail || `HTTP ${response.status}` };
    }
    const gqlError = extractGraphQLError(response.json);
    if (gqlError) {
      return { ok: false, error: `GraphQL error: ${gqlError}` };
    }
    return {
      ok: true,
      status: response.status
    };
  } catch (err: unknown) {
    console.error(`[Temperans] Endpoint connection test failed:`, err);
    const detail = err instanceof Error ? `: ${err.message}` : "";
    return { ok: false, error: `Connection failed${detail}. Check the URL, credentials, and network.` };
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
  const headers = buildEndpointHeaders(habit.endpoint, secret, vars);

  const request = requester ?? requestUrl;
  if (!request) throw new Error("No HTTP requester is available.");
  const method = habit.endpoint.method || "GET";
  const body = methodHasBody(method) ? buildEndpointBody(habit.endpoint.body, vars) : undefined;
  const timeoutMs = resolveTimeout(habit.endpoint.timeout);
  const contentType = headers["Content-Type"] || headers["content-type"] || (methodHasBody(method) ? "application/json" : undefined);
  const response = await request({
    url,
    method,
    headers,
    contentType,
    body,
    timeout: timeoutMs,
    throw: false
  }).catch((err: unknown) => {
    console.error(`[Temperans] Endpoint request failed for ${habit.name}:`, err);
    const detail = err instanceof Error ? `: ${err.message}` : "";
    throw new Error(`Endpoint request failed${detail}. Check the connection, network, and credentials.`);
  });
  if (response.status < 200 || response.status >= 300) {
    const errorBody = typeof response.json === "object" && response.json !== null
      ? (response.json as { message?: string; errors?: Array<{ message?: string }> })
      : undefined;
    const detail = errorBody?.message || errorBody?.errors?.map((e) => e.message).join("; ") || response.text || "";
    const detailStr = detail ? `: ${detail}` : "";
    throw new Error(`Endpoint returned HTTP ${response.status}${detailStr}`);
  }

  const gqlError = extractGraphQLError(response.json);
  if (gqlError) {
    throw new Error(`GraphQL error: ${gqlError}`);
  }

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
