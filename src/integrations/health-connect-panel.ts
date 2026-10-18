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
  // Card 1: Companion export status and import action.
  const { card } = createSubpageCard(container, "heart-pulse", "Companion data");
  card.addClass("temperans-health-connect-card");

  let draft = pathControl?.path ?? "";

  const actionRow = card.createDiv({ cls: "temperans-staging-action-row" });
  const fileInfo = actionRow.createDiv({ cls: "temperans-staging-file-info" });
  const fileLabel = fileInfo.createDiv({ cls: "temperans-staging-file-label" });
  fileLabel.createSpan({ text: "File: " });
  const fileCode = fileLabel.createEl("code");

  const statusHint = fileInfo.createDiv({
    cls: "temperans-staging-status-hint",
    text: "Import health metrics and habit sessions from a JSON or CSV companion export."
  });

  const showPath = () => {
    fileCode.textContent = pathControl ? (draft.trim() || pathControl.defaultPath) : "Habit Logs/habit-sync-staging.json";
  };
  const savePath = async () => {
    await pathControl?.save(draft);
    showPath();
  };
  showPath();

  const importBtn = actionRow.createEl("button", { cls: "mod-cta", text: "Import companion data", attr: { type: "button" } });
  importBtn.onclick = async () => {
    importBtn.disabled = true;
    importBtn.textContent = "Importing…";
    try {
      await savePath();
      if (await importHealthConnect(undefined)) await onImported();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not import companion data.");
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import companion data";
    }
  };

  // Card 2: Staging file path (Separate collapsible card, minimized by default)
  if (pathControl) {
    const pathDetails = container.createEl("details", { cls: "temperans-staging-path-details" });
    pathDetails.createEl("summary", { text: "Staging file path" });
    new Setting(pathDetails).setName("Staging file path")
      .setDesc("JSON or csv path inside the operation folder. Leave blank for the default.")
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
