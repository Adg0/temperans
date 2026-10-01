import { createSubpageCard } from "../ui";
import { App, Modal, Notice, Platform, Setting, setIcon } from "obsidian";
import { PeerSyncComparison, PeerSyncService, PeerSyncTransferResult } from "./service";
import { PeerSyncAction, PeerSyncPlanItem } from "./protocol";
import { createPairingUri, generateQrSvg, parsePairingPayload } from "./qr";

function statusLabel(item: PeerSyncPlanItem): string {
  if (item.status === "same") return "Up to date";
  if (item.status === "local-only") return "Only here";
  if (item.status === "remote-only") return "Only on paired device";
  return "Different versions";
}

export class PeerSyncModal extends Modal {
  private comparison: PeerSyncComparison | null = null;
  private actions = new Map<string, PeerSyncAction>();
  private selectedPaths = new Set<string>();
  private rowUpdaters = new Map<string, () => void>();
  private selectionCountEl: HTMLElement | null = null;
  private selectAllInput: HTMLInputElement | null = null;
  private transferButton: HTMLButtonElement | null = null;
  private transferSummaryEl: HTMLElement | null = null;
  private selectablePathCount = 0;
  private results: PeerSyncTransferResult[] = [];

  constructor(app: App, private readonly service: PeerSyncService) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("temperans-modal", "temperans-peer-sync-modal");
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Peer sync" });
    contentEl.createEl("p", { text: "Sync habit settings and daily logs with your paired device." });
    if (Platform.isDesktopApp) await this.renderHostControls(contentEl);
    await this.renderRemoteControls(contentEl);
    if (this.comparison) this.renderComparison(contentEl);
    if (this.results.length) this.renderResults(contentEl);
  }

  private async renderHostControls(container: HTMLElement): Promise<void> {
    container.createEl("h3", { text: "Desktop host" });
    let port = String(this.service.activeHostInfo?.port ?? this.service.configuredPort);
    new Setting(container).setName("Local host port").setDesc("Keep this stable so paired Android devices can reconnect.").addText((input) => {
      input.setValue(port).onChange((value) => { port = value; });
      input.inputEl.type = "number";
      input.inputEl.min = "1024";
      input.inputEl.max = "65535";
    });
    if (this.service.isHosting) {
      const info = this.service.activeHostInfo!;
      const code = await this.service.getHostPairingCode();
      const primaryIp = info.addresses[0];
      const primaryAddress = primaryIp ? `http://${primaryIp}:${info.port}` : "";
      container.createEl("p", { text: "Scan the QR code with your mobile camera or copy the pairing details below." });
      if (primaryAddress) {
        const uri = createPairingUri(primaryIp, info.port, code);
        const qrBlock = container.createDiv({ cls: "temperans-peer-sync-qr-block" });
        const svgMarkup = generateQrSvg(uri, 200);
        try {
          const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
          const svgNode = parsed.querySelector("svg");
          if (svgNode) qrBlock.appendChild(qrBlock.ownerDocument.importNode(svgNode, true));
        } catch {
          // Fallback if parsing fails
        }
        qrBlock.createSpan({
          text: "Scan with mobile camera to connect automatically",
          cls: "temperans-scanner-status"
        });

        // Display strictly the single primary working address
        const addressBoxes = container.createDiv({ cls: "temperans-peer-sync-selectable-values" });
        this.createSelectableValue(addressBoxes, "Desktop address", primaryAddress, "Desktop address");
      } else {
        container.createEl("p", { text: `No LAN IPv4 address found. Port ${info.port} is listening.`, cls: "temperans-peer-sync-host-info" });
      }
      const pairingBox = container.createDiv({ cls: "temperans-peer-sync-selectable-values" });
      this.createSelectableValue(pairingBox, "Pairing code", code, "Peer-sync pairing code");
      new Setting(container).addButton((button) => button.setButtonText("Stop host").onClick(async () => {
        await this.service.stopHost();
        this.comparison = null;
        await this.render();
      })).addButton((button) => button.setButtonText("Regenerate code").setWarning().onClick(async () => {
        await this.service.regenerateHostPairingCode();
        new Notice("Pairing code regenerated. Existing clients must enter the new code.");
        await this.render();
      }));
      return;
    }
    new Setting(container)
      .addButton((button) => button.setButtonText("Start local host").setCta().onClick(async () => {
        const parsedPort = Number(port);
        try {
          await this.service.setHostPort(parsedPort);
          await this.service.startHost();
          await this.render();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "Could not start the peer-sync host.");
        }
      }))
      .addButton((button) => button.setButtonText("Regenerate pairing code").setWarning().onClick(async () => {
        await this.service.regenerateHostPairingCode();
        new Notice("Pairing code regenerated. Start the host to display it, and update any paired clients.");
      }));
  }

  private async renderRemoteControls(container: HTMLElement): Promise<void> {
    container.createEl("h3", { text: "Paired desktop" });
    const profile = await this.service.getRemoteProfile();
    let currentInput = profile.url && profile.secret ? `${profile.url}#${profile.secret}` : (profile.url || "");

    const connectionSetting = new Setting(container)
      .setName("Connection detail")
      .setDesc("Paste or enter pairing link, address with code, or tap the paste icon.");

    let textInputEl: HTMLInputElement | null = null;
    connectionSetting.addText((input) => {
      textInputEl = input.inputEl;
      input.setPlaceholder("http://192.168.1.20:43887#CODE or paste QR link");
      input.setValue(currentInput);
      input.onChange(async (value) => {
        currentInput = value.trim();
        const parsed = parsePairingPayload(currentInput);
        if (parsed) {
          await this.service.saveRemoteProfile(parsed.url, parsed.secret);
        }
      });
      input.inputEl.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await applyAndCompare();
        }
      });
    });

    connectionSetting.addExtraButton((button) => {
      button.setIcon("clipboard-paste");
      button.setTooltip("Paste connection details from clipboard");
      button.onClick(async () => {
        try {
          const text = await navigator.clipboard.readText();
          const parsed = parsePairingPayload(text);
          if (!parsed) {
            new Notice("Clipboard does not contain a valid pairing address or code.");
            return;
          }
          currentInput = `${parsed.url}#${parsed.secret}`;
          if (textInputEl) textInputEl.value = currentInput;
          await this.service.saveRemoteProfile(parsed.url, parsed.secret);
          new Notice("Configured desktop connection from clipboard!");
          this.results = [];
          this.comparison = await this.service.compare();
          this.resetTransferSelection(this.comparison);
          await this.render();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "Could not read clipboard.");
        }
      });
    });

    const applyAndCompare = async () => {
      try {
        const parsed = parsePairingPayload(currentInput);
        if (parsed) {
          await this.service.saveRemoteProfile(parsed.url, parsed.secret);
        } else {
          const active = await this.service.getRemoteProfile();
          if (!active.url || !active.secret) {
            new Notice("Enter or paste a valid desktop address and pairing code first.");
            return;
          }
        }
        this.results = [];
        this.comparison = await this.service.compare();
        this.resetTransferSelection(this.comparison);
        await this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not compare devices.");
      }
    };

    new Setting(container)
      .addButton((button) => button.setButtonText("Compare").onClick(applyAndCompare))
      .addButton((button) => button.setButtonText("Forget paired device").setWarning().onClick(async () => {
        await this.service.forgetRemoteProfile();
        currentInput = "";
        if (textInputEl) textInputEl.value = "";
        this.comparison = null;
        this.actions.clear();
        this.selectedPaths.clear();
        this.results = [];
        await this.render();
      }));
  }

  private renderComparison(container: HTMLElement): void {
    const comparison = this.comparison;
    if (!comparison) return;
    const changedItems = comparison.plan.filter((item) => item.status !== "same");

    const { card, header: heading } = createSubpageCard(container, "files", "Transfer preview");
    card.addClass("temperans-peer-sync-preview");
    const refresh = heading.createEl("button", {
      cls: "temperans-peer-sync-preview-refresh",
      attr: { type: "button", "aria-label": "Refresh transfer preview", "aria-description": "Compare the current files again" }
    });
    setIcon(refresh, "rotate-cw");
    refresh.setAttribute("title", "Refresh preview");
    refresh.onclick = () => void this.refreshComparison();

    if (!changedItems.length) {
      const empty = card.createDiv({ cls: "temperans-peer-sync-empty" });
      setIcon(empty.createSpan({ cls: "temperans-peer-sync-empty-icon" }), "circle-check");
      empty.createEl("strong", { text: "All caught up" });
      empty.createSpan({ text: "Your habit files match on both devices." });
      return;
    }

    const summary = card.createDiv({ cls: "temperans-peer-sync-summary" });
    for (const [status, label] of [["local-only", "Only here"], ["remote-only", "Only paired"], ["different", "Different"]]) {
      const stat = summary.createDiv({ cls: `temperans-peer-sync-stat is-${status}` });
      stat.createEl("strong", { text: String(changedItems.filter(item => item.status === status).length) });
      stat.createSpan({ text: label });
    }

    const syncContainer = card.createDiv({ cls: "temperans-peer-sync-container" });
    this.selectablePathCount = changedItems.length;
    this.rowUpdaters.clear();

    // 1. Batch Toolbar
    this.renderBatchToolbar(syncContainer, changedItems);

    // Keep long comparisons contained while actions remain outside the list.
    const scrollList = syncContainer.createDiv({ cls: "temperans-peer-sync-scroll-list", attr: { role: "region", "aria-label": "Differing habit files", tabindex: "0" } });
    for (const item of changedItems) {
      this.renderFileRow(scrollList, item);
    }

    // 3. Persistent Action Bar with Transfer Button
    const actionBar = syncContainer.createDiv({ cls: "temperans-peer-sync-actions" });
    this.transferSummaryEl = actionBar.createSpan({ cls: "temperans-peer-sync-transfer-summary", attr: { "aria-live": "polite" } });
    const transferBtn = actionBar.createEl("button", {
      cls: "mod-cta",
      attr: { type: "button" }
    });
    this.transferButton = transferBtn;
    transferBtn.onclick = async () => {
      const selectedActions = new Map(comparison.plan.map((item) => [
        item.path,
        this.selectedPaths.has(item.path) ? (this.actions.get(item.path) ?? item.defaultAction) : "skip"
      ]));
      transferBtn.disabled = true;
      transferBtn.setText("Transferring…");
      try {
        const results = await this.service.transfer(comparison.plan, selectedActions);
        this.results = results.length ? results : [{ path: "", action: "skip", ok: true, message: "No files were selected." }];
        await this.refreshComparison({ preserveResults: true });
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not transfer files.");
      } finally {
        this.updateTransferUI();
      }
    };

    this.updateTransferUI(changedItems);
  }

  private renderBatchToolbar(container: HTMLElement, items: PeerSyncPlanItem[]): void {
    const toolbar = container.createDiv({ cls: "temperans-peer-sync-toolbar" });

    // Left: Select all checkbox + count
    const selectGroup = toolbar.createDiv({ cls: "temperans-peer-sync-select-group" });
    const selectAllLabel = selectGroup.createEl("label", { cls: "temperans-peer-sync-select-all" });
    const selectAll = selectAllLabel.createEl("input", {
      attr: { type: "checkbox", "aria-label": "Select or clear all differing files" }
    });
    this.selectAllInput = selectAll;
    selectAllLabel.createSpan({ text: "Select all" });
    this.selectionCountEl = selectGroup.createSpan({ cls: "temperans-peer-sync-selection-count" });

    selectAll.onchange = () => {
      const shouldSelect = selectAll.checked;
      for (const item of items) {
        if (shouldSelect) {
          this.selectedPaths.add(item.path);
          if (!this.actions.has(item.path) || this.actions.get(item.path) === "skip") {
            const defAction = item.defaultAction !== "skip" ? item.defaultAction : (item.local ? "upload" : "download");
            this.actions.set(item.path, defAction);
          }
        } else {
          this.selectedPaths.delete(item.path);
        }
      }
      this.refreshRowViews();
      this.updateTransferUI(items);
    };

    // Right: Bulk direction shortcuts
    const batchButtons = toolbar.createDiv({ cls: "temperans-peer-sync-batch-buttons" });

    const sendAllBtn = batchButtons.createEl("button", {
      cls: "temperans-peer-sync-direction-btn",
      text: "↑ Send selected",
      attr: { type: "button", title: "Set all selected files to send to desktop" }
    });
    sendAllBtn.onclick = () => {
      let count = 0;
      for (const item of items) {
        if (this.selectedPaths.has(item.path) && item.local) {
          this.actions.set(item.path, "upload");
          count += 1;
        }
      }
      if (count > 0) new Notice(`Set ${count} file${count === 1 ? "" : "s"} to send to desktop.`);
      else new Notice("None of the selected files exist on this device to send.");
      this.refreshRowViews();
      this.updateTransferUI(items);
    };

    const receiveAllBtn = batchButtons.createEl("button", {
      cls: "temperans-peer-sync-direction-btn",
      text: "↓ Receive selected",
      attr: { type: "button", title: "Set all selected files to receive from desktop" }
    });
    receiveAllBtn.onclick = () => {
      let count = 0;
      for (const item of items) {
        if (this.selectedPaths.has(item.path) && item.remote) {
          this.actions.set(item.path, "download");
          count += 1;
        }
      }
      if (count > 0) new Notice(`Set ${count} file${count === 1 ? "" : "s"} to receive from desktop.`);
      else new Notice("None of the selected files exist on the desktop to receive.");
      this.refreshRowViews();
      this.updateTransferUI(items);
    };
  }

  private renderFileRow(container: HTMLElement, item: PeerSyncPlanItem): void {
    const row = container.createDiv({ cls: "temperans-peer-sync-row" });

    // Left: Checkbox + File Info
    const left = row.createDiv({ cls: "temperans-peer-sync-row-left" });
    const checkbox = left.createEl("input", {
      attr: { type: "checkbox", "aria-label": `Select ${item.path}` }
    });

    setIcon(left.createSpan({ cls: "temperans-peer-sync-file-icon" }), item.path === "Settings.md" ? "settings-2" : "file-text");
    const info = left.createDiv({ cls: "temperans-peer-sync-row-info" });
    const filename = item.path.split("/").pop()!;
    info.createSpan({ text: filename === "Settings.md" ? "Habit settings" : filename.replace(/\.md$/, ""), cls: "temperans-peer-sync-row-name" });
    info.createSpan({ text: item.path, cls: "temperans-peer-sync-row-path", attr: { title: item.path } });
    info.createSpan({ text: statusLabel(item), cls: `temperans-peer-sync-row-status is-${item.status}` });

    // Right: Direction Buttons
    const actionsContainer = row.createDiv({ cls: "temperans-peer-sync-row-actions" });

    let uploadBtn: HTMLButtonElement | null = null;
    let downloadBtn: HTMLButtonElement | null = null;

    if (item.local) {
      uploadBtn = actionsContainer.createEl("button", {
        cls: "temperans-peer-sync-direction-btn",
        text: "↑ Send",
        attr: { type: "button", title: "Send this file to paired device", "aria-label": `Send ${item.path}`, "aria-pressed": "false" }
      });
      uploadBtn.onclick = () => {
        this.selectedPaths.add(item.path);
        this.actions.set(item.path, "upload");
        this.refreshRowViews();
        this.updateTransferUI();
      };
    }

    if (item.remote) {
      downloadBtn = actionsContainer.createEl("button", {
        cls: "temperans-peer-sync-direction-btn",
        text: "↓ Receive",
        attr: { type: "button", title: "Receive this file from paired device", "aria-label": `Receive ${item.path}`, "aria-pressed": "false" }
      });
      downloadBtn.onclick = () => {
        this.selectedPaths.add(item.path);
        this.actions.set(item.path, "download");
        this.refreshRowViews();
        this.updateTransferUI();
      };
    }

    const updateView = () => {
      const isSelected = this.selectedPaths.has(item.path);
      const action = this.actions.get(item.path) ?? (isSelected ? item.defaultAction : "skip");

      checkbox.checked = isSelected;
      row.toggleClass("is-selected", isSelected);

      if (uploadBtn) {
        uploadBtn.toggleClass("is-active", isSelected && action === "upload");
        uploadBtn.setAttribute("aria-pressed", String(isSelected && action === "upload"));
      }
      if (downloadBtn) {
        downloadBtn.toggleClass("is-active", isSelected && action === "download");
        downloadBtn.setAttribute("aria-pressed", String(isSelected && action === "download"));
      }
    };

    checkbox.onchange = () => {
      if (checkbox.checked) {
        this.selectedPaths.add(item.path);
        if (!this.actions.has(item.path) || this.actions.get(item.path) === "skip") {
          const defAction = item.defaultAction !== "skip" ? item.defaultAction : (item.local ? "upload" : "download");
          this.actions.set(item.path, defAction);
        }
      } else {
        this.selectedPaths.delete(item.path);
      }
      updateView();
      this.updateTransferUI();
    };

    this.rowUpdaters.set(item.path, updateView);
    updateView();
  }

  private updateTransferUI(items?: PeerSyncPlanItem[]): void {
    const list = items ?? this.comparison?.plan.filter((i) => i.status !== "same") ?? [];
    const totalSelected = this.selectedPaths.size;

    let uploadCount = 0;
    let downloadCount = 0;

    for (const item of list) {
      if (!this.selectedPaths.has(item.path)) continue;
      const action = this.actions.get(item.path) ?? item.defaultAction;
      if (action === "upload") uploadCount += 1;
      else if (action === "download") downloadCount += 1;
    }

    if (this.selectionCountEl) {
      this.selectionCountEl.setText(`${totalSelected} of ${this.selectablePathCount} selected`);
    }

    if (this.selectAllInput) {
      this.selectAllInput.checked = this.selectablePathCount > 0 && totalSelected === this.selectablePathCount;
      this.selectAllInput.indeterminate = totalSelected > 0 && totalSelected < this.selectablePathCount;
    }

    if (this.transferSummaryEl) this.transferSummaryEl.setText(totalSelected
      ? `${uploadCount} sending · ${downloadCount} receiving` : "Choose files to sync");

    if (this.transferButton) {
      this.transferButton.disabled = totalSelected === 0;
      if (totalSelected === 0) {
        this.transferButton.setText("Select files to transfer");
      } else {
        this.transferButton.setText(`Transfer ${totalSelected} file${totalSelected === 1 ? "" : "s"}`);
      }
    }
  }

  private refreshRowViews(): void {
    for (const update of this.rowUpdaters.values()) {
      update();
    }
  }

  private async refreshComparison(options: { preserveResults?: boolean } = {}): Promise<void> {
    try {
      this.comparison = await this.service.compare();
      this.resetTransferSelection(this.comparison);
      if (!options.preserveResults) this.results = [];
      await this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not refresh the peer-sync preview.");
    }
  }

  private resetTransferSelection(comparison: PeerSyncComparison): void {
    this.actions = new Map(comparison.plan.map((item) => [item.path, item.defaultAction]));
    this.selectedPaths = new Set(comparison.plan
      .filter((item) => item.status !== "same" && item.defaultAction !== "skip")
      .map((item) => item.path));
  }



  private renderResults(container: HTMLElement): void {
    const { card } = createSubpageCard(container, "list-checks", "Transfer results");
    const list = card.createDiv({ cls: "temperans-peer-sync-results", attr: { "aria-live": "polite" } });
    for (const result of this.results) {
      const row = list.createDiv({ cls: result.ok ? "is-success" : "is-error" });
      setIcon(row.createSpan({ cls: "temperans-peer-sync-result-icon" }), result.ok ? "circle-check" : "circle-alert");
      const detail = row.createDiv();
      if (result.path) detail.createEl("strong", { text: result.path });
      detail.createDiv({ text: result.message });
    }
  }

  private createSelectableValue(container: HTMLElement, label: string, value: string, ariaLabel: string): void {
    const row = container.createDiv({ cls: "temperans-peer-sync-selectable-row" });
    row.createSpan({ text: label });
    const input = row.createEl("input", { cls: "temperans-peer-sync-selectable-value", attr: { type: "text", readonly: "true", "aria-label": ariaLabel, spellcheck: "false" } });
    input.value = value;
    const selectValue = () => input.select();
    input.addEventListener("focus", selectValue);
    input.addEventListener("click", selectValue);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
