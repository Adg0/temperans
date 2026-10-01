import { createSubpageCard } from "../ui";
import { Notice, Setting } from "obsidian";
import { HealthConnectImportSummary } from "./health-connect";

export interface HealthConnectPathControl {
  path: string;
  defaultPath: string;
  save(path: string): Promise<void>;
}

export function renderHealthConnectPanel(
  container: HTMLElement,
  importHealthConnect: (weekEnding?: string) => Promise<HealthConnectImportSummary | null | undefined>,
  onImported: () => Promise<void>,
  pathControl?: HealthConnectPathControl
): void {
  // Card 1: Staged health data (File status + Import button together)
  const { card } = createSubpageCard(container, "heart-pulse", "Staged health data");
  card.addClass("temperans-health-connect-card");

  let draft = pathControl?.path ?? "";

  const actionRow = card.createDiv({ cls: "temperans-staging-action-row" });
  const fileInfo = actionRow.createDiv({ cls: "temperans-staging-file-info" });
  const fileLabel = fileInfo.createDiv({ cls: "temperans-staging-file-label" });
  fileLabel.createSpan({ text: "File: " });
  const fileCode = fileLabel.createEl("code");

  const statusHint = fileInfo.createDiv({
    cls: "temperans-staging-status-hint",
    text: "Ready to import staged data into your daily Habit Logs."
  });

  const showPath = () => {
    fileCode.textContent = pathControl ? (draft.trim() || pathControl.defaultPath) : "Habit Logs/.temperance-staging.json";
  };
  const savePath = async () => {
    await pathControl?.save(draft);
    showPath();
  };
  showPath();

  const importBtn = actionRow.createEl("button", { cls: "mod-cta", text: "Import staged data", attr: { type: "button" } });
  importBtn.onclick = async () => {
    importBtn.disabled = true;
    importBtn.textContent = "Importing…";
    try {
      await savePath();
      if (await importHealthConnect(undefined)) await onImported();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not import staged data.");
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import staged data";
    }
  };

  // Card 2: Staging file path (Separate collapsible card, minimized by default)
  if (pathControl) {
    const pathDetails = container.createEl("details", { cls: "temperans-staging-path-details" });
    pathDetails.createEl("summary", { text: "Staging file path" });
    new Setting(pathDetails).setName("Staging file path")
      .setDesc("JSON path inside the operation folder. Leave blank for default.")
      .addText(input => input.setValue(draft).setPlaceholder(pathControl.defaultPath)
        .onChange(value => {
          draft = value;
          statusHint.textContent = "Unsaved path — save or import to apply.";
          showPath();
        }))
      .addButton(button => button.setButtonText("Save path").onClick(async () => {
        try {
          await savePath();
          statusHint.textContent = "Staging path saved.";
          new Notice("Staging path saved.");
        }
        catch (error) { new Notice(error instanceof Error ? error.message : "Could not save staging path."); }
      }));
  }

  // Card 3: Recover an earlier week (Separate collapsible card, minimized by default)
  let recoveryWeekEnding = "";
  const recovery = container.createEl("details", { cls: "temperans-staging-recovery-details" });
  recovery.createEl("summary", { text: "Recover an earlier week" });
  new Setting(recovery).setName("Week ending")
    .setDesc("For a companion history export, select the same week-ending date. Leave blank for current seven days.")
    .addText(input => { input.inputEl.type = "date"; input.onChange(value => { recoveryWeekEnding = value; }); })
    .addButton(button => button.setButtonText("Import week").onClick(async () => {
      if (!recoveryWeekEnding) {
        new Notice("Select a week ending date first.");
        return;
      }
      button.setDisabled(true);
      button.setButtonText("Importing…");
      try {
        await savePath();
        if (await importHealthConnect(recoveryWeekEnding)) await onImported();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not import historical staged data.");
      } finally {
        button.setDisabled(false);
        button.setButtonText("Import week");
      }
    }));
}
