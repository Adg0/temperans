export { default as moment } from "moment";
// Minimal Obsidian adapters backed by real browser DOM for layout and interaction tests.
HTMLElement.prototype.createEl = function (tag, options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.createDiv = function (options) { return this.createEl('div', options); };
HTMLElement.prototype.createSpan = function (options) { return this.createEl('span', options); };
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
HTMLElement.prototype.toggleClass = function (name, enabled) { this.classList.toggle(name, enabled); };
HTMLElement.prototype.setAttr = HTMLElement.prototype.setAttribute;
HTMLElement.prototype.setText = function (value) { this.textContent = value; };
export function setIcon(el, name) { el.setAttribute('data-icon', name); el.textContent = '◇'; }
export class Notice { constructor(message) { window.lastNotice = message; } }
export const Platform = { isMobile: false, isMobileApp: false, isDesktopApp: true };
export class TFile {}
export const normalizePath = value => value;
export const parseYaml = JSON.parse;
export const stringifyYaml = JSON.stringify;
export class MarkdownRenderChild { constructor(containerEl) { this.containerEl = containerEl; } }
export class PluginSettingTab {}
export class ItemView {
  constructor(leaf) {
    this.app = leaf.app;
    this.containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' });
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.body.createDiv({ cls: 'modal-container' });
    this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
    this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
  }
  open() { return this.onOpen?.(); }
  close() { this.containerEl.remove(); }
}
class Control {
  constructor(parent, tag = 'input') { this.inputEl = parent.createEl(tag); }
  setValue(value) { this.inputEl.value = value; this.inputEl.checked = value === true; return this; }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  setButtonText(value) { this.inputEl.textContent = value; return this; }
  setWarning() { this.inputEl.addClass('mod-warning'); return this; }
  setDisabled(value) { this.inputEl.disabled = value; return this; }
  setIcon(value) { setIcon(this.inputEl, value); return this; }
  setTooltip(value) { this.inputEl.setAttribute('aria-label', value); return this; }
  setCta() { this.inputEl.addClass('mod-cta'); return this; }
  onChange(callback) { this.inputEl.oninput = () => callback(this.inputEl.type === 'checkbox' ? this.inputEl.checked : this.inputEl.value); return this; }
  onClick(callback) { this.inputEl.onclick = callback; return this; }
}
export class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv({ cls: 'setting-item' });
    this.info = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.info.createDiv({ cls: 'setting-item-name' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }
  setName(value) { this.nameEl.textContent = value; return this; }
  setHeading() { this.settingEl.classList.add("setting-item-heading"); return this; }
  setDesc(value) { this.info.createDiv({ cls: 'setting-item-description', text: value }); return this; }
  addText(callback) { callback(new Control(this.controlEl)); return this; }
  addToggle(callback) { const c = new Control(this.controlEl); c.inputEl.type = 'checkbox'; callback(c); return this; }
  addExtraButton(callback) { return this.addButton(callback); }
  addButton(callback) { callback(new Control(this.controlEl, 'button')); return this; }
}
