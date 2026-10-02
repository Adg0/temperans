import { hasProtectedHabitEntries, StandardDataOwnershipPolicy } from "./data-ownership";
import { HistoryIndex, indexedDate } from "./history-index";
import { LogCache } from "./log-cache";
import { abortable, checkAbort, AsyncPool, yieldToHost, serialized } from "./async";
import { operationFolder } from "./paths";
import { DEFAULT_NOTE_PATH, NotePathSettings, formattedLogPath, isLogDate, noteFormat, validateNoteFormat } from "./note-paths";
import { parseLoggingConfig } from "./logging-config";
import { App, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { todayInZone } from "./date";
import { evaluateDailyLog, targetForDate, valueForHabit } from "./evaluation";
import { emptyDailyLog, isTemperansHabitLog, isUnifiedDailyLog, parseDailyLog, serializeDailyLog } from "./log-schema";
import { orderByIds } from "./habit-order";
import { decideHealthConnectWrite } from "./integrations/health-connect-ownership";
import {
  DailyLog,
  DayEvaluation,
  EndpointAggregation,
  EndpointAuthConfig,
  EndpointAuthType,
  EndpointConfig,
  EndpointResponseConfig,
  EndpointValueTransform,
  ExternalMetricImport,
  HabitCadence,
  HabitDefinition,
  HabitDisplayFormat,
  HabitId,
  HabitSession,
  HabitSettings,
  HabitType,
  RESERVED_HABIT_IDS,
  TargetVersion
} from "./types";

const SETTINGS_FILE = "Settings.md";

// Compatibility fallbacks for habits already present in older Settings.md files.
// These are never added to a new or existing user habit list automatically.
const LEGACY_HABIT_DEFAULTS: HabitDefinition[] = [
  { id: "reading", name: "Daily Reading", unit: "pages", cadence: "daily", enabled: true, type: "session", targetHistory: [{ effectiveDate: "2000-01-01", min: 15 }] },
  { id: "exercise", name: "Exercise & Workout", unit: "minutes", cadence: "daily", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 30 }] },
  { id: "hydration", name: "Hydration", unit: "ml", cadence: "daily", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 2000 }], logging: { quickEntry: { values: [100, 250, 500, 750], mode: "add", showClear: true } } },
  { id: "sleep", name: "Sleep Duration", unit: "minutes", cadence: "daily", enabled: true, displayFormat: "duration", targetHistory: [{ effectiveDate: "2000-01-01", min: 480 }] },
  { id: "no-junk-food", name: "No Junk Food", unit: "incidents", cadence: "daily", enabled: true, type: "avoidance", targetHistory: [{ effectiveDate: "2000-01-01", max: 0 }] },
  { id: "weight", name: "Body Weight", unit: "kg", cadence: "daily", enabled: true, type: "tracker", targetHistory: [{ effectiveDate: "2000-01-01" }] },
  { id: "cardio", name: "Cardio Distance", unit: "km", cadence: "weekly", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 15 }] },
  { id: "deep-work", name: "Weekly Deep Work", unit: "hours", cadence: "weekly", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 20 }] },
  { id: "quarterly-milestone", name: "Quarterly Goal Review", unit: "count", cadence: "quarterly", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 1 }] },
  { id: "annual-books", name: "Annual Books Completed", unit: "books", cadence: "annual", enabled: true, targetHistory: [{ effectiveDate: "2000-01-01", min: 12 }] },
  {
    id: "typing",
    name: "Typing practice",
    unit: "minutes",
    cadence: "daily",
    enabled: false,
    targetHistory: [{ effectiveDate: "2000-01-01", min: 15 }],
    endpoint: {
      sourceName: "monkeytype",
      url: "https://api.monkeytype.com/results?onOrAfterTimestamp={{startMillis}}&limit=1000",
      testUrl: "https://api.monkeytype.com/users/currentTestActivity",
      auth: {
        type: "header",
        headerName: "Authorization",
        secretKey: "temperans-habits-monkeytype-apekey",
        prefix: "ApeKey "
      },
      response: {
        recordsPath: "data",
        dateField: "timestamp",
        valueField: "testDuration",
        aggregation: "sum",
        valueTransform: "divideBy:60"
      }
    }
  }
];

const STARTER_NAMES: Record<string, string> = { reading: "Reading" };

/** A clean, minimal starting point with a single starter habit: Reading. Users can add, rename, or browse presets. */
export const DEFAULT_HABITS: HabitDefinition[] = LEGACY_HABIT_DEFAULTS
  .filter(habit => Object.hasOwn(STARTER_NAMES, habit.id))
  .map(habit => ({ ...habit, name: STARTER_NAMES[habit.id] }));

const CADENCES = new Set(["daily", "weekly", "monthly", "quarterly", "annual", "yearly"]);

