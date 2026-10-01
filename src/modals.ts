import { followModalViewport } from "./modal-viewport";
import { serialized } from "./async";
import { CADENCE_OPTIONS, UNIT_LABELS } from "./habit-options";
import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { HabitStore } from "./data";
import { formatDate, todayInZone } from "./date";
import { formatTypingDuration, isTimeUnit, parseHabitAmount, parseTimeValue, parseSleepDuration, parseTypingDuration, sleepInputValue, typingInputValue } from "./durations";
import { createTemperansDropdown } from "./dropdown";
import { calculateGoalProgress, targetForDate } from "./evaluation";
import { cadenceLabel, targetLabel } from "./dashboard/format";
import { HabitCadence, HabitDefinition, HabitId, HabitSession, HabitType, QuickEntryConfig } from "./types";

function getHabitIcon(habit: HabitDefinition): string {
  const id = habit.id.toLowerCase();
  const name = habit.name.toLowerCase();
  const unit = habit.unit.toLowerCase();

  if (habit.type === "avoidance" || id.includes("no-") || name.includes("no ")) return "shield-alert";
  if (habit.type === "tracker" || id.includes("weight") || unit === "kg" || unit === "lbs") return "scale";
  if (id === "sleep" || habit.displayFormat === "duration" || name.includes("sleep")) return "moon";
  if (id === "reading" || unit === "pages" || unit === "chapters" || name.includes("read") || name.includes("book")) return "book-open";
  if (id === "typing" || unit === "tests" || name.includes("type")) return "keyboard";
  if (name.includes("workout") || name.includes("exercise") || name.includes("gym") || unit === "reps" || id.includes("pullup")) return "dumbbell";
  if (id.includes("water") || id.includes("hydration") || unit === "ml" || unit === "glasses") return "droplet";
  if (id.includes("calorie") || unit === "kcal" || name.includes("diet")) return "flame";
  if (unit === "km" || unit === "miles" || unit === "steps" || name.includes("run") || name.includes("walk") || name.includes("cardio")) return "footprints";
  if (name.includes("meditat") || name.includes("mindful")) return "sparkles";
  if (name.includes("code") || name.includes("program") || name.includes("work") || name.includes("study")) return "code";
  if (habit.type === "session") return "layers";
  return "check-circle";
}

export class HabitLogModal extends Modal {
  private currentIndex = 0;
  private pendingSaves = new Map<string, () => Promise<unknown>>();
  private saveTimer: number | undefined;
  private saveStatus = "";
  private saveStatusEl: HTMLElement | undefined;
  private closing = false;
  private stopFollowingViewport?: () => void;

