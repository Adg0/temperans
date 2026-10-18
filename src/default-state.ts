import { DEFAULT_NOTE_PATH } from "./note-paths";
import type { PluginState } from "./types";

export const DEFAULT_STATE: PluginState = {
  folder: "Habit Logs",
  healthConnectStagingPath: "",
  notePath: { ...DEFAULT_NOTE_PATH },
  lastMonkeytypeTimestamp: 0,
  monkeytypeSecretName: "temperans-habits-monkeytype-apekey",
  heatmapColor: "#22c55e",
  dashboardTitle: "Temperans habits",
  dashboardSubtitle: "Manual logs and automated tracking in Markdown.",
  peerSyncPort: 43887,
  peerSyncRemoteUrl: "",
  peerSyncHostSecretName: "temperans-habits-peer-host-secret",
  peerSyncRemoteSecretName: "temperans-habits-peer-remote-secret"
};

export const LEGACY_DEFAULT_DASHBOARD_TITLES: ReadonlySet<string> = new Set(
  ["Temperans Habits", "Habit patterns", "Habit sync"].map(title => title.toLowerCase())
);

export const LEGACY_DEFAULT_DASHBOARD_SUBTITLES: ReadonlySet<string> = new Set(
  [
    "Local habit history, stored in Markdown.",
    "Manual logs, and automated tracking in Markdown."
  ].map(subtitle => subtitle.toLowerCase())
);
