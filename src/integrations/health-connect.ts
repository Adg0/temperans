import { serialized } from "../async";
import { hasInvalidPathChar, operationFolder } from "../paths";
import { App, TFile, normalizePath } from "obsidian";
import { ExternalMetricImport, HabitSettings, RESERVED_HABIT_IDS } from "../types";
import {
  HEALTH_CONNECT_STAGE_FILE,
  HealthConnectMetricValue,
  normalizeHealthConnectRecord,
  validateHealthConnectStagingDocument
} from "./health-connect-schema";

export * from "./health-connect-schema";

export interface HealthConnectImportSummary {
  imported: number;
  updated: number;
  protected: number;
  skipped: number;
  stagingPath: string;
  unconfiguredMetrics?: string[];
}

export interface HealthConnectImportHost {
  app: App;
  store: {
    folderPath: string;
    loadSettings(): Promise<HabitSettings>;
    applyHealthConnectMetrics(updates: ExternalMetricImport[]): Promise<{
      metricsImported: number;
      metricsUpdated: number;
      metricsProtected: number;
      metricsSkipped: number;
    }>;
  };
  getHealthConnectStagingPath?(): string;
  refreshAllDashboards(): Promise<void>;
}

/** Only a vault-relative JSON file is accepted, including the legacy dot filename. */
export function healthConnectStagePath(folderPath: string, override = ""): string {
  folderPath = operationFolder(folderPath);
  const path = (override.trim() || `${folderPath}/${HEALTH_CONNECT_STAGE_FILE}`).replace(/\\/g, "/");
  if (!path.startsWith(folderPath + "/")) throw new Error("The staging file must be inside the configured operation folder: " + folderPath);
  const parts = path.split("/");
  if (!/\.json$/i.test(path) || parts.some((part, index) => !part || part === "." || part === ".."
    || hasInvalidPathChar(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    || (index < parts.length - 1 && part.startsWith(".")))) {
    throw new Error("Use a vault-relative .json path, without hidden folders, parent folders, or reserved filename characters.");
  }
  return normalizePath(path);
}

interface StagingFileContents {
  contents: string;
  indexedFile: TFile | null;
}

/**
 * Android can add a staging file while Obsidian is already open. In that case the
 * vault index may not yet have a TFile for it, especially for a dot-prefixed
 * staging filename. The adapter reads the same approved vault-relative path
 * directly without broadening the integration's filesystem scope.
 */
async function readStagingFile(app: App, stagingPath: string): Promise<StagingFileContents> {
  const indexedFile = app.vault.getAbstractFileByPath(stagingPath);
  if (indexedFile instanceof TFile) {
    return { contents: await app.vault.read(indexedFile), indexedFile };
  }
  if (await app.vault.adapter.exists(stagingPath)) {
    return { contents: await app.vault.adapter.read(stagingPath), indexedFile: null };
  }
  throw new Error(`No Health Connect export was found at ${stagingPath}. Check the staging path in Health Connect sync and the companion export destination.`);
}

/** Imports a validated stage file, retaining it whenever validation or writing fails. */
export async function importHealthConnectStaging(host: HealthConnectImportHost, weekEnding?: string): Promise<HealthConnectImportSummary> {
  const stagingPath = healthConnectStagePath(host.store.folderPath, host.getHealthConnectStagingPath?.());
  return serialized(host.app.vault, "staging:" + stagingPath, async () => {
  const stat = await host.app.vault.adapter.stat?.(stagingPath);
  if (stat && stat.size > 2 * 1024 * 1024) throw new Error("Staging export exceeds the 2 MiB size limit.");
  const stagingFile = await readStagingFile(host.app, stagingPath);
  if (new TextEncoder().encode(stagingFile.contents).byteLength > 2 * 1024 * 1024) throw new Error("Staging export exceeds the 2 MiB size limit.");
  let raw: unknown;
  try {
    raw = JSON.parse(stagingFile.contents);
  } catch {
    throw new Error("The Health Connect staging file is not valid JSON. It was kept so you can export it again.");
  }
  const settings = await host.store.loadSettings();
  const validated = validateHealthConnectStagingDocument(raw, settings.timezone, weekEnding);
  if (!validated.ok) throw new Error(`${validated.error} The staging file was kept and no habit logs were changed.`);
  const enabledHabitIds = new Set(settings.habits.filter((h) => h.enabled).map((h) => h.id));
  const stagedMetricIds = new Set<string>();
  for (const record of validated.value.records) {
    for (const [key, val] of Object.entries(record)) {
      if (key === "date" || RESERVED_HABIT_IDS.has(key)) continue;
      if (val && typeof val === "object" && typeof val.value === "number") {
        stagedMetricIds.add(key);
      }
    }
  }
  const unconfiguredMetrics = [...stagedMetricIds].filter((id) => !enabledHabitIds.has(id));
  const result = await host.store.applyHealthConnectMetrics(
    validated.value.records.map((record) => normalizeHealthConnectRecord(record, settings.habits))
  );
  // Retain the export: retry is safe and a newer companion export must never be deleted.
  await host.refreshAllDashboards();
  return {
    imported: result.metricsImported,
    updated: result.metricsUpdated,
    protected: result.metricsProtected,
    skipped: result.metricsSkipped,
    stagingPath,
    unconfiguredMetrics
  };
  });
}
