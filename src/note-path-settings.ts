import { App, Notice, Setting } from "obsidian";
import { DEFAULT_NOTE_PATH, NotePathSettings, formattedLogPath, noteFormat, restoreNotePath, validateNoteFormat } from "./note-paths";

export function renderNotePathSettings(container: HTMLElement, app: App, folder: string, value: NotePathSettings,
  save: (value: NotePathSettings) => Promise<void>): void {
  container.addClass("temperans-note-path-settings");
  const settings = restoreNotePath(value);
  const fallbackMode = settings.format === DEFAULT_NOTE_PATH.format ? "flat" : "custom";
  const apply = async (next: NotePathSettings) => {
    try {
      validateNoteFormat(folder, noteFormat(app, next));
      await save(next);
      container.empty();
      renderNotePathSettings(container, app, folder, next, save);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not save note format.");
      container.empty();
      renderNotePathSettings(container, app, folder, settings, save);
    }
  };
  new Setting(container).setName("Organize logs by year and month")
    .setDesc("Save new logs as YYYY/MM/YYYY-MM-DD.md. Existing notes stay where they are.")
    .addToggle(toggle => toggle.setValue(settings.mode === "nested").onChange(enabled => apply({ ...settings, mode: enabled ? "nested" : fallbackMode })));

  const preview = container.createEl("p", { cls: "temperans-note-path-preview", attr: { "aria-live": "polite" } });
  const showPreview = (options: NotePathSettings) => {
    try {
      const format = noteFormat(app, options);
      validateNoteFormat(folder, format);
      preview.textContent = `Example: ${formattedLogPath(folder, "2026-09-26", format)}`;
    } catch (error) { preview.textContent = error instanceof Error ? error.message : "Invalid date format."; }
  };
  if (settings.mode === "flat" || settings.mode === "custom") {
    let format = settings.format;
    const options = (): NotePathSettings => ({ mode: format === DEFAULT_NOTE_PATH.format ? "flat" : "custom", format });
    new Setting(container).setName("Custom date format")
      .setDesc("Moment format, without .md. Use YYYY-MM-DD for plain filenames.")
      .addText(input => {
        input.setValue(format).setPlaceholder("YYYY-MM-DD").onChange(text => { format = text.trim(); showPreview(options()); });
        input.inputEl.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void apply(options()); } });
      })
      .addButton(button => button.setButtonText("Save format").onClick(() => apply(options()))).settingEl.addClass("temperans-note-format");
  }
  showPreview(settings);
}
