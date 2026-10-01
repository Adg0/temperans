import { DashboardWidget } from "./types";
import { HeaderWidget } from "./widgets/header-widget";
import { StatsWidget } from "./widgets/stats-widget";
import { PeriodGoalsWidget } from "./widgets/period-goals-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { DayDetailWidget } from "./widgets/day-detail-widget";

export class DashboardWidgetRegistry {
  private widgets = new Map<string, DashboardWidget>();

  constructor() {
    this.register(new HeaderWidget());
    this.register(new StatsWidget());
    this.register(new PeriodGoalsWidget());
    const calendar = new CalendarWidget();
    this.register(calendar);
    this.widgets.set("heatmap", calendar);
    this.register(new DayDetailWidget());
  }

  register(widget: DashboardWidget): void {
    this.widgets.set(widget.id, widget);
  }

  get(id: string): DashboardWidget | undefined {
    return this.widgets.get(id);
  }

  has(id: string): boolean {
    return this.widgets.has(id);
  }

  getAll(): DashboardWidget[] {
    return [...this.widgets.values()];
  }
}

export const defaultWidgetRegistry = new DashboardWidgetRegistry();
