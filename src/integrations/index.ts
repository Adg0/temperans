import { IntegrationDescriptor } from "./contracts";
import { HEALTH_CONNECT_INTEGRATION } from "./health-connect";
import { ThirdPartySyncHubHost, ThirdPartySyncHubModal } from "./sync-hub-modal";

export {
  HEALTH_CONNECT_INTEGRATION,
  HEALTH_CONNECT_STAGE_FILE,
  HEALTH_CONNECT_STAGE_SCHEMA_VERSION,
  healthConnectStagePath,
  importHealthConnectStaging,
  normalizeHealthConnectRecord,
  validateHealthConnectStagingDocument
} from "./health-connect";
export { syncHabitFromEndpoint, testEndpointConnection } from "./endpoint-runner";
export type { HealthConnectDailyRecord, HealthConnectImportSummary, HealthConnectStagingDocument } from "./health-connect";
export type { IntegrationDescriptor } from "./contracts";

export const THIRD_PARTY_INTEGRATIONS: IntegrationDescriptor[] = [HEALTH_CONNECT_INTEGRATION];

/** Opens the manual integration hub without coupling integrations to each other. */
export function openThirdPartySyncHub(app: import("obsidian").App, host: ThirdPartySyncHubHost): void {
  new ThirdPartySyncHubModal(app, host).open();
}
