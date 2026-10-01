import { App, Modal } from "obsidian";
import { HealthConnectImportSummary } from "./health-connect";
import { HealthConnectPathControl, renderHealthConnectPanel } from "./health-connect-panel";

export interface ThirdPartySyncHubHost {
  importHealthConnect(weekEnding?: string): Promise<HealthConnectImportSummary | null>;
  openPeerSync(): void;
  healthConnectPathControl?(): HealthConnectPathControl;
}

export class ThirdPartySyncHubModal extends Modal {
  constructor(app: App, private readonly host: ThirdPartySyncHubHost) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-third-party-sync-modal");
    this.contentEl.createEl("h2", { text: "Health Connect sync" });
    renderHealthConnectPanel(this.contentEl, (weekEnding) => this.host.importHealthConnect(weekEnding), async () => this.close(), this.host.healthConnectPathControl?.());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
