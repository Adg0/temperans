if (typeof window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

export { default as moment } from "moment";
// A small semantic UI harness: exercises settings and callbacks without launching Obsidian.
export class Element {
  children: Element[] = [];
  style = { display: "", setProperty() {} };
  attrs: Record<string, string> = {};
  private _textContent = "";
  get textContent(): string {
    return this.children.length > 0 ? this.children.map(c => c.textContent).join("") : this._textContent;
  }
  set textContent(value: string) {
    this._textContent = value;
  }
  cls = "";
  value = "";
  disabled = false;
  onclick?: () => unknown;
  onkeydown?: (event: { key: string; preventDefault(): void }) => unknown;
  setting?: Setting;
  dropdown?: { onChange(value: string): void };
  constructor(public tag = "div") {}
  createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element(tag);
    child.textContent = options.text ?? "";
    child.cls = options.cls ?? "";
    child.attrs = options.attr ?? {};
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  empty() { this.children = []; }
  addClass(...classes: string[]) { this.cls += ` ${classes.join(" ")}`; }
  removeClass(cls: string) { this.cls = this.cls.split(" ").filter(c => c !== cls).join(" "); }
  toggleClass(cls: string, enabled: boolean) { if (enabled) this.addClass(cls); else this.removeClass(cls); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener() {}
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  find(predicate: (node: Element) => boolean): Element {
    const node = this.all().find(predicate);
    if (!node) throw new Error("UI element was not rendered");
    return node;
  }
  button(text: string) { return this.find(node => node.tag === "button" && node.textContent === text); }
  field(name: string) { return this.find(node => node.setting?.name === name).setting!; }
  element(): HTMLElement { return this as unknown as HTMLElement; }
}

class Control {
  inputEl = new Element("input");
  value: unknown;
  change: (value: any) => unknown = () => {};
  click: () => unknown = () => {};
  setValue(value: unknown) { this.value = value; return this; }
  setPlaceholder() { return this; }
  setButtonText() { return this; }
  setWarning() { return this; }
  setDestructive() { return this; }
  setClass() { return this; }
  setCta() { return this; }
  setDisabled() { return this; }
  setIcon() { return this; }
  setTooltip() { return this; }
  onChange(callback: Control["change"]) { this.change = callback; return this; }
  onClick(callback: Control["click"]) { this.click = callback; return this; }
}

export class Setting {
  name = "";
  controlEl: Element;
  settingEl: Element;
  controls: Control[] = [];
  constructor(parent: Element) {
    this.settingEl = parent.createDiv();
    this.settingEl.setting = this;
    this.controlEl = this.settingEl.createDiv();
  }
  setName(name: string) { this.name = name; return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(callback: (control: Control) => unknown) {
    const control = new Control();
    this.controls.push(control);
    callback(control);
    return this;
  }
  addToggle = this.addText;
  addButton = this.addText;
  addExtraButton = this.addText;
  addComponent = this.addText;
}

export class SecretComponent {
  constructor(public app: unknown, public component: unknown) {}
  setValue() { return this; }
  onChange() { return this; }
}

export class Modal {
  contentEl = new Element();
  modalEl = new Element();
  constructor(public app: unknown) {}
  close() {}
}
export class PluginSettingTab {
  containerEl = new Element();
  constructor(public app: unknown) {}
}
export const Platform = { isDesktopApp: true, isMobileApp: false };
export const notices: string[] = [];
export class Notice { constructor(message: string) { notices.push(message); } }
export function setIcon() {}
export class TFile {
  constructor(public path: string) {}
  get name() { return this.path.split("/").pop()!; }
  get basename() { return this.name.replace(/\.[^.]+$/, ""); }
  get extension() { return this.name.split(".").pop()!; }
}
export class TFolder { children: Array<TFile | TFolder> = []; constructor(public path = "") {} }
export const normalizePath = (path: string) => path;
// JSON is valid YAML and sufficient for the persistence fixtures in this harness.
export const parseYaml = JSON.parse;
export const stringifyYaml = (value: unknown) => JSON.stringify(value) + "\n";
export class ItemView extends Modal {
  containerEl = this.contentEl;
  constructor(leaf: { app: unknown }) { super(leaf.app); }
}