function cloneDefaults(): HabitDefinition[] {
  return JSON.parse(JSON.stringify(DEFAULT_HABITS)) as HabitDefinition[];
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeNote(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function asTarget(value: unknown): TargetVersion | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const effectiveDate = typeof raw.effectiveDate === "string" ? raw.effectiveDate : null;
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;
  const min = numberOrUndefined(raw.min);
  const max = numberOrUndefined(raw.max);
  return { effectiveDate, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

function asEndpoint(value: unknown): EndpointConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : "";
  if (!url) return undefined;
  const method = raw.method === "POST" ? "POST" : "GET";
  const testUrl = typeof raw.testUrl === "string" && raw.testUrl.trim() ? raw.testUrl.trim() : undefined;
  const sourceName = typeof raw.sourceName === "string" && raw.sourceName.trim()
    ? raw.sourceName.trim()
    : typeof raw.source === "string" && raw.source.trim()
    ? raw.source.trim()
    : undefined;
  const authRaw = typeof raw.auth === "object" && raw.auth !== null ? raw.auth as Record<string, unknown> : undefined;
  let auth: EndpointAuthConfig | undefined;
  if (authRaw) {
    const type: EndpointAuthType = authRaw.type === "query" ? "query" : authRaw.type === "none" ? "none" : "header";
    const secretKey = typeof authRaw.secretKey === "string" ? authRaw.secretKey.trim() : "";
    if (secretKey || type === "none") {
      auth = {
        type,
        secretKey,
        ...(typeof authRaw.headerName === "string" && authRaw.headerName.trim() ? { headerName: authRaw.headerName.trim() } : {}),
        ...(typeof authRaw.paramName === "string" && authRaw.paramName.trim() ? { paramName: authRaw.paramName.trim() } : {}),
        ...(typeof authRaw.prefix === "string" ? { prefix: authRaw.prefix } : {})
      };
    }
  }
  const respRaw = typeof raw.response === "object" && raw.response !== null ? raw.response as Record<string, unknown> : undefined;
  let response: EndpointResponseConfig | undefined;
  if (respRaw) {
    const aggregation: EndpointAggregation = respRaw.aggregation === "count" || respRaw.aggregation === "max" || respRaw.aggregation === "latest"
      ? respRaw.aggregation
      : "sum";
    const valueTransform: EndpointValueTransform = respRaw.valueTransform === "divideBy:60" || respRaw.valueTransform === "multiplyBy:60"
      ? respRaw.valueTransform
      : "none";
    response = {
      ...(typeof respRaw.recordsPath === "string" ? { recordsPath: respRaw.recordsPath.trim() } : {}),
      ...(typeof respRaw.dateField === "string" ? { dateField: respRaw.dateField.trim() } : {}),
      ...(typeof respRaw.valueField === "string" ? { valueField: respRaw.valueField.trim() } : {}),
      aggregation,
      valueTransform
    };
  }
  return {
    url,
    method,
    ...(testUrl ? { testUrl } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(auth ? { auth } : {}),
    ...(response ? { response } : {})
  };
}

function asHabit(value: unknown, fallback?: HabitDefinition): HabitDefinition | null {
  if (typeof value !== "object" || value === null) return fallback ?? null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && /^[a-z0-9-]+$/.test(raw.id) ? raw.id : fallback?.id;
  if (!id) return null;
  if (!fallback && RESERVED_HABIT_IDS.has(id)) return null;
  const rawUnit = typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim().slice(0, 32) : fallback?.unit ?? "count";
  const rawCadence = typeof raw.cadence === "string" && (CADENCES.has(raw.cadence) || raw.cadence === "yearly")
    ? (raw.cadence === "yearly" ? "annual" : raw.cadence as HabitCadence)
    : fallback?.cadence ?? "daily";
  const targets = Array.isArray(raw.targetHistory)
    ? raw.targetHistory.map(asTarget).filter((target): target is TargetVersion => target !== null)
    : fallback?.targetHistory ?? [];
  const logging = parseLoggingConfig(raw.logging);
  const endpoint = asEndpoint(raw.endpoint) ?? fallback?.endpoint;
  const type: HabitType = raw.type === "avoidance" || raw.type === "tracker" || raw.type === "session" || raw.type === "metric"
    ? raw.type
    : fallback?.type ?? (id === "reading" ? "session" : "metric");
  const displayFormat: HabitDisplayFormat = raw.displayFormat === "duration" ? "duration" : fallback?.displayFormat ?? (id === "sleep" ? "duration" : "number");
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallback?.name ?? id,
    unit: rawUnit,
    cadence: rawCadence,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback?.enabled ?? true,
    type,
    displayFormat,
    ...(logging ? { logging } : {}),
    targetHistory: targets.length > 0 ? targets : fallback?.targetHistory ?? [],
    ...(endpoint ? { endpoint } : {})
  };
}

function splitFrontmatter(contents: string): { frontmatter: Record<string, unknown>; body: string; hasCorruptFrontmatter?: boolean } {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: contents, hasCorruptFrontmatter: /^---(?:\r?\n|$)/.test(contents) };
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected YAML mapping");
    return { frontmatter: parsed as Record<string, unknown>, body: match[2] ?? "" };
  } catch {
    return { frontmatter: {}, body: contents, hasCorruptFrontmatter: true };
  }
}

