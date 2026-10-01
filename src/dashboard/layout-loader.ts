import { parseYamlSafe } from "./codeblock-parser";
import { DashboardLayoutConfig, DashboardWidgetConfig } from "./types";

export const DASHBOARD_FILE = "Dashboard.md";

export const DEFAULT_WIDGET_CONFIGS: DashboardWidgetConfig[] = [
  { widget: "header" },
  { widget: "stats" },
  { widget: "period-goals" },
  { widget: "calendar" },
  { widget: "day-detail" }
];

export function parseDashboardLayout(frontmatter: Record<string, unknown> | null | undefined): DashboardLayoutConfig {
  if (!frontmatter || typeof frontmatter !== "object") {
    return { version: 1, widgets: [...DEFAULT_WIDGET_CONFIGS] };
  }

  const rawLayout = frontmatter.layout;
  if (!Array.isArray(rawLayout)) {
    return { version: 1, widgets: [...DEFAULT_WIDGET_CONFIGS] };
  }

  const widgets: DashboardWidgetConfig[] = [];
  for (const item of rawLayout) {
    if (typeof item === "string" && item.trim()) {
      const name = item.trim();
      const widget = name === "heatmap" ? "calendar" : name;
      widgets.push({ widget });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const rawName = typeof obj.widget === "string" ? obj.widget.trim() : typeof obj.type === "string" ? obj.type.trim() : "";
      const widget = rawName === "heatmap" ? "calendar" : rawName;
      if (widget) {
        const { widget: _w, type: _t, config: nestedConfig, ...topLevelConfig } = obj;
        const config = {
          ...topLevelConfig,
          ...(nestedConfig && typeof nestedConfig === "object" ? nestedConfig : {})
        };
        widgets.push({ widget, ...(Object.keys(config).length > 0 ? { config } : {}) });
      }
    }
  }

  return {
    version: typeof frontmatter.version === "number" ? frontmatter.version : 1,
    widgets: widgets.length > 0 ? widgets : [...DEFAULT_WIDGET_CONFIGS]
  };
}

