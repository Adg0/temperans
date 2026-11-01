import { App, normalizePath } from "obsidian";
import { formatTotalVolume, formatValue } from "./dashboard/format";
import type { HabitStore } from "./data";
import type { AnalyticsSummaryData } from "./analytics-panel";

export type AnalyticsExportFormat = "json" | "csv";

function exportRows(summary: AnalyticsSummaryData) {
  return summary.habits.map(({ habit, stats }) => ({
    habitId: habit.id,
    habitName: habit.name,
    type: habit.type ?? "metric",
    cadence: habit.cadence,
    unit: habit.unit,
    totalVolume: stats.totalVolume,
    activeDays: stats.activeDays,
    eligibleDays: stats.totalDays,
    completedDays: stats.completedDays,
    partialDays: stats.partialDays,
    missedDays: stats.missedDays,
    consistencyPercent: Math.round(stats.consistencyRate * 10000) / 100,
    averageActiveDay: stats.averageActiveDays,
    ...(stats.periodAverage == null ? {} : { averageCadencePeriod: stats.periodAverage }),
    currentStreak: stats.currentStreak,
    bestStreak: stats.bestStreak,
    peakValue: stats.peakValue,
    peakDate: stats.peakDate
  }));
}

export function buildAnalyticsJson(summary: AnalyticsSummaryData): string {
  return JSON.stringify({
    format: "temperans-analytics-summary",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    period: { year: summary.year, through: summary.asOfDate, timezone: summary.timezone },
    habits: exportRows(summary)
  }, null, 2);
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAnalyticsCsv(summary: AnalyticsSummaryData): string {
  const rows = exportRows(summary);
  const columns = [
    "habitId", "habitName", "type", "cadence", "unit", "totalVolume", "activeDays", "eligibleDays",
    "completedDays", "partialDays", "missedDays", "consistencyPercent", "averageActiveDay",
    "averageCadencePeriod", "currentStreak", "bestStreak", "peakValue", "peakDate"
  ] as const;
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\r\n");
}

export function buildAnalyticsShareText(summary: AnalyticsSummaryData): string {
  const shareableHabits = summary.habits.filter(({ habit, stats }) =>
    stats.activeDays > 0 || stats.totalVolume > 0 || (habit.type === "avoidance" && stats.completedDays > 0)
  );
  const lines = shareableHabits.map(({ habit, stats }) => {
    const activeDays = `${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"}`;
    const average = `${formatValue(stats.averageActiveDays, habit.unit, habit)} / active day`;
    const consistency = `${Math.round(stats.consistencyRate * 100)}%`;
    return `• ${habit.name}: ${formatTotalVolume(stats.totalVolume, habit.unit, habit)} total · ${average} · ${activeDays} · ${consistency} consistency`;
  });
  if (!lines.length) lines.push("No habit activity recorded.");
  return [`Temperans Habits · ${summary.year} through ${summary.asOfDate}`, ...lines].join("\n");
}

export async function saveAnalyticsExport(
  app: App,
  store: HabitStore,
  summary: AnalyticsSummaryData,
  format: AnalyticsExportFormat
): Promise<string> {
  const exportFolder = normalizePath(`${store.folderPath}/Analytics Exports`);
  if (!await app.vault.adapter.exists(exportFolder)) {
    try {
      await app.vault.createFolder(exportFolder);
    } catch (error) {
      if (!await app.vault.adapter.exists(exportFolder)) throw error;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = normalizePath(`${exportFolder}/Temperans-Analytics-${summary.year}-${timestamp}.${format}`);
  const content = format === "json" ? buildAnalyticsJson(summary) : buildAnalyticsCsv(summary);
  await app.vault.create(path, content);
  if (format === "csv") {
    const metadataPath = normalizePath(`${exportFolder}/Temperans-Analytics-${summary.year}-${timestamp}.metadata.json`);
    const metadata = {
      format: "temperans-analytics-csv-metadata",
      schemaVersion: 1,
      period: { year: summary.year, through: summary.asOfDate, timezone: summary.timezone },
      dataFile: path.slice(path.lastIndexOf("/") + 1)
    };
    await app.vault.create(metadataPath, JSON.stringify(metadata, null, 2));
  }
  return path;
}