function renderDocument(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter)}---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

export class HabitStore {
  private cachedLogs = new LogCache();
  private readPool = new AsyncPool(4);
  private reads = new Map<string, Promise<ReturnType<typeof splitFrontmatter>>>();
  private stopped = false;
  private revision = 0;
  private historyInstance?: HistoryIndex;
  private get history(): HistoryIndex {
    return this.historyInstance ??= new HistoryIndex(this.app, this.folderPath, async file => (await this.readDocument(file)).frontmatter);
  }
  private cachedSettings: HabitSettings | null = null;


  constructor(private readonly app: App, private readonly folder: string,
    private readonly noteSettings: () => NotePathSettings = () => DEFAULT_NOTE_PATH) {}

  get dataRevision(): number { return this.revision; }

  get cacheUsage() { return this.cachedLogs.usage; }

  stop(): void { this.stopped = true; this.historyInstance?.stop(); this.reads.clear(); this.cachedLogs.clear(); }

  get folderPath(): string {
    return operationFolder(this.folder);
  }

  get settingsPath(): string {
    return normalizePath(`${this.folderPath}/${SETTINGS_FILE}`);
  }

  async ensureInitialized(): Promise<void> {
    const folderExists = this.app.vault.getAbstractFileByPath(this.folderPath) !== null
      || await this.app.vault.adapter.exists(this.folderPath);
    if (!folderExists) {
      try {
        await this.app.vault.createFolder(this.folderPath);
      } catch (err: unknown) {
        if (!(await this.app.vault.adapter.exists(this.folderPath))) throw err;
      }
    }
    const settingsExists = this.app.vault.getAbstractFileByPath(this.settingsPath) !== null
      || await this.app.vault.adapter.exists(this.settingsPath);
    if (!settingsExists) {
      const settings = { temperans: "settings", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London", habits: cloneDefaults() };
      const body = `
# Temperans Habits Settings

This file is the single source of truth for your habits, target tiers, evaluation cadences, logging modal customizations, and automated endpoints. You can edit this file directly in YAML or use the plugin settings UI.

---

## Frontmatter Reference & Customizations

### 1. Global Settings
- \`timezone\`: *(string, default: "Europe/London")* IANA timezone (e.g. \`Europe/London\`, \`America/New_York\`, \`Asia/Shanghai\`, \`UTC\`). Controls local midnight boundaries and daily streak cutoffs.

### 2. Habit Fields (\`habits:\`)
Each entry in \`habits:\` is an object defining a trackable habit:

- \`id\`: *(string, required)* Unique machine identifier (e.g. \`reading\`, \`pullups\`, \`screen-time\`, \`weight\`, \`typing\`).
- \`name\`: *(string, required)* User-facing display title shown in dashboards, heat maps, and modals.
- \`enabled\`: *(boolean, default: true)* Whether this habit is actively tracked and evaluated.
- \`type\`: *(string, default: "quantity")*
  - \`quantity\`: Standard positive build habit where higher amounts indicate progress towards a target.
  - \`avoidance\`: Negative/quitting habit (e.g. sugar, smoking, social media). Missing/0 entry counts as 100% clean day; values above \`max\` count as a slip.
  - \`tracker\`: Zero-goal metric tracker (e.g. body weight, blood pressure, mood). Missing days never penalize streaks or completion scores.
  - \`session\`: Multi-entry activity (e.g. books, workouts, coding sessions) with titles, sub-units (pages, chapters, minutes, reps), and session notes.
- \`unit\`: *(string, default: "count")* Unit of measurement. Supports standard units (\`pages\`, \`minutes\`, \`reps\`, \`steps\`, \`chapters\`, \`km\`, \`kg\`, \`kcal\`, \`hours\`, \`seconds\`, \`count\`) or any custom unit (\`pomodoros\`, \`cards\`, \`liters\`, \`glasses\`).
- \`cadence\`: *(string, default: "daily")* Goal evaluation period:
  - \`daily\`: Target evaluated every calendar day.
  - \`weekly\`: Target evaluated across Monday–Sunday weekly window.
  - \`monthly\`: Target evaluated across calendar month.
  - \`quarterly\`: Target evaluated across calendar quarter (Q1–Q4).
  - \`annual\`: Target evaluated across the entire calendar year.
- \`displayFormat\`: *(string, optional)*
  - \`duration\`: Formats integer minute values into \`H:MM\` / \`Xh Ym\` (e.g. \`7h 30m\` for sleep or focus).
  - \`number\`: Formats as standard numeric quantity.

### 3. Target History (\`targetHistory:\`)
Enables dynamic targets that change over time without altering past historical evaluation scores:
\`\`\`yaml
targetHistory:
  - effectiveDate: "2024-01-01"
    min: 15        # Minimum target needed for 100% completion
    max: 30        # Optional ceiling (for avoidance: max tolerated before slip; for build: upper cap)
  - effectiveDate: "2026-01-01"
    min: 25        # Stepped up target starting in 2026
\`\`\`

### 4. Logging Modal Customization (\`logging:\`)
Fine-tune labels, placeholders, descriptions, and 1-tap quick adjustment buttons inside the logging modal:
\`\`\`yaml
logging:
  # Primary progress amount input customization
  amount:
    label: "Practice duration"                # Custom input label
    placeholder: "30 or 0:30"                 # Custom placeholder text
    description: "Enter minutes or H:MM."     # Description text (set to "" to hide)

  # Entry remark / reflection note customization
  remark:
    label: "Reflection note"                  # Custom note label
    placeholder: "What went well today?"      # Custom placeholder text
    description: "Optional daily remark."     # Description text (set to "" to hide)

  # Session title customization (for session-type habits)
  title:
    label: "Book or Chapter"
    placeholder: "e.g. Atomic Habits"
    description: "Title of the text read."

  # 1-Tap Quick Adjustment Pills
  quickEntry:
    values: [10, 25, 50, "0:30", "1h 15m"]    # Custom button values (numbers or time strings)
    mode: add                                 # "add" (increment) or "set" (replace value directly)
    showClear: true                           # Show or hide the "Clear" button
\`\`\`
*Tip: Set \`quickEntry: false\` to hide the entire quick-entry row for that habit.*

#### Time & Duration Input Rules
Habits with time units (\`minutes\`, \`hours\`, \`seconds\`) accept:
- Raw numbers in that unit (e.g. \`90\` in a minutes habit = 90 mins; \`1.5\` in an hours habit = 1.5 hrs).
- \`H:MM\` or \`M:SS\` format (e.g. \`1:30\` = 90 minutes).
- Explicit duration strings (e.g. \`"1h 30m"\`, \`"90m"\`, \`"45s"\`).

### 5. Automated REST API Endpoints (\`endpoint:\`)
Automatically fetch daily data from external web APIs (Monkeytype, WakaTime, Duolingo, GitHub, etc.):
\`\`\`yaml
endpoint:
  url: "https://api.monkeytype.com/users/personalBests?mode=time"
  headers:
    Accept: "application/json"
  secretHeader: "Ape-Key"             # Request header key
  secretId: "monkeytype-api-key"      # Stored securely in Obsidian Secret Storage (never plain text)
  jsonPath: "data.timeTypingSeconds"  # JSON pointer or JMES path to target metric
  parser: "duration-seconds"          # duration-seconds | duration-minutes | number | count
\`\`\`

---
`;
      try {
        await this.app.vault.create(this.settingsPath, renderDocument(settings, body));
      } catch (err: unknown) {
        if (!(await this.app.vault.adapter.exists(this.settingsPath))) throw err;
      }
    }
  }

  invalidate(path?: string): void {
    this.revision++;
    this.history.invalidate(path);
    if (path) this.reads.delete(path); else this.reads.clear();
    if (!path || path === this.settingsPath) this.cachedSettings = null;
    if (!path) {
      this.cachedLogs.clear();
    } else if (path.startsWith(`${this.folderPath}/`)) {
      this.cachedLogs.delete(path);
    }
  }

  metadataChanged(file: TFile, frontmatter: Record<string, unknown>): boolean {
    if (!this.historyInstance?.metadataChanged(file, frontmatter)) return false;
    this.invalidate(file.path);
    return true;
  }

  async loadSettings(): Promise<HabitSettings> {
    if (this.cachedSettings) return this.cachedSettings;
    await this.ensureInitialized();
    const file = this.app.vault.getAbstractFileByPath(this.settingsPath);
    let contents = "";
    if (file instanceof TFile) {
      contents = await this.app.vault.read(file);
    } else if (await this.app.vault.adapter.exists(this.settingsPath)) {
      contents = await this.app.vault.adapter.read(this.settingsPath);
    } else {
      throw new Error("Temperans settings file could not be opened.");
    }
    const { frontmatter, body, hasCorruptFrontmatter } = splitFrontmatter(contents);
    if (hasCorruptFrontmatter) throw new Error("Settings.md contains invalid YAML. Fix the file before continuing.");
    const rawHabits = Array.isArray(frontmatter.habits) ? frontmatter.habits : [];
    const records = rawHabits.filter((habit): habit is Record<string, unknown> => typeof habit === "object" && habit !== null);
    let migratedSettings = false;
    const legacyPullups = records.find((habit) => habit.id === "pullups" && habit.cadence === undefined);
    const legacyTargets = legacyPullups && Array.isArray(legacyPullups.targetHistory) ? legacyPullups.targetHistory : [];
    const oldDefaultPullupTarget = legacyTargets.length === 1
      && typeof legacyTargets[0] === "object" && legacyTargets[0] !== null
      && (legacyTargets[0] as Record<string, unknown>).effectiveDate === "2000-01-01"
      && numberOrUndefined((legacyTargets[0] as Record<string, unknown>).min) === 10
      && (legacyTargets[0] as Record<string, unknown>).max === undefined;
    if (legacyPullups && oldDefaultPullupTarget) {
      legacyPullups.cadence = "weekly";
      legacyPullups.targetHistory = DEFAULT_HABITS.find((habit) => habit.id === "pullups")?.targetHistory;
      migratedSettings = true;
    }
    const legacyTyping = records.find((habit) => habit.id === "typing");
    const legacyTypingTargets = legacyTyping && Array.isArray(legacyTyping.targetHistory) ? legacyTyping.targetHistory : [];
    const oldDefaultTypingTarget = legacyTyping?.unit === "tests"
      && legacyTypingTargets.length === 1
      && typeof legacyTypingTargets[0] === "object" && legacyTypingTargets[0] !== null
      && (legacyTypingTargets[0] as Record<string, unknown>).effectiveDate === "2000-01-01"
      && numberOrUndefined((legacyTypingTargets[0] as Record<string, unknown>).min) === 1;
    if (legacyTyping && oldDefaultTypingTarget) {
      legacyTyping.unit = "minutes";
      legacyTyping.targetHistory = LEGACY_HABIT_DEFAULTS.find((habit) => habit.id === "typing")?.targetHistory;
      delete legacyTyping.typingMetric;
      migratedSettings = true;
    }
    if (migratedSettings) {
      const rendered = renderDocument(frontmatter, body);
      if (!(file instanceof TFile)) throw new Error("Wait for Settings.md to finish indexing before migration.");
      const actual = await this.app.vault.process(file, current => current === contents ? rendered : current);
      if (actual !== rendered) return this.loadSettings();
    }
    // `habits` in Settings.md is the complete source of truth for the task
    // list, display order, and logging controls. Defaults are used only when
    // creating a brand-new Settings.md (and to interpret legacy fields on a
    // task that is still present); never add a task that the user removed.
    const defaultsById = new Map(LEGACY_HABIT_DEFAULTS.map((habit) => [habit.id, habit]));
    const seen = new Set<string>();
    const habits: HabitDefinition[] = [];
    for (const record of records) {
      const rawId = typeof record.id === "string" ? record.id : undefined;
      const habit = asHabit(record, rawId ? defaultsById.get(rawId) : undefined);
      if (habit && !seen.has(habit.id)) {
        habits.push(habit);
        seen.add(habit.id);
      }
    }
    this.cachedSettings = { timezone: typeof frontmatter.timezone === "string" ? frontmatter.timezone : "Europe/London", habits };
    return this.cachedSettings;
  }

  async openSettingsFile(): Promise<TFile> {
    await this.ensureInitialized();
    const file = this.app.vault.getAbstractFileByPath(this.settingsPath);
    if (!(file instanceof TFile)) throw new Error("Temperans settings file could not be opened.");
    return file;
  }

  nestedPathFor(date: string): string {
    const year = date.slice(0, 4);
    const month = date.slice(5, 7);
    return normalizePath(`${this.folderPath}/${year}/${month}/${date}.md`);
  }

  legacyPathFor(date: string): string {
    return normalizePath(`${this.folderPath}/${date}.md`);
  }

  newPathFor(date: string): string {
    const format = noteFormat(this.app, this.noteSettings());
    validateNoteFormat(this.folderPath, format);
    return formattedLogPath(this.folderPath, date, format);
  }

  async pathFor(date: string, forWrite = false, signal?: AbortSignal): Promise<string> {
    if (forWrite && !(await this.dailyFiles()).has(date)) await this.history.confirmForCreation();
    const existing = (await this.dailyFiles(signal)).get(date);
    return existing?.path ?? this.newPathFor(date);
  }

  /** Canonical dates come from owned frontmatter, independent of filenames. */
  dailyFiles(signal?: AbortSignal): Promise<Map<string, TFile>> {
    return this.stopped ? Promise.reject(new Error("History loading was cancelled.")) : this.history.files(signal);
  }

  private readDocument(file: TFile): Promise<ReturnType<typeof splitFrontmatter>> {
    if (this.stopped) return Promise.reject(new Error("History loading was cancelled."));
    const path = file.path;
    const existing = this.reads.get(path);
    if (existing) return existing;
    const revision = this.revision;
    const promise = this.readPool.run(() => {
      if (this.stopped) throw new Error("History loading was cancelled.");
      return this.app.vault.read(file);
    }).then(contents => {
      if (this.stopped) throw new Error("History loading was cancelled.");
      const document = splitFrontmatter(contents);
      if (revision === this.revision && this.reads.get(path) === promise) {
        const date = indexedDate(file, document.frontmatter);
        if (date && !document.hasCorruptFrontmatter) this.cachedLogs.set(path, parseDailyLog(document.frontmatter, date));
      }
      return document;
    }).finally(() => { if (this.reads.get(path) === promise) this.reads.delete(path); });
    this.reads.set(path, promise);
    return promise;
  }

  async getLog(date: string, signal?: AbortSignal): Promise<DailyLog> {
    while (true) {
      checkAbort(signal);
      if (this.stopped) throw new Error("History loading was cancelled.");
      const path = await this.pathFor(date, false, signal);
      checkAbort(signal);
      const cached = this.cachedLogs.get(path);
      if (cached?.date === date) return cached;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return emptyDailyLog(date);
      const revision = this.revision;
      const pending = this.readDocument(file);
      const document = await abortable(pending, signal);
      checkAbort(signal);
      if (revision !== this.revision) continue;
      if (document.hasCorruptFrontmatter) throw new Error("Cannot read habit log: invalid YAML.");
      const actual = indexedDate(file, document.frontmatter);
      this.history.remember(file, actual);
      if (actual && actual !== date) {
        if (path === this.newPathFor(date)) throw new Error("Habit filename belongs to another date.");
        continue;
      }
      return parseDailyLog(document.frontmatter, date);
    }
  }

  private async ensureParentFolders(fullPath: string): Promise<void> {
    const parts = fullPath.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const normalized = normalizePath(current);
      const file = this.app.vault.getAbstractFileByPath(normalized);
      if (!file && !(await this.app.vault.adapter.exists(normalized))) {
        try {
          await this.app.vault.createFolder(normalized);
        } catch {
          // Ignore if created concurrently
        }
      }
    }
  }

