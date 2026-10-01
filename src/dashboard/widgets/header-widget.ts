import { refreshInBackground } from "../background-refresh";
import { calendarModeFor } from "../format";
import { setIcon } from "obsidian";
import { formatMonthYear, yearOf } from "../../date";
import { createTemperansDropdown } from "../../dropdown";
import { DashboardActionsModal } from "../../dashboard-actions-modal";
import { HabitLogModal } from "../../modals";
import { DashboardWidget, WidgetContext } from "../types";

export class HeaderWidget implements DashboardWidget {
  id = "header";
  name = "Header Controls";
  description = "Title, quick-log action, period navigation, and habit filter dropdown.";

  render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    container.empty();
    container.addClass("temperans-header");

    const showActions = config?.showActions !== false;
    const showPeriodNav = config?.showPeriodNav !== false;
    const monthMode = (ctx.calendarMode ?? calendarModeFor(ctx.isCompact)) === "month";
    const showFilter = config?.showFilter !== false;

    const titleText = (typeof config?.title === "string" && config.title.trim())
      || ctx.host.state.dashboardTitle
      || "Temperans Habits";
    const subtitleText = (typeof config?.subtitle === "string")
      ? config.subtitle
      : (ctx.host.state.dashboardSubtitle ?? "Local habit history, stored in Markdown.");

    const title = container.createDiv({ cls: "temperans-header-title" });
    title.createEl("h2", { text: titleText });
    if (subtitleText.trim()) {
      title.createEl("p", { text: subtitleText });
    }

    if (showActions) {
      const actions = container.createDiv({ cls: "temperans-header-actions" });
      const logButton = actions.createEl("button", { cls: "mod-cta", text: "Log today", attr: { type: "button" } });
      logButton.onclick = () => new HabitLogModal(
        ctx.app,
        ctx.host.store,
        ctx.today,
        ctx.settings.habits.filter((h) => h.enabled),
        undefined,
        async () => refreshInBackground(ctx),
        async (habitId) => {
          await ctx.host.syncEndpointHabit(habitId);
          await ctx.onRefresh();
        }
      ).open();

      const settingsButton = actions.createEl("button", {
        cls: "temperans-icon-button",
        attr: { type: "button", "aria-label": "Open Temperans actions" }
      });
      setIcon(settingsButton, "settings");
      settingsButton.onclick = () => new DashboardActionsModal(ctx.app, ctx.host, async () => ctx.onRefresh()).open();
    }

    if (showPeriodNav || showFilter) {
      const controls = container.createDiv({ cls: "temperans-controls" });

      if (showPeriodNav) {
        const nav = controls.createDiv({ cls: "temperans-nav" });
        const previousBtn = nav.createEl("button", {
          text: "‹",
          attr: {
            type: "button",
            "aria-label": monthMode ? "Previous month" : "Previous year"
          }
        });
        previousBtn.onclick = () => ctx.onNavigatePeriod(-1);

        const onTodayPeriod = monthMode
          ? ctx.year === yearOf(ctx.today) && ctx.month === Number(ctx.today.slice(5, 7))
          : ctx.year === yearOf(ctx.today);

        const periodLabel = nav.createEl("button", {
          text: monthMode ? formatMonthYear(ctx.year, ctx.month) : String(ctx.year),
          cls: "temperans-year",
          attr: onTodayPeriod
            ? { type: "button" }
            : { type: "button", "aria-label": "Jump to today" }
        });
        periodLabel.disabled = onTodayPeriod;
        periodLabel.onclick = () => ctx.onGoToToday();

        const nextBtn = nav.createEl("button", {
          text: "›",
          attr: {
            type: "button",
            "aria-label": monthMode ? "Next month" : "Next year"
          }
        });
        this.updateNextButtonState(nextBtn, ctx);
        nextBtn.onclick = () => ctx.onNavigatePeriod(1);
      }

      if (showFilter) {
        const filter = controls.createDiv({ cls: "temperans-header-filter" });
        createTemperansDropdown(filter, {
          value: ctx.habitFilter,
          options: [
            { value: "overall", label: "Overall daily consistency" },
            ...ctx.settings.habits.filter((h) => h.enabled).map((h) => ({ value: h.id, label: `${h.name} (${h.cadence})` }))
          ],
          ariaLabel: "Choose a habit heat map",
          className: "temperans-dashboard-dropdown",
          onChange: (value) => ctx.onSelectHabit(value)
        });
      }
    }
  }

  update(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void {
    if (config?.showPeriodNav === false) return;
    const monthMode = (ctx.calendarMode ?? calendarModeFor(ctx.isCompact)) === "month";
    const label = container.querySelector<HTMLButtonElement>(".temperans-year");
    if (label) {
      const onTodayPeriod = monthMode
        ? ctx.year === yearOf(ctx.today) && ctx.month === Number(ctx.today.slice(5, 7))
        : ctx.year === yearOf(ctx.today);
      label.textContent = monthMode ? formatMonthYear(ctx.year, ctx.month) : String(ctx.year);
      label.disabled = onTodayPeriod;
    }

    const nextBtn = container.querySelector<HTMLButtonElement>(".temperans-nav button:last-child");
    if (nextBtn) {
      this.updateNextButtonState(nextBtn, ctx);
    }
  }

  private updateNextButtonState(nextBtn: HTMLButtonElement, ctx: WidgetContext): void {
    if ((ctx.calendarMode ?? calendarModeFor(ctx.isCompact)) === "month") {
      const todayYear = yearOf(ctx.today);
      const todayMonth = Number(ctx.today.slice(5, 7));
      nextBtn.disabled = ctx.year > todayYear || (ctx.year === todayYear && ctx.month >= todayMonth);
    } else {
      nextBtn.disabled = ctx.year >= yearOf(ctx.today);
    }
  }
}
