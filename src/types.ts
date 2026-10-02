import type { NotePathSettings } from "./note-paths";
export type HabitId = string;
export type HabitUnit = string;
export type HabitCadence = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export interface TargetVersion {
  effectiveDate: string;
  min?: number;
  max?: number;
}

export type EndpointAuthType = "header" | "query" | "none";

export interface EndpointAuthConfig {
  type: EndpointAuthType;
  headerName?: string;
  paramName?: string;
  secretKey: string;
  prefix?: string;
}

export type EndpointAggregation = "sum" | "count" | "max" | "latest";
export type EndpointValueTransform = "divideBy:60" | "multiplyBy:60" | "none";

export interface EndpointResponseConfig {
  recordsPath?: string;
  dateField?: string;
  valueField?: string;
  aggregation?: EndpointAggregation;
  valueTransform?: EndpointValueTransform;
}

export interface EndpointConfig {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  auth?: EndpointAuthConfig;
  testUrl?: string;
  sourceName?: string;
  response?: EndpointResponseConfig;
}

export type HabitType = "metric" | "session" | "avoidance" | "tracker";
export type HabitDisplayFormat = "number" | "duration";

export interface HabitSession {
  title: string;
  pages?: number;
  chapters?: number;
  minutes?: number;
  reps?: number;
  count?: number;
  note?: string;
}

export type ReadingSession = HabitSession;

export interface LoggingField {
  label?: string;
  placeholder?: string;
  description?: string;
}

export interface QuickEntryConfig {
  values?: Array<number | string>;
  mode?: "add" | "set";
  showClear?: boolean;
}

export interface HabitLoggingConfig {
  amount?: LoggingField;
  remark?: LoggingField;
  title?: LoggingField;
  quickEntry?: false | QuickEntryConfig;
}

export interface HabitDefinition {
  id: HabitId;
  name: string;
  unit: HabitUnit;
  cadence: HabitCadence;
  enabled: boolean;
  type?: HabitType;
  displayFormat?: HabitDisplayFormat;
  logging?: HabitLoggingConfig;
  targetHistory: TargetVersion[];
  endpoint?: EndpointConfig;
}

export interface HabitSettings {
  timezone: string;
  habits: HabitDefinition[];
}

export interface ImportedTypingResult {
  id: string;
  timestamp: number;
  durationSeconds: number;
}

export type HabitSource = string;

/**
 * These names belong to the daily-log envelope, not to user-defined habits.
 * Custom task IDs are intentionally kept away from them so every habit can
 * stay a clear entry in the uniform top-level YAML schema.
 */
export const RESERVED_HABIT_IDS = new Set([
  "date", "temperans", "temperans_schema", "habits", "temperans-meta", "temperans-meta-sources",
  "metrics", "metric-sources", "typing_duration_seconds", "typing_tests"
]);

/** A normalized external metric record ready to be written to one daily log. */
export interface ExternalMetricImport {
  source: HabitSource;
  date: string;
  metrics: Record<string, number>;
  metricSources?: Record<string, HabitSource>;
  sessions?: Record<HabitId, HabitSession[]>;
}


export interface DailyLog {
  date: string;
  metrics: Record<HabitId, number>;
  metricSources: Partial<Record<HabitId, HabitSource>>;
  metricNotes: Partial<Record<HabitId, string>>;
  sessions: Record<HabitId, HabitSession[]>;
  typing: {
    manualTests: number;
    manualDurationSeconds: number;
    imported: ImportedTypingResult[];
    note?: string;
  };
  reading: HabitSession[];
}

export type CompletionStatus = "complete" | "partial" | "empty" | "not-applicable";

export interface HabitEvaluation {
  habit: HabitDefinition;
  target?: TargetVersion;
  value: number;
  status: CompletionStatus;
}

export interface DayEvaluation {
  date: string;
  habits: HabitEvaluation[];
  completed: number;
  eligible: number;
  score: number | null;
}

export interface PeriodEvaluation extends HabitEvaluation {
  startDate: string;
  endDate: string;
  progress: number;
}

export interface PluginState {
  healthConnectStagingPath: string;
  notePath: NotePathSettings;
  folder: string;
  lastMonkeytypeTimestamp: number;
  monkeytypeSecretName: string;
  heatmapColor: string;
  dashboardTitle: string;
  dashboardSubtitle: string;
  peerSyncPort: number;
  peerSyncRemoteUrl: string;
  peerSyncHostSecretName: string;
  peerSyncRemoteSecretName: string;
}