export function renderDashboardDocument(layout: DashboardLayoutConfig): string {
  const body = `
# Dashboard Configuration

Customize your habit dashboard layout by reordering, adding, removing, or configuring widgets in the frontmatter above.

---

## Layout Structure

The dashboard layout is defined as a list under \`layout:\`. Widgets are rendered on your dashboard in the exact order listed. You can reorder, duplicate, or omit any widgets.

---

## Widget Reference & Detailed Options

### 1. \`header\`
Displays the top dashboard banner, active period navigation, and action buttons.
- \`title\`: *(string)* Custom dashboard title (default: \`"Temperans Habits"\`).
- \`subtitle\`: *(string)* Custom subtitle or motivational description (default: \`"Local habit history, stored in Markdown."\`).
- \`showActions\`: *(boolean, default: true)* Shows the **Log today** CTA button and **Actions** hub button.
- \`showPeriodNav\`: *(boolean, default: true)* Shows the year/month switcher buttons (\`‹ 2026 ›\`).
- \`showFilter\`: *(boolean, default: true)* Shows the habit filter dropdown for switching between all habits and specific habits.

\`\`\`yaml
  - widget: header
    title: "Daily Habit Tracker"
    subtitle: "Consistency builds mastery"
    showActions: true
    showPeriodNav: true
    showFilter: true
\`\`\`

---

### 2. \`stats\`
Displays key consistency, volume, streak, and performance metric cards for the active period.
- \`cards\`: *(list of strings)* Select and arrange any combination of metric cards:
  - \`consistency\`: Overall daily or habit consistency percentage rate for the selected period.
  - \`completed-days\`: Count of days where habit targets were 100% achieved.
  - \`partial-days\`: Count of days with logged activity below target.
  - \`missed-days\`: Count of unlogged or missed days.
  - \`total-volume\`: Cumulative total volume across the period (pages, reps, km, hours, etc.).
  - \`active-average\`: Average volume on active/logged days or per session.
  - \`peak-day\`: Single highest volume day and date recorded.
  - \`current-streak\`: Current active consecutive daily streak.
  - \`best-streak\`: Longest streak achieved during the year.

\`\`\`yaml
  - widget: stats
    cards:
      - consistency
      - current-streak
      - best-streak
      - total-volume
      - active-average
      - peak-day
\`\`\`

---

### 3. \`calendar\` (or \`heatmap\`)
Displays the visual interactive heat map grid.
- \`mode\`: *(string, default: "auto")*
  - \`auto\`: Responsive heat map that adapts between year and month views depending on screen width.
  - \`year\`: Full 53-week GitHub-style heat map grid for the selected year.
  - \`month\`: 7x5 monthly calendar grid.
- \`showLegend\`: *(boolean, default: true)* Shows or hides the Less ... More color intensity scale.

\`\`\`yaml
  - widget: calendar
    mode: auto
    showLegend: true
\`\`\`

---

### 4. \`period-goals\`
Displays progress rings and summary bars for weekly, monthly, quarterly, and annual periodic habits.
- \`cadences\`: *(list of strings)* Specific periodic cadences to display: \`[weekly, monthly, quarterly, annual]\`. Omit or leave empty to display all configured periodic habits.

\`\`\`yaml
  - widget: period-goals
    cadences:
      - weekly
      - monthly
      - quarterly
      - annual
\`\`\`

---

### 5. \`day-detail\`
Displays detailed breakdown, logs, and multi-entry session cards for whichever heat map cell is currently clicked or active.
- \`showSessions\`: *(boolean, default: true)* Shows individual session logs with pages, chapters, minutes, and reps.
- \`showNotes\`: *(boolean, default: true)* Shows personal remarks and notes recorded for that day.

\`\`\`yaml
  - widget: day-detail
    showSessions: true
    showNotes: true
\`\`\`

---

## Automated Endpoint Integrations (in Settings.md)

Habits can be automatically populated from third-party APIs by configuring an \`endpoint:\` block inside any habit in \`Habit Logs/Settings.md\`. Secrets (API keys, personal access tokens) are stored securely in Obsidian Secret Storage and never written to plain Markdown.

When synced, the dashboard displays matching branded source icons (\`github\`, \`wakatime\`, \`duolingo\`, \`monkeytype\`, \`health-connect\`) on daily log badges.

### 1. GitHub Contributions / Commits
Tracks daily public or private contribution events.
\`\`\`yaml
  - id: "github-contributions"
    name: "GitHub Commits"
    unit: "commits"
    cadence: "daily"
    enabled: true
    targetHistory:
      - effectiveDate: "2026-01-01"
        min: 3
    endpoint:
      sourceName: "github"
      url: "https://api.github.com/users/YOUR_GITHUB_USERNAME/events"
      auth:
        type: header
        headerName: Authorization
        secretKey: "github-pat"       # Secret name stored in Obsidian Secret Storage
        prefix: "Bearer "
      response:
        recordsPath: ""              # Root JSON array
        dateField: "created_at"      # ISO 8601 timestamp string
        aggregation: count           # Counts number of events per day
\`\`\`

### 2. Duolingo Daily XP / Lessons
Tracks daily language practice XP and streak maintenance.
\`\`\`yaml
  - id: "duolingo"
    name: "Duolingo Spanish"
    unit: "xp"
    cadence: "daily"
    enabled: true
    targetHistory:
      - effectiveDate: "2026-01-01"
        min: 30
    endpoint:
      sourceName: "duolingo"
      url: "https://www.duolingo.com/2017-06-30/users/YOUR_DUOLINGO_USER_ID?fields=streakData"
      response:
        recordsPath: "streakData.currentStreak.days"
        dateField: "date"
        valueField: "gainedXp"
        aggregation: sum
\`\`\`

### 3. Monkeytype Typing Practice Time
Syncs typing practice time and aggregated test durations.
\`\`\`yaml
  - id: "typing"
    name: "Typing Practice"
    unit: "minutes"
    cadence: "daily"
    enabled: true
    targetHistory:
      - effectiveDate: "2026-01-01"
        min: 15
    endpoint:
      sourceName: "monkeytype"
      url: "https://api.monkeytype.com/results?onOrAfterTimestamp={{startMillis}}&limit=1000"
      testUrl: "https://api.monkeytype.com/users/currentTestActivity"
      auth:
        type: header
        headerName: Authorization
        secretKey: "monkeytype-api-key"
        prefix: "ApeKey "
      response:
        recordsPath: "data"
        dateField: "timestamp"
        valueField: "testDuration"
        aggregation: sum
        valueTransform: "divideBy:60"
\`\`\`

### 4. WakaTime Coding Duration
Syncs programming time across all IDEs and editors.
\`\`\`yaml
  - id: "coding"
    name: "Coding Time"
    unit: "minutes"
    cadence: "daily"
    enabled: true
    targetHistory:
      - effectiveDate: "2026-01-01"
        min: 60
    endpoint:
      sourceName: "wakatime"
      url: "https://wakatime.com/api/v1/users/current/summaries?start={{startDate}}&end={{endDate}}"
      auth:
        type: header
        headerName: Authorization
        secretKey: "wakatime-api-key"
        prefix: "Bearer "
      response:
        recordsPath: "data"
        dateField: "range.date"
        valueField: "grand_total.total_seconds"
        valueTransform: "divideBy:60"
        aggregation: sum
\`\`\`

---

## Embedding in Notes

You can embed interactive habit dashboards anywhere in your Obsidian vault using codeblocks:

\`\`\`\`markdown
\`\`\`temperans-dashboard
habit: reading
year: 2026
widgets:
  - stats
  - calendar
  - day-detail
\`\`\`
\`\`\`\`

---
`;

  return `---
temperans: dashboard
version: ${layout.version}
layout:
  - widget: header
    showActions: true
    showPeriodNav: true
  - widget: stats
    cards:
      - consistency
      - total-volume
      - active-average
      - peak-day
      - current-streak
      - best-streak
  - widget: calendar
    showLegend: true
    mode: auto
  - widget: period-goals
    cadences: [weekly, monthly, quarterly, annual]
  - widget: day-detail
    showSessions: true
    showNotes: true
---
${body}`;
}