  private reportSaveError(error: unknown): void {
    this.setSaveStatus("Not saved — retry Finish");
    new Notice(error instanceof Error ? error.message : "Could not save this habit. Your draft is still open.");
  }
  private setSaveStatus(value: string): void {
    this.saveStatus = value;
    if (this.saveStatusEl) {
      this.saveStatusEl.empty();
      this.saveStatusEl.setAttribute("title", value);
      this.saveStatusEl.toggleClass("is-error", value.startsWith("Not saved"));
      if (value) {
        const icon = this.saveStatusEl.createSpan({ attr: { "aria-hidden": "true" } });
        setIcon(icon, value === "Saved" ? "check-check" : value === "Saving…" ? "save" : "circle-alert");
        this.saveStatusEl.createSpan({ cls: "temperans-visually-hidden", text: value });
      }
    }
  }
  private queueSave(id: string, save: () => Promise<unknown>): void {
    this.pendingSaves.set(id, save);
    this.setSaveStatus("Saving…");
    if (this.saveTimer) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.saveTimer);
    this.saveTimer = this.contentEl.ownerDocument.defaultView?.setTimeout(() => { void this.flushSaves().catch(error => this.reportSaveError(error)); }, 250);
  }
  private flushSaves(): Promise<void> {
    if (this.saveTimer) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    return serialized(this, "saves", async () => {
      while (this.pendingSaves.size) {
        const [id, save] = this.pendingSaves.entries().next().value!;
        await save();
        if (this.pendingSaves.get(id) === save) this.pendingSaves.delete(id);
      }
      this.setSaveStatus("Saved");
    });
  }
  close(): void { void this.finish(); }

  private logData: any = null;
  private metricDrafts = new Map<HabitId, { amount: string; note: string; dirty: boolean }>();
  private durationDrafts = new Map<HabitId, { duration: string; note: string; dirty: boolean }>();
  private typingDrafts = new Map<HabitId, { duration: string; tests: string; note: string; dirty: boolean }>();
  private sessionDrafts = new Map<HabitId, { title: string; pages: string; chapters: string; minutes: string; reps: string; count: string; note: string }>();

  constructor(
    app: App,
    private readonly store: HabitStore,
    private readonly date: string,
    private readonly habits: HabitDefinition[],
    selectedId?: HabitId,
    private readonly onSaved?: () => Promise<void>,
    private readonly onEndpointSync?: (habitId: HabitId) => Promise<void>
  ) {
    super(app);
    const initialIndex = habits.findIndex((h) => h.id === selectedId);
    this.currentIndex = initialIndex >= 0 ? initialIndex : 0;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("temperans-modal", "temperans-log-modal");
    this.stopFollowingViewport?.();
    this.stopFollowingViewport = followModalViewport(this.modalEl, this.contentEl);
    await this.initDrafts();
    await this.render();
  }

  private async initDrafts(): Promise<void> {
    this.logData = await this.store.getLog(this.date);
    for (const habit of this.habits) {
      // Metric drafts
      if (!this.metricDrafts.has(habit.id)) {
        const val = this.logData.metrics[habit.id];
        this.metricDrafts.set(habit.id, {
          amount: val !== undefined ? String(val) : "",
          note: this.logData.metricNotes[habit.id] ?? "",
          dirty: false
        });
      }
      // Duration drafts
      if (!this.durationDrafts.has(habit.id)) {
        const minutes = this.logData.metrics[habit.id] ?? 0;
        this.durationDrafts.set(habit.id, {
          duration: minutes > 0 ? sleepInputValue(minutes) : "",
          note: this.logData.metricNotes[habit.id] ?? "",
          dirty: false
        });
      }
      // Typing drafts
      if (!this.typingDrafts.has(habit.id)) {
        const durSec = this.logData.typing?.manualDurationSeconds ?? 0;
        const testCount = this.logData.typing?.manualTests ?? 0;
        this.typingDrafts.set(habit.id, {
          duration: durSec > 0 ? typingInputValue(durSec) : "",
          tests: testCount > 0 ? String(testCount) : "",
          note: this.logData.typing?.note ?? "",
          dirty: false
        });
      }
      // Session drafts
      if (!this.sessionDrafts.has(habit.id)) {
        this.sessionDrafts.set(habit.id, {
          title: "",
          pages: "",
          chapters: "",
          minutes: "",
          reps: "",
          count: "",
          note: ""
        });
      }
    }
  }

  private flushCurrentHabit(): Promise<void> {
    return serialized(this, "draft", () => this.flushDraft());
  }

  private async flushDraft(): Promise<void> {
    await this.flushSaves();
    const habit = this.habits[this.currentIndex];
    if (!habit) return;

    const isDuration = habit.displayFormat === "duration" || habit.id === "sleep";
    const isSession = habit.type === "session" || habit.id === "reading";

    if (isSession) {
      const draft = this.sessionDrafts.get(habit.id);
      if (draft) {
        const pageValue = draft.pages.trim() ? Number(draft.pages) : undefined;
        const chapterValue = draft.chapters.trim() ? Number(draft.chapters) : undefined;
        const minuteValue = draft.minutes.trim() ? parseTimeValue(draft.minutes, "minutes", isTimeUnit(habit.unit) ? habit.unit : "minutes") ?? NaN : undefined;
        const repValue = draft.reps.trim() ? Number(draft.reps) : undefined;
        const countValue = draft.count.trim() ? Number(draft.count) : undefined;

        const values = [pageValue, chapterValue, minuteValue, repValue, countValue];
        const hasNumericValue = values.some((v) => v !== undefined) && values.every((v) => v === undefined || Number.isFinite(v) && v >= 0);

        if (!hasNumericValue && Object.values(draft).some(value => value.trim())) throw new Error("Enter a valid session amount before saving.");
        if (hasNumericValue) {
          const title = draft.title.trim() || habit.name;
          await this.store.addSession(this.date, habit.id, {
            title,
            ...(pageValue !== undefined ? { pages: pageValue } : {}),
            ...(chapterValue !== undefined ? { chapters: chapterValue } : {}),
            ...(minuteValue !== undefined ? { minutes: minuteValue } : {}),
            ...(repValue !== undefined ? { reps: repValue } : {}),
            ...(countValue !== undefined ? { count: countValue } : {}),
            ...(draft.note.trim() ? { note: draft.note.trim() } : {})
          });
          this.sessionDrafts.set(habit.id, {
            title: "",
            pages: "",
            chapters: "",
            minutes: "",
            reps: "",
            count: "",
            note: ""
          });
        }
      }
      return;
    }

    if (habit.id === "typing") {
      const draft = this.typingDrafts.get(habit.id);
      if (draft && draft.dirty) {
        const durSec = draft.duration.trim() ? parseTypingDuration(draft.duration) : 0;
        const testCount = draft.tests.trim() ? Number(draft.tests) : 0;
        if (durSec === null || !Number.isInteger(testCount) || testCount < 0) throw new Error("Enter a valid duration and whole-number test count.");
        await this.store.recordManualTyping(this.date, durSec, testCount, draft.note);
        draft.dirty = false;
      }
      return;
    }

    if (isDuration) {
      const draft = this.durationDrafts.get(habit.id);
      if (draft && draft.dirty) {
        const minutes = draft.duration.trim() ? parseSleepDuration(draft.duration) : 0;
        if (minutes === null) throw new Error("Enter a valid duration before saving.");
        await this.store.recordMetric(this.date, habit.id, minutes, draft.note);
        draft.dirty = false;
      }
      return;
    }

    // Standard metric habit
    const draft = this.metricDrafts.get(habit.id);
    if (draft && draft.dirty) {
      const amountStr = draft.amount.trim();
      const value = amountStr ? parseHabitAmount(amountStr, habit) : 0;
      if (value === null) throw new Error("Enter a valid amount before saving.");
      await this.store.recordMetric(this.date, habit.id, value, draft.note);
      draft.dirty = false;
    }
  }

  private async navigate(delta: number): Promise<void> {
    try {
    await this.flushCurrentHabit();
    const nextIndex = this.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= this.habits.length) return;
    this.currentIndex = nextIndex;
    this.logData = await this.store.getLog(this.date);
    await this.render();
    } catch (error) { this.reportSaveError(error); }
  }

  private async selectHabit(id: HabitId): Promise<void> {
    try {
    await this.flushCurrentHabit();
    const idx = this.habits.findIndex((h) => h.id === id);
    if (idx >= 0) {
      this.currentIndex = idx;
      this.logData = await this.store.getLog(this.date);
      await this.render();
    }
    } catch (error) { this.reportSaveError(error); }
  }

  private async finish(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const controls = Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"));
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
    await this.flushCurrentHabit();
    await this.onSaved?.();
    super.close();
    } catch (error) { this.reportSaveError(error); }
    finally { controls.forEach((control, index) => { control.disabled = disabled[index]; }); this.closing = false; }
  }

  private renderHeroHeader(container: HTMLElement, habit: HabitDefinition, currentValue: number): void {
    const heroHeader = container.createDiv({ cls: "temperans-hero-card-header" });

    const titleGroup = heroHeader.createDiv({ cls: "temperans-hero-card-title-group" });
    const iconBox = titleGroup.createSpan({ cls: "temperans-hero-card-icon" });
    setIcon(iconBox, getHabitIcon(habit));

    const titleTextGroup = titleGroup.createDiv({ cls: "temperans-hero-text-group" });
    titleTextGroup.createEl("h3", { cls: "temperans-hero-card-title", text: habit.name });

    const target = targetForDate(habit, this.date);
    const targetText = targetLabel(target, habit);
    const cadenceText = cadenceLabel(habit.cadence);
    titleTextGroup.createSpan({
      cls: "temperans-hero-card-tag",
      text: `${cadenceText} · ${targetText}`
    });

    const statusBadge = heroHeader.createSpan({ cls: "temperans-hero-card-badge" });

    if (habit.type === "avoidance") {
      const maxLimit = target?.max ?? 0;
      if (currentValue <= maxLimit) {
        statusBadge.addClass("is-success");
        statusBadge.setText("✓ Clean Day");
      } else {
        statusBadge.addClass("is-error");
        statusBadge.setText(`⚠ Slipped (+${currentValue - maxLimit})`);
      }
    } else if (habit.type === "tracker") {
      if (currentValue > 0) {
        statusBadge.addClass("is-success");
        statusBadge.setText("✓ Logged");
      } else {
        statusBadge.addClass("is-idle");
        statusBadge.setText("Not logged");
      }
    } else {
      const goal = calculateGoalProgress(currentValue, target, habit);
      if (goal.progress >= 1.0) {
        statusBadge.addClass("is-success");
        statusBadge.setText("✓ Goal Met");
      } else if (goal.progress > 0) {
        statusBadge.addClass("is-progress");
        statusBadge.setText(`${Math.round(goal.progress * 100)}% Done`);
      } else {
        statusBadge.addClass("is-idle");
        statusBadge.setText("Pending");
      }
    }
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const modalHeader = contentEl.createDiv({ cls: "temperans-log-modal-header" });
    modalHeader.createEl("h2", { text: "Log habits" });
    const datePill = modalHeader.createSpan({ cls: "temperans-log-date-pill" });
    datePill.setText(`📅 ${formatDate(this.date)}`);

    if (!this.habits.length) {
      contentEl.createEl("p", { text: "Enable a habit in Habit Logs/Settings.md first." });
      return;
    }

    const currentHabit = this.habits[this.currentIndex] ?? this.habits[0];

    // Stepper header
    const stepperContainer = contentEl.createDiv({ cls: "temperans-habit-stepper" });

    // Previous button with sleek Lucide chevron-left
    const prevBtn = stepperContainer.createEl("button", {
      cls: "temperans-stepper-nav-btn",
      attr: { type: "button", "aria-label": "Previous habit" }
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.disabled = this.currentIndex === 0;
    prevBtn.onclick = () => void this.navigate(-1);

    const dropdownWrapper = stepperContainer.createDiv({ cls: "temperans-stepper-dropdown-wrapper" });
    createTemperansDropdown(dropdownWrapper, {
      value: currentHabit.id,
      options: this.habits.map((h, i) => ({
        value: h.id,
        label: `${h.name} (${i + 1} of ${this.habits.length})`
      })),
      ariaLabel: "Switch habit",
      onChange: (val) => void this.selectHabit(val)
    });

    this.saveStatusEl = stepperContainer.createSpan({ cls: "temperans-save-status", attr: { role: "status", "aria-live": "polite" } });
    this.setSaveStatus(this.saveStatus);

    // Next button with sleek Lucide chevron-right
    const nextBtn = stepperContainer.createEl("button", {
      cls: "temperans-stepper-nav-btn",
      attr: { type: "button", "aria-label": "Next habit" }
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.disabled = this.currentIndex === this.habits.length - 1;
    nextBtn.onclick = () => void this.navigate(1);

    // Habit form body
    const bodyContainer = contentEl.createDiv({ cls: "temperans-habit-log-body" });

    const isDuration = currentHabit.displayFormat === "duration" || currentHabit.id === "sleep";
    const isSession = currentHabit.type === "session" || currentHabit.id === "reading";

    if (isSession) {
      await this.renderSession(bodyContainer, currentHabit);
    } else if (currentHabit.id === "typing") {
      await this.renderTyping(bodyContainer, currentHabit);
    } else if (isDuration) {
      await this.renderDuration(bodyContainer, currentHabit);
    } else {
      await this.renderMetric(bodyContainer, currentHabit);
    }

    // Bottom Navigation footer
    const footer = contentEl.createDiv({ cls: "temperans-habit-stepper-footer" });

    const leftControls = footer.createDiv({ cls: "temperans-stepper-footer-left" });
    const backNav = leftControls.createEl("button", {
      text: "‹ Previous",
      attr: { type: "button" }
    });
    backNav.disabled = this.currentIndex === 0;
    backNav.onclick = () => void this.navigate(-1);

    // Dot indicators row between Previous and Next
    const dotsTrack = footer.createDiv({ cls: "temperans-stepper-dots" });
    for (let i = 0; i < this.habits.length; i++) {
      const h = this.habits[i];
      const isActive = i === this.currentIndex;
      const dot = dotsTrack.createEl("button", {
        cls: `temperans-stepper-dot${isActive ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-label": h.name,
          "data-tooltip-position": "top"
        }
      });
      dot.onclick = () => void this.selectHabit(h.id);
    }

    const rightControls = footer.createDiv({ cls: "temperans-stepper-footer-right" });

    if (this.currentIndex < this.habits.length - 1) {
      const nextNav = rightControls.createEl("button", {
        text: "Next ›",
        attr: { type: "button" }
      });
      nextNav.onclick = () => void this.navigate(1);
    }

    const finishBtn = rightControls.createEl("button", {
      cls: "mod-cta",
      text: "Finish",
      attr: { type: "button" }
    });
    finishBtn.onclick = () => void this.finish();
  }

  private async renderMetric(container: HTMLElement, habit: HabitDefinition): Promise<void> {
    const draft = this.metricDrafts.get(habit.id) ?? { amount: "", note: "", dirty: false };
    const currentValue = draft.amount.trim() ? parseHabitAmount(draft.amount, habit) ?? 0 : (this.logData.metrics[habit.id] ?? 0);

    const heroCard = container.createDiv({ cls: "temperans-hero-card" });
    this.renderHeroHeader(heroCard, habit, currentValue);

    const isAvoidance = habit.type === "avoidance";
    const isTracker = habit.type === "tracker";

    const desc = isAvoidance
      ? "Leave blank or 0 for a clean day. Enter slip count only if you slipped."
      : isTracker
      ? `Log value for this date in ${habit.unit}. Zero-goal habit (does not affect streaks).`
      : `Enter total in ${habit.unit}. Automatically saved on change or finish.`;

    const placeholder = isAvoidance
      ? "0 (clean day)"
      : `Amount (${habit.unit})`;

    new Setting(heroCard)
      .setName(habit.logging?.amount?.label ?? (isAvoidance ? "Incidents / Slips" : "Progress amount"))
      .setDesc(habit.logging?.amount?.description ?? (isTimeUnit(habit.unit) ? `Enter ${habit.unit}, H:MM, or a duration such as 1h 30m.` : desc))
      .addText((input) => {

        input.setPlaceholder(habit.logging?.amount?.placeholder ?? placeholder).setValue(draft.amount).onChange((value) => {
          draft.amount = value;
          draft.dirty = true;
          const num = parseHabitAmount(value, habit);
          if (num !== null) {
            this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, num, draft.note));
          }
        });
        input.inputEl.type = isTimeUnit(habit.unit) ? "text" : "number";
        input.inputEl.min = "0";
        input.inputEl.step = "any";
        input.inputEl.inputMode = isTimeUnit(habit.unit) ? "text" : "decimal";
      });

    // 1-Tap Quick Adjuster Pills
    if (isAvoidance && habit.logging?.quickEntry === undefined) {
      const quickRow = heroCard.createDiv({ cls: "temperans-quick-actions-row" });
      const cleanBtn = quickRow.createEl("button", { cls: "temperans-quick-pill is-clean", text: "✓ Clean Day (0)", attr: { type: "button" } });
      cleanBtn.onclick = () => {
        draft.amount = "0";
        draft.dirty = true;
        this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, 0, draft.note));
        void this.render();
      };
      const slipBtn = quickRow.createEl("button", { cls: "temperans-quick-pill is-slip", text: "+1 Slip", attr: { type: "button" } });
      slipBtn.onclick = () => {
        const cur = parseHabitAmount(draft.amount, habit) ?? 0;
        const next = cur + 1;
        draft.amount = String(next);
        draft.dirty = true;
        this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, next, draft.note));
        void this.render();
      };
    } else {
      this.renderQuickEntries(heroCard, habit, {
        values: habit.unit === "minutes"
          ? [5, 15, 30]
          : (habit.unit === "ml" || habit.id === "hydration")
          ? [100, 250, 500, 750]
          : habit.unit === "kcal"
          ? [100, 250, 500]
          : [1, 5, 10],
        mode: "add", showClear: true
      }, () => parseHabitAmount(draft.amount, habit) ?? 0, (value) => {
        draft.amount = value === null ? "" : String(value);
        draft.dirty = true;
        this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, value ?? 0, draft.note));
        void this.render();
      });
    }

    new Setting(heroCard)
      .setName(habit.logging?.remark?.label ?? "Session remark")
      .setDesc(habit.logging?.remark?.description ?? "Optional short note.")
      .addText((input) => {

        input.setPlaceholder(habit.logging?.remark?.placeholder ?? (isAvoidance ? "e.g. Trigger / remark" : "e.g. Focused session")).setValue(draft.note).onChange((value) => {
          draft.note = value;
          draft.dirty = true;
          const num = draft.amount.trim() ? parseHabitAmount(draft.amount, habit) : (this.logData.metrics[habit.id] ?? 0);
          if (num !== null) this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, num, draft.note));
        });
      });

    this.renderEndpointSyncRow(heroCard, habit);
  }

  private async renderDuration(container: HTMLElement, habit: HabitDefinition): Promise<void> {
    const draft = this.durationDrafts.get(habit.id) ?? { duration: "", note: "", dirty: false };
    const currentMinutes = parseSleepDuration(draft.duration) ?? (this.logData.metrics[habit.id] ?? 0);

    const heroCard = container.createDiv({ cls: "temperans-hero-card" });
    this.renderHeroHeader(heroCard, habit, currentMinutes);

    new Setting(heroCard)
      .setName(habit.logging?.amount?.label ?? "Duration")
      .setDesc(habit.logging?.amount?.description ?? "Enter hours, H:MM, or a duration such as 7h 30m. Automatically saved.")
      .addText((input) => {

        input.setPlaceholder(habit.logging?.amount?.placeholder ?? "7:30").setValue(draft.duration).onChange((value) => {
          draft.duration = value;
          draft.dirty = true;
          const mins = parseSleepDuration(value);
          if (mins !== null) {
            this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, mins, draft.note));
          }
        });
        input.inputEl.inputMode = "text";
      });

    this.renderQuickEntries(heroCard, habit, { values: ["7:00", "7:30", "8:00", "8:30"], mode: "set", showClear: false },
      () => parseSleepDuration(draft.duration) ?? 0, (value) => {
        draft.duration = value === null ? "" : sleepInputValue(value);
        draft.dirty = true;
        this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, value ?? 0, draft.note));
        void this.render();
      }, parseSleepDuration);

    new Setting(heroCard)
      .setName(habit.logging?.remark?.label ?? "Session remark")
      .setDesc(habit.logging?.remark?.description ?? "Optional short note.")
      .addText((input) => {

        input.setPlaceholder(habit.logging?.remark?.placeholder ?? "e.g. Well rested").setValue(draft.note).onChange((value) => {
          draft.note = value;
          draft.dirty = true;
          const mins = parseSleepDuration(draft.duration) ?? (this.logData.metrics[habit.id] ?? 0);
          this.queueSave(habit.id, () => this.store.recordMetric(this.date, habit.id, mins, draft.note));
        });
      });

    this.renderEndpointSyncRow(heroCard, habit);
  }

  private async renderTyping(container: HTMLElement, habit: HabitDefinition): Promise<void> {
    const draft = this.typingDrafts.get(habit.id) ?? { duration: "", tests: "", note: "", dirty: false };

    new Setting(container)
      .setName(habit.logging?.amount?.label ?? "Practice duration")
      .setDesc(habit.logging?.amount?.description ?? "Enter minutes, M:SS (e.g. 14:24), or a duration such as 14m 24s.")
      .addText((input) => {

        input.setPlaceholder(habit.logging?.amount?.placeholder ?? "14:24").setValue(draft.duration).onChange((value) => {
          draft.duration = value;
          draft.dirty = true;
          const durSec = parseTypingDuration(value);
          const tests = draft.tests.trim() ? Number(draft.tests) : 0;
          if (durSec !== null && Number.isInteger(tests) && tests >= 0) {
            this.queueSave(habit.id, () => this.store.recordManualTyping(this.date, durSec, tests, draft.note));
          }
        });
        input.inputEl.inputMode = "text";
      });

    new Setting(container)
      .setName("Tests completed")
      .addText((input) => {

        input.setPlaceholder("0").setValue(draft.tests).onChange((value) => {
          draft.tests = value;
          draft.dirty = true;
          const durSec = parseTypingDuration(draft.duration) ?? (this.logData.typing?.manualDurationSeconds ?? 0);
          const tests = value.trim() ? Number(value) : 0;
          if (durSec !== null && Number.isInteger(tests) && tests >= 0) {
            this.queueSave(habit.id, () => this.store.recordManualTyping(this.date, durSec, tests, draft.note));
          }
        });
        input.inputEl.type = "number";
        input.inputEl.min = "0";
        input.inputEl.step = "1";
        input.inputEl.inputMode = "numeric";
      });

    new Setting(container)
      .setName(habit.logging?.remark?.label ?? "Optional note")
      .setDesc(habit.logging?.remark?.description ?? "")
      .addText((input) => {

        input.setPlaceholder(habit.logging?.remark?.placeholder ?? "e.g. Focused practice").setValue(draft.note).onChange((value) => {
          draft.note = value;
          draft.dirty = true;
          const durSec = parseTypingDuration(draft.duration) ?? (this.logData.typing?.manualDurationSeconds ?? 0);
          const tests = draft.tests.trim() ? Number(draft.tests) : (this.logData.typing?.manualTests ?? 0);
          this.queueSave(habit.id, () => this.store.recordManualTyping(this.date, durSec, tests, draft.note));
        });
      });

    this.renderQuickEntries(container, habit, { values: [], mode: "set", showClear: false },
      () => parseTypingDuration(draft.duration) ?? 0, (value) => {
        const tests = draft.tests.trim() ? Number(draft.tests) : 0;
        if (!Number.isInteger(tests) || tests < 0) return;
        draft.duration = value === null ? "" : typingInputValue(value);
        draft.dirty = true;
        this.queueSave(habit.id, () => this.store.recordManualTyping(this.date, value ?? 0, tests, draft.note));
        void this.render();
      }, parseTypingDuration);

    if (this.logData?.metricSources?.typing === "endpoint" || (this.logData?.typing?.imported?.length ?? 0) > 0) {
      const syncedSeconds = (this.logData.typing.imported.length > 0)
        ? this.logData.typing.imported.reduce((sum: number, r: any) => sum + r.durationSeconds, 0)
        : this.logData.typing.manualDurationSeconds;
      container.createEl("p", {
        cls: "temperans-endpoint-synced-hint",
        text: `An automated endpoint supplied ${formatTypingDuration(syncedSeconds)} for this day. Manual entries override automated data.`
      });
    }

    this.renderEndpointSyncRow(container, habit);
  }

  private async renderSession(container: HTMLElement, habit: HabitDefinition): Promise<void> {
    const sessions: HabitSession[] = this.logData.sessions?.[habit.id] ?? (habit.id === "reading" ? this.logData.reading ?? [] : []);

    // Existing sessions list
    if (sessions.length > 0) {
      const listContainer = container.createDiv({ cls: "temperans-sessions-list-container" });
      listContainer.createEl("strong", { text: `Recorded sessions (${sessions.length})` });
      const list = listContainer.createDiv({ cls: "temperans-modal-sessions-list" });

      for (const [idx, session] of sessions.entries()) {
        const item = list.createDiv({ cls: "temperans-modal-session-item" });
        const textInfo = item.createDiv({ cls: "temperans-session-info" });
        textInfo.createSpan({ cls: "temperans-session-item-title", text: session.title });

        const parts: string[] = [];
        if (session.pages !== undefined) parts.push(`${session.pages} pages`);
        if (session.chapters !== undefined) parts.push(`${session.chapters} ch`);
        if (session.minutes !== undefined) parts.push(`${session.minutes} min`);
        if (session.reps !== undefined) parts.push(`${session.reps} reps`);
        if (session.count !== undefined) parts.push(`${session.count} ${habit.unit}`);

        if (parts.length > 0) {
          textInfo.createSpan({ cls: "temperans-session-item-badge", text: parts.join(" · ") });
        }
        if (session.note) {
          textInfo.createSpan({ cls: "temperans-session-item-note", text: `"${session.note}"` });
        }

        const deleteBtn = item.createEl("button", {
          cls: "temperans-task-order-button mod-warning",
          attr: { type: "button", "aria-label": "Delete session" }
        });
        setIcon(deleteBtn, "trash-2");
        deleteBtn.onclick = async () => {
          deleteBtn.disabled = true;
          try {
            await this.store.deleteSession(this.date, habit.id, idx, session);
            this.logData = await this.store.getLog(this.date);
            await this.render();
          } catch (error) { this.reportSaveError(error); }
          finally { deleteBtn.disabled = false; }
        };
      }
    }

    // Add new session subsection
    const newSessionBox = container.createDiv({ cls: "temperans-add-session-box" });
    newSessionBox.createEl("h4", { text: "Add a session" });

    const draft = this.sessionDrafts.get(habit.id) ?? {
      title: "",
      pages: "",
      chapters: "",
      minutes: "",
      reps: "",
      count: "",
      note: ""
    };

    const titlePlaceholder = habit.id === "reading" ? "Book or text title" : "Session / activity title";
    new Setting(newSessionBox).setName(habit.logging?.title?.label ?? "Title / Activity").setDesc(habit.logging?.title?.description ?? "").addText((input) => {

      input.setPlaceholder(habit.logging?.title?.placeholder ?? titlePlaceholder).setValue(draft.title).onChange((value) => { draft.title = value; });
    });

    const fields: Array<[keyof Pick<HabitSession, "pages" | "chapters" | "minutes" | "reps" | "count">, string]> =
      isTimeUnit(habit.unit) ? [["minutes", cadenceLabel(habit.unit)]]
      : habit.unit === "pages" || habit.id === "reading"
      ? [["pages", "Pages"], ["chapters", "Chapters (optional)"], ["minutes", "Minutes (optional)"]]
      : habit.unit === "reps" ? [["reps", "Reps"], ["minutes", "Minutes (optional)"]]
      : [["count", `Amount (${habit.unit})`]];
    for (const [key, label] of fields) {
      const options = key === fields[0][0] ? habit.logging?.amount : undefined;
      new Setting(newSessionBox).setName(options?.label ?? label).setDesc(options?.description ?? "").addText((input) => {

        input.setPlaceholder(options?.placeholder ?? (key === "minutes" ? (habit.unit === "hours" ? "1.5 or 1:30" : "30 or 0:30") : "0")).setValue(draft[key]).onChange((value) => { draft[key] = value; });
        input.inputEl.type = key === "minutes" ? "text" : "number";
        input.inputEl.min = "0";
        input.inputEl.inputMode = key === "minutes" ? "text" : "numeric";
      });
    }

    const primaryField = fields[0][0];
    const parseSessionAmount = (value: string) => primaryField === "minutes"
      ? parseTimeValue(value, isTimeUnit(habit.unit) ? habit.unit : "minutes") : parseHabitAmount(value, { unit: "count" });
    this.renderQuickEntries(newSessionBox, habit, { values: [], mode: "add", showClear: false },
      () => parseSessionAmount(draft[primaryField]) ?? 0, (value) => {
        draft[primaryField] = value === null ? "" : String(value);
        void this.render();
      }, parseSessionAmount);

    new Setting(newSessionBox).setName(habit.logging?.remark?.label ?? "Session note (optional)").setDesc(habit.logging?.remark?.description ?? "").addText((input) => {

      input.setPlaceholder(habit.logging?.remark?.placeholder ?? "What did you work on?").setValue(draft.note).onChange((value) => { draft.note = value; });
    });

    const addBtnRow = new Setting(newSessionBox).addButton((button) => button
      .setButtonText("Add session")
      .onClick(async () => {
        if (!Object.values(draft).some(value => value.trim())) { new Notice("Enter a session amount first."); return; }
        button.setDisabled(true);
        try {
          await this.flushCurrentHabit();
          this.logData = await this.store.getLog(this.date);
          await this.render();
        } catch (error) { this.reportSaveError(error); }
        finally { button.setDisabled(false); }
      }));
    addBtnRow.settingEl.addClass("temperans-add-session-btn-row");

    this.renderEndpointSyncRow(container, habit);
  }

  private renderQuickEntries(
    container: HTMLElement, habit: HabitDefinition, defaults: Required<QuickEntryConfig>,
    current: () => number, onValue: (value: number | null) => void,
    parse: (value: string) => number | null = (value) => parseHabitAmount(value, habit)
  ): void {
    const configured = habit.logging?.quickEntry;
    if (configured === false) return;
    const { values, mode, showClear } = { ...defaults, ...configured };
    const entries = values.map(value => ({ label: String(value), amount: typeof value === "number" ? value : parse(value) }))
      .filter((entry): entry is { label: string; amount: number } => entry.amount !== null && Number.isFinite(entry.amount) && entry.amount >= 0);
    if (!entries.length && !showClear) return;
    const row = container.createDiv({ cls: "temperans-quick-actions-row" });
    for (const entry of entries) {
      const button = row.createEl("button", { cls: "temperans-quick-pill", text: mode === "add" ? `+${entry.label}` : entry.label, attr: { type: "button" } });
      button.onclick = () => {
        const amount = mode === "add" ? current() + entry.amount : entry.amount;
        if (Number.isFinite(amount)) onValue(amount);
      };
    }
    if (showClear) {
      const clear = row.createEl("button", { cls: "temperans-quick-pill is-clear", text: "Clear", attr: { type: "button" } });
      clear.onclick = () => onValue(null);
    }
  }

  private renderEndpointSyncRow(container: HTMLElement, habit: HabitDefinition): void {
    if (!habit.endpoint || !this.onEndpointSync) return;
    new Setting(container)
      .setName("Sync from external endpoint")
      .setDesc(`Fetches the past 7 days from this task's configured API (${habit.endpoint.url}) without overwriting manual data.`)
      .addButton((button) => button
        .setButtonText("Sync past 7 days")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.flushCurrentHabit();
            await this.onEndpointSync?.(habit.id);
            this.metricDrafts.delete(habit.id); this.durationDrafts.delete(habit.id); this.typingDrafts.delete(habit.id);
            await this.initDrafts();
            await this.render();
          } catch (error) { this.reportSaveError(error); }
          finally { button.setDisabled(false); }
        }));
  }

  onClose(): void {
    this.stopFollowingViewport?.();
    this.stopFollowingViewport = undefined;
    if (this.saveTimer) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.saveTimer);
    this.contentEl.empty();
  }
}

export class EditHabitModal extends Modal {
  constructor(
    app: App,
    private readonly habit: HabitDefinition,
    private readonly timezone: string,
    private readonly onSave: (updated: HabitDefinition) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-edit-habit-modal");
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Edit habit — ${this.habit.name}` });

    let name = this.habit.name;
    let habitCategory: "build" | "avoidance" | "tracker" = this.habit.type === "avoidance"
      ? "avoidance"
      : this.habit.type === "tracker"
      ? "tracker"
      : "build";

    let unit = this.habit.unit;
    let cadence: HabitCadence = this.habit.cadence;
    let enabled = this.habit.enabled;
    let isSessionHabit = this.habit.type === "session" || this.habit.id === "reading";

    const latestTarget = this.habit.targetHistory.at(-1);
    let minimum = latestTarget?.min !== undefined ? String(latestTarget.min) : "30";
    let maximum = latestTarget?.max !== undefined ? String(latestTarget.max) : "";

    new Setting(contentEl).setName("Habit name").addText((input) => input
      .setValue(name)
      .onChange((value) => { name = value; }));

    new Setting(contentEl).setName("Enabled").setDesc("Disable to hide this habit from your daily completion score.")
      .addToggle((toggle) => toggle.setValue(enabled).onChange((val) => { enabled = val; }));

    const habitTypeSetting = new Setting(contentEl)
      .setName("Habit type")
      .setDesc("Build habit (positive target), avoidance habit (negative/avoid), or zero-goal tracker.");

    const categoryOptions = [
      { value: "build", label: "Build habit (positive target)" },
      { value: "avoidance", label: "Avoidance habit (negative / quit)" },
      { value: "tracker", label: "Zero-goal tracker (non-streak)" }
    ];

    const targetSection = contentEl.createDiv({ cls: "temperans-habit-targets-section" });
    const sessionSection = contentEl.createDiv({ cls: "temperans-habit-options-section" });

    const updateSectionsVisibility = () => {
      targetSection.empty();
      sessionSection.empty();

      if (habitCategory === "avoidance") {
        new Setting(targetSection)
          .setName("Tolerance limit (max slips)")
          .setDesc("0 means complete abstinence. Entering 0 or leaving unlogged is a success and builds your streak. Any value above this counts as a slip.")
          .addText((input) => {
            input.setValue(maximum || "0").onChange((value) => { maximum = value; });
            input.inputEl.type = "number";
            input.inputEl.min = "0";
            input.inputEl.step = "any";
          });
      } else if (habitCategory === "tracker") {
        targetSection.createEl("p", {
          cls: "temperans-habit-type-hint",
          text: "Zero-goal habit: logs data without a target to reach or avoid. Missing a day will never break your daily streaks or lower your completion score."
        });
      } else {
        // Build habit
        new Setting(targetSection)
          .setName("Minimum target")
          .setDesc("Required.")
          .addText((input) => {
            input.setValue(minimum).onChange((val) => { minimum = val; });
            input.inputEl.type = "number";
            input.inputEl.min = "0";
            input.inputEl.step = "any";
          });

        new Setting(targetSection)
          .setName("Maximum target")
          .setDesc("Optional ceiling (useful for bounded ranges such as calories).")
          .addText((input) => {
            input.setValue(maximum).onChange((val) => { maximum = val; });
            input.inputEl.type = "number";
            input.inputEl.min = "0";
            input.inputEl.step = "any";
          });

        new Setting(sessionSection)
          .setName("Multi-entry sessions")
          .setDesc("Log multiple entries with titles and notes throughout the day.")
          .addToggle((toggle) => toggle.setValue(isSessionHabit).onChange((v) => { isSessionHabit = v; }));

      }
    };

    createTemperansDropdown(habitTypeSetting.controlEl, {
      value: habitCategory,
      options: categoryOptions,
      ariaLabel: "Choose habit type",
      onChange: (value) => {
        habitCategory = value as "build" | "avoidance" | "tracker";
        updateSectionsVisibility();
      }
    });

    const isPreset = Object.keys(UNIT_LABELS).includes(unit) && unit !== "custom";
    let selectedUnitChoice = isPreset ? unit : "custom";
    let customUnitValue = isPreset ? "" : unit;

    const unitSetting = new Setting(contentEl).setName("Unit");
    const customUnitContainer = contentEl.createDiv({ cls: "temperans-custom-unit-setting" });
    if (isPreset) customUnitContainer.addClass("temperans-hidden");

    new Setting(customUnitContainer)
      .setName("Custom unit name")
      .addText((input) => {
        input.setValue(customUnitValue);
        input.onChange((val) => { customUnitValue = val.trim(); });
      });

    createTemperansDropdown(unitSetting.controlEl, {
      value: selectedUnitChoice,
      options: Object.keys(UNIT_LABELS).map((v) => ({ value: v, label: UNIT_LABELS[v] })),
      ariaLabel: "Choose a task unit",
      onChange: (value) => {
        selectedUnitChoice = value;
        customUnitContainer.toggleClass("temperans-hidden", value !== "custom");
      }
    });

    const cadenceSetting = new Setting(contentEl).setName("Goal cadence");
    createTemperansDropdown(cadenceSetting.controlEl, {
      value: cadence,
      options: CADENCE_OPTIONS,
      ariaLabel: "Choose a goal cadence",
      onChange: (value) => { cadence = value as HabitCadence; }
    });

    updateSectionsVisibility();

    const saveRow = new Setting(contentEl).addButton((button) => button
      .setButtonText("Save changes")
      .onClick(async () => {
        if (!name.trim()) return new Notice("Enter a habit name.");

        let targetHistory = [...this.habit.targetHistory];
        const today = todayInZone(this.timezone);
        let finalType: HabitType = "metric";

        if (habitCategory === "avoidance") {
          finalType = "avoidance";
          const max = maximum.trim() ? Number(maximum) : 0;
          if (!Number.isFinite(max) || max < 0) return new Notice("Enter a valid tolerance limit (0 or more).");
          const lastIdx = targetHistory.length - 1;
          if (lastIdx >= 0 && targetHistory[lastIdx].effectiveDate === today) {
            targetHistory[lastIdx] = { effectiveDate: today, max };
          } else {
            targetHistory.push({ effectiveDate: today, max });
          }
        } else if (habitCategory === "tracker") {
          finalType = "tracker";
          const lastIdx = targetHistory.length - 1;
          if (lastIdx >= 0 && targetHistory[lastIdx].effectiveDate === today) {
            targetHistory[lastIdx] = { effectiveDate: today };
          } else {
            targetHistory.push({ effectiveDate: today });
          }
        } else {
          finalType = isSessionHabit ? "session" : "metric";
          const min = Number(minimum);
          const max = maximum.trim() ? Number(maximum) : undefined;
          if (!Number.isFinite(min) || min < 0) return new Notice("Enter a valid minimum target.");
          if (max !== undefined && (!Number.isFinite(max) || max < min)) return new Notice("The maximum must be at least the minimum.");

          const lastIdx = targetHistory.length - 1;
          if (lastIdx >= 0 && targetHistory[lastIdx].effectiveDate === today) {
            targetHistory[lastIdx] = { effectiveDate: today, min, ...(max !== undefined ? { max } : {}) };
          } else {
            targetHistory.push({ effectiveDate: today, min, ...(max !== undefined ? { max } : {}) });
          }
        }

        const effectiveUnit = selectedUnitChoice === "custom" ? (customUnitValue || "count") : selectedUnitChoice;

        await this.onSave({
          ...this.habit,
          name: name.trim(),
          unit: effectiveUnit,
          cadence,
          enabled,
          type: finalType,
          targetHistory
        });
        new Notice(`${name.trim()} updated.`);
        this.close();
      }));
    saveRow.settingEl.addClass("temperans-modal-save-row");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
