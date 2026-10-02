export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface DropdownConfig<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange(value: T): void;
  ariaLabel: string;
  className?: string;
}

/**
 * A small, mobile-friendly plugin control. Native Windows select popups own
 * their blue selection colour, while this control keeps selection green.
 */
export function createTemperansDropdown<T extends string>(parent: HTMLElement, config: DropdownConfig<T>): HTMLElement {
  const doc = parent.ownerDocument;
  const win = doc.defaultView ?? window;
  let value = config.value;
  const selected = config.options.find((option) => option.value === value) ?? config.options[0];
  const wrapper = parent.createDiv({ cls: ["temperans-dropdown", config.className].filter(Boolean).join(" ") });
  const trigger = wrapper.createEl("button", {
    cls: "temperans-dropdown-trigger",
    attr: { type: "button", "aria-label": config.ariaLabel, "aria-haspopup": "listbox", "aria-expanded": "false" }
  });
  const label = trigger.createSpan({ text: selected?.label ?? "Select", cls: "temperans-dropdown-label" });
  trigger.createSpan({ text: "⌄", cls: "temperans-dropdown-chevron", attr: { "aria-hidden": "true" } });
  let menu: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let outsidePointerHandler: ((event: PointerEvent) => void) | null = null;
  let resizeHandler: (() => void) | null = null;

  const positionMenu = (): void => {
    if (!menu) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const spaceBelow = win.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const available = openAbove ? spaceAbove : spaceBelow;
    const width = Math.min(rect.width, win.innerWidth - viewportPadding * 2);
    menu.style.left = `${Math.max(viewportPadding, Math.min(rect.left, win.innerWidth - width - viewportPadding))}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(0, Math.min(288, available - 4))}px`;
    if (openAbove) {
      menu.style.removeProperty("top");
      menu.style.bottom = `${Math.max(viewportPadding, win.innerHeight - rect.top + 4)}px`;
    } else {
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      menu.style.removeProperty("bottom");
    }
  };

  const detachViewportHandlers = (): void => {
    if (outsidePointerHandler) doc.removeEventListener("pointerdown", outsidePointerHandler, true);
    if (resizeHandler) win.removeEventListener("resize", resizeHandler);
    outsidePointerHandler = null;
    resizeHandler = null;
  };

  const close = (): void => {
    observer?.disconnect();
    observer = null;
    menu?.remove();
    menu = null;
    detachViewportHandlers();
    trigger.setAttr("aria-expanded", "false");
    wrapper.removeClass("is-open");
  };

  const open = (): void => {
    const menuHost = trigger.closest<HTMLElement>(".modal-container") ?? doc.body;
    const nextMenu = menuHost.createDiv({
      cls: "temperans-dropdown-menu",
      attr: { role: "listbox", "aria-label": config.ariaLabel }
    });
    for (const option of config.options) {
      const item = nextMenu.createEl("button", {
        cls: `temperans-dropdown-option${option.value === value ? " is-selected" : ""}`,
        text: option.label,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(option.value === value)
        }
      });
      item.onclick = () => {
        value = option.value;
        label.textContent = option.label;
        close();
        trigger.focus();
        config.onChange(value);
      };
    }
    nextMenu.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(nextMenu.querySelectorAll<HTMLButtonElement>("[role=option]"));
        const index = items.indexOf(doc.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === "Tab") {
        close();
        trigger.focus();
      }
    };
    // Keep the wheel gesture in this scrollable list, never in the modal below it.
    nextMenu.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    menu = nextMenu;
    positionMenu();
    trigger.setAttr("aria-expanded", "true");
    wrapper.addClass("is-open");
    outsidePointerHandler = (event) => {
      const target = event.target;
      if (target && !wrapper.contains(target as Node) && !nextMenu.contains(target as Node)) close();
    };
    resizeHandler = positionMenu;
    doc.addEventListener("pointerdown", outsidePointerHandler, true);
    win.addEventListener("resize", resizeHandler);
    observer = new MutationObserver(() => { if (!trigger.isConnected) close(); });
    observer.observe(doc.body, { childList: true, subtree: true });
  };
  const toggle = (): void => menu ? close() : open();

  trigger.onclick = toggle;
  trigger.onkeydown = (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") toggle();
      else if (!menu) open();
      (menu?.querySelector<HTMLButtonElement>(".is-selected") ?? menu?.querySelector("button"))?.focus();
    }
  };
  return wrapper;
}