  updateLog(date: string, update: (log: DailyLog) => DailyLog): Promise<DailyLog> {
    return serialized(this.app.vault, this.folderPath + "/" + date, async () => {
      await this.ensureInitialized();
      const path = await this.pathFor(date, true);
      let next!: DailyLog;
      const transform = (contents: string): string => {
        const { frontmatter, body, hasCorruptFrontmatter } = splitFrontmatter(contents);
        if (hasCorruptFrontmatter) throw new Error("Cannot update habit log: invalid YAML. The original file was preserved.");
        if (isLogDate(frontmatter.date) && frontmatter.date !== date) throw new Error(`Cannot save ${date}: ${path} belongs to ${frontmatter.date}.`);
        const previous = parseDailyLog(frontmatter, date);
        next = update(previous);
        if (next === previous) return contents;
        return renderDocument(serializeDailyLog(next, frontmatter), body || `\n# Habit log — ${next.date}\n`);
      };
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.process(existing, transform);
      else {
        const document = transform("");
        if (document) {
          await this.ensureParentFolders(path);
          try { await this.app.vault.create(path, document); }
          catch (error) {
            const created = this.app.vault.getAbstractFileByPath(path);
            if (!(created instanceof TFile)) throw error;
            await this.app.vault.process(created, transform);
          }
        }
      }
      this.revision++;
      this.reads.delete(path);
      const saved = this.app.vault.getAbstractFileByPath(path);
      if (saved instanceof TFile) this.history.remember(saved, date);
      this.cachedLogs.set(path, next);
      return next;
    });
  }

