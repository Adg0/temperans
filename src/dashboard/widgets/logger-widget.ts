import { HabitLogModal } from "../../modals";
import { HabitDefinition, HabitId } from "../../types";
import { normalizeHabitList } from "../codeblock-parser";
import { refreshInBackground } from "../background-refresh";
import { DashboardWidget, WidgetContext } from "../types";

interface LoggerEmbedState {
  currentHabitId?: HabitId;
  isCollapsed?: boolean;
}

const loggerEmbedStates = new WeakMap<HTMLElement, LoggerEmbedState>();

function resolveLoggerHabits(ctx: WidgetContext, config?: Record<string, unknown>): HabitDefinition[] {
  const enabled = ctx.settings.habits.filter((h) => h.enabled);
  const byId = new Map(enabled.map((h) => [h.id, h]));

  const widgetFilterRaw = config?.habits !== undefined ? config.habits : config?.habit;
  const widgetIds = normalizeHabitList(widgetFilterRaw).filter((id) => id !== "overall");
  const filterIds: HabitId[] | undefined = widgetIds.length > 0
    ? widgetIds
    : ctx.habitFilters && ctx.habitFilters.length > 0
    ? ctx.habitFilters
    : ctx.habitFilter !== "overall"
    ? [ctx.habitFilter]
    : undefined;

  if (!filterIds || filterIds.length === 0) return enabled;
  const resolved: HabitDefinition[] = [];
  const seen = new Set<string>();
  for (const id of filterIds) {
    const habit = byId.get(id);
    if (habit && !seen.has(habit.id)) {
      seen.add(habit.id);
      resolved.push(habit);
    }
  }
  return resolved;
}

export class LoggerWidget implements DashboardWidget {
  id = "logger";
  name = "Embedded Habit Logger";
  description = "Embeds the full interactive Log habits modal interface directly inside a note or dashboard.";

  async render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): Promise<void> {
    container.empty();
    await this.mountEmbeddedLogger(container, ctx, config);
  }

  async update(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): Promise<void> {
    const activeEl = container.ownerDocument?.activeElement;
    if (activeEl && container.contains(activeEl) && (activeEl.instanceOf(HTMLInputElement) || activeEl.instanceOf(HTMLTextAreaElement))) {
      return;
    }
    container.empty();
    await this.mountEmbeddedLogger(container, ctx, config);
  }

  private async mountEmbeddedLogger(
    container: HTMLElement,
    ctx: WidgetContext,
    config?: Record<string, unknown>
  ): Promise<void> {
    const date = ctx.selectedDate ?? ctx.today;
    const enabledHabits = resolveLoggerHabits(ctx, config);

    let state = loggerEmbedStates.get(ctx.container);
    if (!state) {
      state = { isCollapsed: false };
      loggerEmbedStates.set(ctx.container, state);
    }

    const initialHabitId = (state.currentHabitId && enabledHabits.some((h) => h.id === state.currentHabitId))
      ? state.currentHabitId
      : enabledHabits[0]?.id;

    if (!state.currentHabitId && initialHabitId) {
      state.currentHabitId = initialHabitId;
    }

    const customTitle = typeof config?.title === "string" && config.title.trim() ? config.title.trim() : undefined;

    const embeddedLogger = new HabitLogModal(
      ctx.app,
      ctx.host.store,
      date,
      enabledHabits,
      initialHabitId,
      async () => refreshInBackground(ctx),
      async (habitId) => {
        await ctx.host.syncEndpointHabit(habitId);
        await ctx.onRefresh();
      },
      true,
      customTitle,
      state.isCollapsed ?? false,
      (habitId) => {
        state.currentHabitId = habitId;
      },
      (collapsed) => {
        state.isCollapsed = collapsed;
      }
    );

    await embeddedLogger.mountInline(container);
  }
}
