import { yearOf } from "../../date";
import { calculateHabitAnalytics } from "../../analytics";
import { bestDailyStreak, calculateDailyStreak } from "../../evaluation";
import { cadenceLabel, formatStatValue } from "../format";
import { DashboardWidget, WidgetContext } from "../types";

export class StatsWidget implements DashboardWidget {
  id = "stats";
  name = "Analytics Stats Cards";
  description = "6-card summary displaying consistency, volume, averages, and streaks.";

  async render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): Promise<void> {
    container.empty();
    container.addClass("temperans-stats");

    const cardsData = await this.getCardsData(ctx, config);
    for (const item of cardsData) {
      const card = container.createDiv({ cls: "temperans-stat" });
      card.createSpan({ text: item.value, cls: "temperans-stat-value" });
      card.createSpan({ text: item.label, cls: "temperans-stat-label" });
    }
  }

  async update(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): Promise<void> {
    const cardsData = await this.getCardsData(ctx, config);
    const existingCards = container.querySelectorAll<HTMLElement>(".temperans-stat");

    if (existingCards.length === cardsData.length) {
      for (let i = 0; i < cardsData.length; i++) {
        const card = existingCards[i];
        const valEl = card.querySelector<HTMLElement>(".temperans-stat-value");
        const lblEl = card.querySelector<HTMLElement>(".temperans-stat-label");
        if (valEl && valEl.textContent !== cardsData[i].value) valEl.textContent = cardsData[i].value;
        if (lblEl && lblEl.textContent !== cardsData[i].label) lblEl.textContent = cardsData[i].label;
      }
    } else {
      await this.render(container, ctx, config);
    }
  }

  private async getCardsData(ctx: WidgetContext, config?: Record<string, unknown>): Promise<Array<{ value: string; label: string }>> {
    const selectedHabit = ctx.habitFilter === "overall" ? undefined : ctx.settings.habits.find((h) => h.id === ctx.habitFilter);
    const availableCards: Record<string, { value: string; label: string }> = {};

    if (selectedHabit) {
      const analytics = ctx.analytics.get(selectedHabit.id) ?? calculateHabitAnalytics(selectedHabit, ctx.dates, ctx.logs, ctx.today);
      if (selectedHabit.cadence !== "daily") {
        availableCards["consistency"] = { label: `${cadenceLabel(selectedHabit.cadence)} consistency`, value: `${Math.round(analytics.consistencyRate * 100)}%` };
        availableCards["completed-days"] = { label: "Completed periods", value: `${analytics.completedPeriods ?? 0} / ${analytics.totalPeriods ?? 0}` };
        availableCards["total-volume"] = { label: "Total volume", value: formatStatValue(analytics.totalVolume, selectedHabit.unit, selectedHabit) };
        availableCards["active-average"] = { label: `Average / ${selectedHabit.cadence === "weekly" ? "week" : "month"}`, value: formatStatValue(analytics.periodAverage ?? 0, selectedHabit.unit, selectedHabit) };
        availableCards["best-streak"] = { label: "Best period peak", value: formatStatValue(analytics.bestPeriodValue ?? 0, selectedHabit.unit, selectedHabit) };
        availableCards["peak-day"] = { label: "Single-day peak", value: formatStatValue(analytics.peakValue, selectedHabit.unit, selectedHabit) };
      } else {
        const avgLabel = analytics.averagePerSession !== undefined
          ? `Avg / session (${analytics.totalSessions ?? 0})`
          : "Avg / active day";
        const avgVal = analytics.averagePerSession !== undefined
          ? formatStatValue(analytics.averagePerSession, selectedHabit.unit, selectedHabit)
          : formatStatValue(analytics.averageActiveDays, selectedHabit.unit, selectedHabit);

        const isAvoidance = selectedHabit.type === "avoidance";
        const isTracker = selectedHabit.type === "tracker";

        availableCards["consistency"] = {
          label: isTracker ? "Logging rate" : isAvoidance ? "Clean rate" : "Habit consistency",
          value: `${Math.round(analytics.consistencyRate * 100)}%`
        };
        availableCards["completed-days"] = {
          label: isTracker ? "Days logged" : isAvoidance ? "Clean days" : "Completed days",
          value: isTracker ? `${analytics.activeDays} / ${analytics.totalDays}` : `${analytics.completedDays} / ${analytics.totalDays}`
        };
        availableCards["partial-days"] = { label: "Partial days", value: String(analytics.partialDays) };
        availableCards["missed-days"] = {
          label: isAvoidance ? "Slip days" : "Missed days",
          value: isTracker ? "0" : String(analytics.missedDays)
        };
        availableCards["total-volume"] = {
          label: isAvoidance ? "Total slips" : isTracker ? "Total tracked" : "Total volume",
          value: formatStatValue(analytics.totalVolume, selectedHabit.unit, selectedHabit)
        };
        availableCards["active-average"] = { label: avgLabel, value: avgVal };
        availableCards["peak-day"] = { label: "Single-day peak", value: formatStatValue(analytics.peakValue, selectedHabit.unit, selectedHabit) };
        availableCards["current-streak"] = {
          label: isTracker ? "Logging streak" : isAvoidance ? "Clean streak" : "Habit current streak",
          value: `${analytics.currentStreak} day${analytics.currentStreak === 1 ? "" : "s"}`
        };
        availableCards["best-streak"] = {
          label: isTracker ? "Best logging streak" : isAvoidance ? "Best clean streak" : "Habit best streak",
          value: `${analytics.bestStreak} day${analytics.bestStreak === 1 ? "" : "s"}`
        };
      }
    } else {
      const values = [...ctx.evaluations.values()].filter((evaluation) => evaluation.score !== null);
      const complete = values.filter((evaluation) => evaluation.score === 1).length;
      const partial = values.filter((evaluation) => evaluation.score !== null && evaluation.score > 0 && evaluation.score < 1).length;
      const missed = values.filter((evaluation) => evaluation.score === 0).length;
      const average = values.length ? values.reduce((sum, evaluation) => sum + (evaluation.score ?? 0), 0) / values.length : 0;

      const streakResult = calculateDailyStreak(ctx.today, (date) => ctx.evaluations.get(date));
      const bestStreak = bestDailyStreak(ctx.dates.filter((date) => date <= ctx.today), (date) => ctx.evaluations.get(date));

      availableCards["consistency"] = { label: "Daily consistency", value: `${Math.round(average * 100)}%` };
      availableCards["completed-days"] = { label: "Complete days", value: String(complete) };
      availableCards["partial-days"] = { label: "Partial days", value: String(partial) };
      availableCards["missed-days"] = { label: "Missed days", value: String(missed) };
      availableCards["current-streak"] = { label: streakResult.coversToday ? "Current daily streak" : "Streak before today", value: String(streakResult.streak) };
      availableCards["best-streak"] = { label: ctx.year === yearOf(ctx.today) ? "Best streak this year" : `Best streak (${ctx.year})`, value: String(bestStreak) };
      availableCards["total-volume"] = { label: "Days evaluated", value: String(values.length) };
    }

    const requested = Array.isArray(config?.cards) ? config.cards : null;
    if (requested && requested.length > 0) {
      const filtered: Array<{ value: string; label: string }> = [];
      for (const item of requested) {
        const canonicalKey = String(item).toLowerCase().replace(/[_\s]+/g, "-");
        const found = availableCards[canonicalKey]
          ?? (canonicalKey === "volume" ? availableCards["total-volume"] : undefined)
          ?? (canonicalKey === "streak" ? availableCards["current-streak"] : undefined)
          ?? (canonicalKey === "peak" ? availableCards["peak-day"] : undefined)
          ?? (canonicalKey === "average" ? availableCards["active-average"] : undefined)
          ?? (canonicalKey === "completed" ? availableCards["completed-days"] : undefined);
        if (found) filtered.push(found);
      }
      if (filtered.length > 0) return filtered;
    }

    // Default layout if not specified
    if (selectedHabit && selectedHabit.cadence !== "daily") {
      return [
        availableCards["consistency"],
        availableCards["completed-days"],
        availableCards["total-volume"],
        availableCards["active-average"],
        availableCards["best-streak"],
        availableCards["peak-day"]
      ].filter(Boolean);
    }

    return [
      availableCards["consistency"],
      availableCards["completed-days"],
      availableCards[selectedHabit ? "total-volume" : "partial-days"],
      availableCards[selectedHabit ? "active-average" : "missed-days"],
      availableCards["current-streak"],
      availableCards["best-streak"]
    ].filter(Boolean);
  }
}