  async recordMetric(date: string, id: HabitId, amount: number, note?: string): Promise<DailyLog> {
    return this.updateLog(date, (log) => {
      const metricNotes = { ...log.metricNotes };
      const normalizedNote = normalizeNote(note);
      if (normalizedNote) metricNotes[id] = normalizedNote;
      else delete metricNotes[id];
      return {
        ...log,
        metrics: { ...log.metrics, [id]: Math.max(0, amount) },
        metricSources: { ...log.metricSources, [id]: "manual" },
        metricNotes
      };
    });
  }

  async addHabit(habit: HabitDefinition): Promise<void> {
    if (RESERVED_HABIT_IDS.has(habit.id)) throw new Error(`“${habit.id}” is reserved for Temperans log metadata.`);
    await this.writeHabitSettings(habits => {
      if (habits.some(item => item.id === habit.id)) throw new Error(`A task named “${habit.name}” already exists.`);
      return [...habits, habit];
    });
  }

  async updateHabit(habit: HabitDefinition): Promise<void> {
    await this.writeHabitSettings(habits => {
      if (!habits.some(item => item.id === habit.id)) throw new Error(`Task “${habit.id}” not found.`);
      return habits.map(item => item.id === habit.id ? habit : item);
    });
  }

  async deleteHabit(habitId: HabitId): Promise<void> {
    await this.writeHabitSettings(habits => habits.filter(item => item.id !== habitId));
  }

