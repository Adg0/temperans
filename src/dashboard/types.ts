import { App } from "obsidian";
import { HabitStore } from "../data";
import { DailyLog, DayEvaluation, HabitId, HabitSettings } from "../types";
import { HabitAnalytics } from "../analytics";
import type { PeerSyncService } from "../peer-sync/service";
import type { HealthConnectImportSummary } from "../integrations/health-connect";

export interface DashboardHost {
  state: {
    heatmapColor: string;
    dashboardTitle?: string;
    dashboardSubtitle?: string;
  };
  store: HabitStore;
  peerSync?: PeerSyncService;
  importHealthConnect?(weekEnding?: string): Promise<HealthConnectImportSummary | null>;
  openSettingsNote(): Promise<void>;
  openThirdPartySync(): void;
  openPeerSync(): void;
  syncAllEndpoints(): Promise<void>;
  syncEndpointHabit(habitId: HabitId): Promise<void>;
  openAnalyticsSummary(): void;
  openDashboardConfig(): Promise<void>;
}

export interface WidgetContext {
  app: App;
  host: DashboardHost;
  container: HTMLElement;
  year: number;
  month: number;
  selectedDate: string | null;
  habitFilter: HabitId;
  settings: HabitSettings;
  logs: Map<string, DailyLog>;
  evaluations: Map<string, DayEvaluation>;
  analytics: Map<HabitId, HabitAnalytics>;
  dates: string[];
  today: string;
  isCompact: boolean;
  periodsPending?: boolean;
  periodsError?: boolean;
  calendarMode?: "month" | "year";
  dayButtons: Map<string, HTMLButtonElement>;
  onSelectDay: (date: string) => void;
  onSelectHabit: (habitId: HabitId) => void;
  onNavigatePeriod: (delta: number) => void;
  onGoToToday: () => void;
  onRefresh: () => Promise<void>;
}

export interface DashboardWidgetConfig {
  widget: string;
  config?: Record<string, unknown>;
}

export interface DashboardLayoutConfig {
  version: number;
  widgets: DashboardWidgetConfig[];
  error?: string;
}

export interface DashboardWidget {
  id: string;
  name: string;
  description: string;
  render(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void | Promise<void>;
  update?(container: HTMLElement, ctx: WidgetContext, config?: Record<string, unknown>): void | Promise<void>;
  destroy?(container: HTMLElement): void;
}
