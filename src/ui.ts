import { setIcon } from "obsidian";

export interface ActionCard {
  icon: string;
  title: string;
  description: string;
  badgeText?: string;
  actionButton?: {
    label: string;
    icon?: string;
    onClick: () => Promise<void> | void;
  };
  onClick: () => Promise<void> | void;
}

export function renderActionCard(container: HTMLElement, card: ActionCard): { setBadge(text: string): void } {
  const tile = container.createDiv({
    cls: "temperans-action-tile",
    attr: { role: "button", tabindex: "0", "aria-label": `${card.title}: ${card.description}` }
  });
  setIcon(tile.createDiv({ cls: "temperans-action-icon-box" }), card.icon);
  const content = tile.createDiv({ cls: "temperans-action-content" });
  content.createDiv({ cls: "temperans-action-title", text: card.title });
  content.createDiv({ cls: "temperans-action-desc", text: card.description });

  if (card.actionButton) {
    const btn = tile.createEl("button", {
      cls: "temperans-action-tile-btn mod-cta",
      attr: {
        type: "button",
        "aria-label": card.actionButton.label
      }
    });
    if (card.actionButton.icon) {
      setIcon(btn, card.actionButton.icon);
    } else {
      btn.textContent = card.actionButton.label;
    }
    btn.onclick = async (event) => {
      event.stopPropagation();
      btn.disabled = true;
      try {
        await card.actionButton?.onClick();
      } finally {
        btn.disabled = false;
      }
    };
  }

  const badge = card.badgeText === undefined ? null
    : tile.createDiv({ cls: "temperans-setting-nav-hint", text: card.badgeText });
  setIcon(tile.createDiv({ cls: "temperans-action-arrow" }), "chevron-right");
  tile.onclick = () => void card.onClick();
  tile.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void card.onClick();
    }
  };
  return { setBadge: (text) => { if (badge) badge.textContent = text; } };
}

export function renderSubpageHeader(container: HTMLElement, title: string, subtitle: string | undefined, backLabel: string, onBack: () => void): void {
  const header = container.createDiv({ cls: "temperans-sub-settings-header" });
  const back = header.createEl("button", {
    cls: "temperans-sub-settings-back-btn",
    attr: { type: "button", "aria-label": backLabel }
  });
  setIcon(back, "arrow-left");
  back.onclick = onBack;
  header.createEl("h2", { text: title });
  if (subtitle) container.createEl("p", { cls: "temperans-sub-settings-desc", text: subtitle });
}

export function createSubpageCard(container: HTMLElement, icon: string, title: string): { card: HTMLElement; header: HTMLElement } {
  const card = container.createDiv({ cls: "temperans-subpage-card" });
  const header = card.createDiv({ cls: "temperans-subpage-card-header" });
  const group = header.createDiv({ cls: "temperans-subpage-card-title-group" });
  setIcon(group.createSpan({ cls: "temperans-subpage-card-icon" }), icon);
  group.createEl("h3", { cls: "temperans-subpage-card-title", text: title });
  return { card, header };
}