  async reorderHabits(ids: HabitId[]): Promise<void> {
    await this.writeHabitSettings(habits => orderByIds(habits, ids));
  }

  private writeHabitSettings(update: (habits: HabitDefinition[]) => HabitDefinition[]): Promise<void> {
    return serialized(this.app.vault, this.settingsPath, async () => {
      const file = await this.openSettingsFile();
      await this.app.vault.process(file, contents => {
        const { frontmatter, body, hasCorruptFrontmatter } = splitFrontmatter(contents);
        if (hasCorruptFrontmatter || !Array.isArray(frontmatter.habits)) throw new Error("Invalid Settings.md YAML or habit list. The original file was preserved.");
        const habits = frontmatter.habits.map(value => asHabit(value)).filter((h): h is HabitDefinition => h !== null);
        if (habits.length !== frontmatter.habits.length) throw new Error("Settings.md contains an invalid habit. Fix it before saving.");
        const next = update(habits);
        if (JSON.stringify(next) === JSON.stringify(habits)) return contents;
        return renderDocument({ ...frontmatter, temperans: "settings", habits: next }, body);
      });
      this.invalidate(this.settingsPath);
    });
  }

  private collectAllDailyFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    const walk = (current: TFolder) => {
      for (const child of current.children) {
        if (child instanceof TFile && child.extension === "md" && child.path !== this.settingsPath) {
          files.push(child);
        } else if (child instanceof TFolder) {
          walk(child);
        }
      }
    };
    walk(folder);
    return files;
  }

  /** Explicit, idempotent migration of only the daily notes owned by this plugin. */
  async migrateHabitLogFormat(): Promise<{ migrated: number; alreadyCurrent: number }> {
    await this.ensureInitialized();
    let migrated = 0;
    let alreadyCurrent = 0;
    const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (!(folder instanceof TFolder)) return { migrated, alreadyCurrent };
    for (const child of this.collectAllDailyFiles(folder)) {
      const contents = await this.app.vault.read(child);
      const { frontmatter } = splitFrontmatter(contents);
      if (!isTemperansHabitLog(frontmatter)) continue;
      const date = isLogDate(frontmatter.date) ? frontmatter.date : child.basename;
      if (!isLogDate(date)) continue;
      if (isUnifiedDailyLog(frontmatter)) {
        alreadyCurrent += 1;
        continue;
      }
      await serialized(this.app.vault, this.folderPath + "/" + date, async () => {
        await this.app.vault.process(child, current => {
          const latest = splitFrontmatter(current);
          if (latest.hasCorruptFrontmatter || !isTemperansHabitLog(latest.frontmatter)) throw new Error("The habit log changed during migration. Retry after checking the file.");
          const log = parseDailyLog(latest.frontmatter, date);
          return renderDocument(serializeDailyLog(log, latest.frontmatter), latest.body);
        });
        this.invalidate(child.path);
      });
      migrated += 1;
    }
    return { migrated, alreadyCurrent };
  }

  async recordManualTyping(date: string, durationSeconds: number, tests: number, note?: string): Promise<DailyLog> {
    return this.updateLog(date, (log) => {
      const normalizedNote = normalizeNote(note);
      return {
        ...log,
        metrics: { ...log.metrics, typing: Math.round(durationSeconds / 60) },
        metricSources: { ...log.metricSources, typing: "manual" },
        typing: {
          manualDurationSeconds: Math.max(0, Math.round(durationSeconds)),
          manualTests: Math.max(0, Math.round(tests)),
          // A direct manual save is deliberate, so it becomes this day’s source of truth.
          imported: [],
          ...(normalizedNote ? { note: normalizedNote } : {})
        }
      };
    });
  }

  async addSession(date: string, habitId: HabitId, session: HabitSession): Promise<DailyLog> {
    return this.updateLog(date, (log) => {
      const existing = log.sessions?.[habitId] ?? (habitId === "reading" ? log.reading : []);
      const updatedSessions = {
        ...log.sessions,
        [habitId]: [...existing, session]
      };
      return {
        ...log,
        sessions: updatedSessions,
        metricSources: { ...log.metricSources, [habitId]: "manual" },
        ...(habitId === "reading" ? { reading: updatedSessions[habitId] } : {})
      };
    });
  }

  async deleteSession(date: string, habitId: HabitId, index: number, expected?: HabitSession): Promise<DailyLog> {
    return this.updateLog(date, (log) => {
      const existing = log.sessions?.[habitId] ?? (habitId === "reading" ? log.reading : []);
      if (expected && JSON.stringify(existing[index]) !== JSON.stringify(expected)) throw new Error("The session changed. Refresh before deleting it.");
      const updatedSessions = {
        ...log.sessions,
        [habitId]: existing.filter((_, i) => i !== index)
      };
      return {
        ...log,
        sessions: updatedSessions,
        ...(habitId === "reading" ? { reading: updatedSessions[habitId] } : {})
      };
    });
  }

  async addReading(date: string, session: HabitSession): Promise<DailyLog> {
    return this.addSession(date, "reading", session);
  }

  /**
   * Shared write path for future health integrations. It deliberately keeps a
   * manually entered or previously imported metric untouched.
   */
  async fillEmptyExternalMetrics(updates: ExternalMetricImport[]): Promise<{ metricsImported: number; metricsSkipped: number }> {
    let metricsImported = 0;
    let metricsSkipped = 0;
    for (const update of updates) {
      await this.updateLog(update.date, (log) => {
        const metrics = { ...log.metrics };
        const metricSources = { ...log.metricSources };
        for (const [id, value] of Object.entries(update.metrics)) {
          if (value === undefined || !Number.isFinite(value) || value < 0) continue;
          if (Object.prototype.hasOwnProperty.call(log.metrics, id)) {
            metricsSkipped += 1;
            continue;
          }
          metrics[id] = value;
          metricSources[id] = update.source;
          metricsImported += 1;
        }
        return { ...log, metrics, metricSources };
      });
    }
    return { metricsImported, metricsSkipped };
  }

  /**
   * Health Connect and the companion are allowed to refresh only values that
   * this integration previously imported. A manual value, an older unlabelled value,
   * or another external integration always wins.
   */
  async applyHealthConnectMetrics(updates: ExternalMetricImport[]): Promise<{
    metricsImported: number;
    metricsUpdated: number;
    metricsProtected: number;
    metricsSkipped: number;
  }> {
    const settings = await this.loadSettings();
    const configured = new Set(settings.habits.filter(h => h.enabled).map(h => h.id));
    const result = { metricsImported: 0, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 };
    for (const update of updates) {
      let counts = { metricsImported: 0, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 };
      await this.updateLog(update.date, log => {
        counts = { metricsImported: 0, metricsUpdated: 0, metricsProtected: 0, metricsSkipped: 0 };
        const metrics = { ...log.metrics }, metricSources = { ...log.metricSources }, sessions = { ...log.sessions };
        let changed = false;
        for (const [id, value] of Object.entries(update.metrics)) {
          if (value === undefined || !Number.isFinite(value) || value < 0 || !configured.has(id)) { counts.metricsSkipped++; continue; }
          const source = update.metricSources?.[id] ?? update.source ?? "health-connect";
          const ownedSessions = !!log.metricSources[id] && StandardDataOwnershipPolicy.isSameSource(log.metricSources[id], source);
          const decision = hasProtectedHabitEntries(log, id, source)
            ? "protect" : decideHealthConnectWrite(log.metrics[id], log.metricSources[id], value, source);
          if (decision === "protect") { counts.metricsProtected++; continue; }
          if (decision === "import") counts.metricsImported++;
          else if (decision === "update") counts.metricsUpdated++;
          else counts.metricsSkipped++;
          if (decision !== "skip") { metrics[id] = value; metricSources[id] = source; changed = true; }
          if (update.sessions?.[id] && (decision !== "skip" || ownedSessions)) {
            sessions[id] = update.sessions[id]; changed = true;
          }
        }
        return changed ? { ...log, metrics, metricSources, sessions, reading: sessions.reading ?? log.reading } : log;
      });
      for (const key of Object.keys(result) as Array<keyof typeof result>) result[key] += counts[key];
    }
    return result;
  }

  async logsForDates(requested: Iterable<string>, signal?: AbortSignal): Promise<Map<string, DailyLog>> {
    checkAbort(signal);
    const files = await this.dailyFiles(signal);
    const dates = [...new Set(requested)].filter(date => files.has(date));
    const result = new Map<string, DailyLog>();
    let lastYield = performance.now();
    for (let i = 0; i < dates.length; i += 4) {
      checkAbort(signal);
      const batch = dates.slice(i, i + 4);
      const logs = await Promise.all(batch.map(date => this.getLog(date, signal)));
      checkAbort(signal);
      batch.forEach((date, index) => result.set(date, logs[index]));
      if (i + 4 < dates.length && performance.now() - lastYield >= 8) { await yieldToHost(); lastYield = performance.now(); }
    }
    return result;
  }

  async allLogsForYear(year: number, signal?: AbortSignal): Promise<Map<string, DailyLog>> {
    checkAbort(signal);
    await this.ensureInitialized();
    const dates = [...(await this.dailyFiles(signal)).keys()].filter(date => date.startsWith(year + "-"));
    return this.logsForDates(dates, signal);
  }

  targetFor(habit: HabitDefinition, date: string): TargetVersion | undefined {
    return targetForDate(habit, date);
  }

  valueFor(log: DailyLog, habit: HabitDefinition): number {
    return valueForHabit(log, habit);
  }

  evaluate(log: DailyLog, date: string, settings: HabitSettings): DayEvaluation {
    return evaluateDailyLog(log, date, settings);
  }

  async today(): Promise<string> {
    const settings = await this.loadSettings();
    return todayInZone(settings.timezone);
  }
}