export async function ensureDashboardFile(app: any, folderPath: string): Promise<string> {
  const dashboardPath = `${folderPath}/${DASHBOARD_FILE}`.replace(/\\/g, "/").replace(/\/+/g, "/");
  const existing = app.vault.getAbstractFileByPath(dashboardPath);
  if (existing) return dashboardPath;
  if (await app.vault.adapter.exists(dashboardPath)) return dashboardPath;

  const doc = renderDashboardDocument({ version: 1, widgets: DEFAULT_WIDGET_CONFIGS });
  try {
    await app.vault.create(dashboardPath, doc);
  } catch {
    // Ignore concurrent creation
  }
  return dashboardPath;
}

export async function loadDashboardLayout(app: any, folderPath: string): Promise<DashboardLayoutConfig> {
  const dashboardPath = `${folderPath}/${DASHBOARD_FILE}`.replace(/\\/g, "/").replace(/\/+/g, "/");
  const file = app.vault.getAbstractFileByPath(dashboardPath);
  if (file) {
    try {
      const cached = app.metadataCache.getFileCache(file);
      if (cached?.frontmatter) {
        return parseDashboardLayout(cached.frontmatter);
      }
      const contents = await app.vault.read(file);
      const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (match) {
        const parsed = parseYamlSafe(match[1]);
        return parseDashboardLayout(parsed);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        version: 1,
        widgets: [...DEFAULT_WIDGET_CONFIGS],
        error: `Could not parse ${DASHBOARD_FILE}: ${message}`
      };
    }
  }
  return { version: 1, widgets: [...DEFAULT_WIDGET_CONFIGS] };
}
