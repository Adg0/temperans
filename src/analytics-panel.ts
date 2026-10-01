import { calculateAllHabitsAnalytics } from "./analytics";
import { daysInYear, formatDate, todayInZone } from "./date";
import { formatValue } from "./dashboard/format";
import { HabitStore } from "./data";

export async function renderAnalyticsPanel(container: HTMLElement, store: HabitStore, year: number, showPeakDate = true): Promise<void> {
  const settings = await store.loadSettings();
  const today = todayInZone(settings.timezone);
  const logs = await store.allLogsForYear(year);
  const dates = daysInYear(year);

  const analyticsMap = calculateAllHabitsAnalytics(settings.habits, dates, logs, today);
  if (!analyticsMap.size) {
    container.createEl("p", { text: "No enabled habits found in Settings.md." });
    return;
  }

  const grid = container.createDiv({ cls: "temperans-analytics-grid" });

  for (const habit of settings.habits.filter((h) => h.enabled)) {
    const stats = analyticsMap.get(habit.id);
    if (!stats) continue;

    const card = grid.createDiv({ cls: "temperans-analytics-card" });
    const cardHeader = card.createDiv({ cls: "temperans-analytics-card-header" });
    cardHeader.createEl("h3", { text: habit.name });
    cardHeader.createSpan({ text: habit.cadence, cls: "temperans-analytics-cadence-badge" });

    const metricsList = card.createDiv({ cls: "temperans-analytics-metrics" });

    const periodSingular = habit.cadence === "weekly" ? "week"
      : habit.cadence === "monthly" ? "month"
      : habit.cadence === "quarterly" ? "quarter"
      : "year";

    const consistencyLabel = habit.cadence === "daily"
      ? `${Math.round(stats.consistencyRate * 100)}% (${stats.completedDays} / ${stats.totalDays} days)`
      : `${Math.round(stats.consistencyRate * 100)}% (${stats.completedPeriods ?? 0} / ${stats.totalPeriods ?? 0} ${periodSingular}s)`;

    addMetricRow(metricsList, "Consistency", consistencyLabel);
    addMetricRow(metricsList, "Total volume", formatValue(stats.totalVolume, habit.unit, habit));

    if (stats.averagePerSession !== undefined) {
      addMetricRow(metricsList, "Avg / session", `${formatValue(stats.averagePerSession, habit.unit, habit)} (${stats.totalSessions} sessions)`);
    } else if (habit.cadence === "daily") {
      addMetricRow(metricsList, "Avg / active day", formatValue(stats.averageActiveDays, habit.unit, habit));
    } else {
      addMetricRow(metricsList, `Avg / ${periodSingular}`, formatValue(stats.periodAverage ?? 0, habit.unit, habit));
    }

    if (stats.peakValue > 0) {
      const peakDateFormatted = showPeakDate && stats.peakDate ? ` (${formatDate(stats.peakDate)})` : "";
      addMetricRow(metricsList, "Single-day peak", `${formatValue(stats.peakValue, habit.unit, habit)}${peakDateFormatted}`);
    }

    addMetricRow(metricsList, "Current streak", `${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"}`);
    addMetricRow(metricsList, "Best streak", `${stats.bestStreak} day${stats.bestStreak === 1 ? "" : "s"}`);
  }
}

function addMetricRow(container: HTMLElement, label: string, value: string): void {
  const row = container.createDiv({ cls: "temperans-analytics-row" });
  row.createSpan({ text: label, cls: "temperans-analytics-label" });
  row.createSpan({ text: value, cls: "temperans-analytics-val" });
}
