import { createSubpageCard } from "../ui";
import { Notice, Platform, Setting } from "obsidian";
import { PeerSyncService } from "./service";
import { createPairingUri, generateQrSvg, parsePairingPayload } from "./qr";

export async function renderPeerSyncSettings(container: HTMLElement, service: PeerSyncService | undefined, onRefresh: () => void): Promise<void> {
  if (!service) {
    container.createEl("p", { text: "Peer sync service is unavailable." });
    return;
  }

  const subpageContainer = container.createDiv({ cls: "temperans-subpage-container" });

  // Desktop Host Card
  if (Platform.isDesktopApp) {
    const { card: hostCard, header: hostHeader } = createSubpageCard(subpageContainer, "server", "Desktop host server");

    const isHosting = service.isHosting;
    hostHeader.createSpan({
      cls: `temperans-badge ${isHosting ? "is-online" : "is-offline"}`,
      text: isHosting ? "● Host active" : "○ Host stopped"
    });

    if (isHosting) {
      const info = service.activeHostInfo!;
      const code = await service.getHostPairingCode();
      const primaryIp = info.addresses[0];
      const primaryAddress = primaryIp ? `http://${primaryIp}:${info.port}` : "";

      if (primaryAddress) {
        const uri = createPairingUri(primaryIp, info.port, code);
        const qrBlock = hostCard.createDiv({ cls: "temperans-peer-sync-qr-block" });
        const svgMarkup = generateQrSvg(uri, 180);
        try {
          const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
          const svgNode = parsed.querySelector("svg");
          if (svgNode) qrBlock.appendChild(qrBlock.ownerDocument.importNode(svgNode, true));
        } catch {
          // Fallback
        }
        qrBlock.createSpan({
          text: "Scan with mobile camera or Google Lens to connect automatically",
          cls: "temperans-scanner-status"
        });

        const addressBoxes = hostCard.createDiv({ cls: "temperans-peer-sync-selectable-values" });

        const row = addressBoxes.createDiv({ cls: "temperans-peer-sync-selectable-row" });
        row.createSpan({ text: "Desktop address" });
        const valInput = row.createEl("input", {
          cls: "temperans-peer-sync-selectable-value",
          attr: { type: "text", readonly: "true", spellcheck: "false" }
        });
        valInput.value = primaryAddress;

        const pRow = addressBoxes.createDiv({ cls: "temperans-peer-sync-selectable-row" });
        pRow.createSpan({ text: "Pairing code" });
        const codeInput = pRow.createEl("input", {
          cls: "temperans-peer-sync-selectable-value",
          attr: { type: "text", readonly: "true", spellcheck: "false" }
        });
        codeInput.value = code;
      }

      const hostActions = hostCard.createDiv({ cls: "temperans-card-actions-row" });
      const stopBtn = hostActions.createEl("button", { text: "Stop host", attr: { type: "button" } });
      stopBtn.onclick = async () => {
        await service.stopHost();
        onRefresh();
      };

      const regenBtn = hostActions.createEl("button", { text: "Regenerate code", cls: "mod-warning", attr: { type: "button" } });
      regenBtn.onclick = async () => {
        await service.regenerateHostPairingCode();
        new Notice("Pairing code regenerated.");
        onRefresh();
      };
    } else {
      let port = String(service.activeHostInfo?.port ?? service.configuredPort);
      new Setting(hostCard)
        .setName("Local host port")
        .setDesc("Port for incoming mobile requests (default 43887).")
        .addText((input) => {
          input.setValue(port).onChange((value) => { port = value; });
          input.inputEl.type = "number";
          input.inputEl.min = "1024";
          input.inputEl.max = "65535";
        })
        .addButton((button) => button.setButtonText("Start host").onClick(async () => {
          const parsedPort = Number(port);
          try {
            await service.setHostPort(parsedPort);
            await service.startHost();
            onRefresh();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Could not start peer-sync host.");
          }
        }));
    }
  }

  // Client / Paired Desktop Card
  const { card: clientCard } = createSubpageCard(subpageContainer, "smartphone", "Client connection");

  const profile = await service.getRemoteProfile();
  let currentInput = profile.url && profile.secret ? `${profile.url}#${profile.secret}` : (profile.url || "");

  const connectionSetting = new Setting(clientCard)
    .setName("Connection detail")
    .setDesc("Paste or enter pairing link (http://192.168.1.20:43887#CODE) or tap paste.");

  let textInputEl: HTMLInputElement | null = null;
  connectionSetting.addText((input) => {
    textInputEl = input.inputEl;
    input.setPlaceholder("http://192.168.1.20:43887#CODE or paste link");
    input.setValue(currentInput);
    input.onChange(async (value) => {
      currentInput = value.trim();
      const parsed = parsePairingPayload(currentInput);
      if (parsed) {
        await service.saveRemoteProfile(parsed.url, parsed.secret);
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
        await service.saveRemoteProfile(parsed.url, parsed.secret);
        new Notice("Configured desktop connection from clipboard!");
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not read clipboard.");
      }
    });
  });

  const clientActions = clientCard.createDiv({ cls: "temperans-card-actions-row" });
  const forgetBtn = clientActions.createEl("button", { text: "Forget paired device", cls: "mod-warning", attr: { type: "button" } });
  forgetBtn.onclick = async () => {
    await service.forgetRemoteProfile();
    currentInput = "";
    if (textInputEl) textInputEl.value = "";
    new Notice("Paired device forgotten.");
  };
}
