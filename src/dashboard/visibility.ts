/** Defer history work until a view or embed is actually visible. */
export class VisibilityGate {
  visible = true;
  private observer?: IntersectionObserver;
  private settle?: () => void;
  private stopped = false;
  constructor(private el: HTMLElement, private changed: (visible: boolean) => void) {}
  start(): Promise<void> {
    if (typeof IntersectionObserver === "undefined") return Promise.resolve();
    this.visible = false;
    return new Promise(resolve => {
      this.settle = resolve;
      this.observer = new IntersectionObserver(entries => {
        if (this.stopped) return;
        const visible = entries.some(entry => entry.isIntersecting);
        const first = !!this.settle, changed = visible !== this.visible;
        this.visible = visible;
        this.settle?.(); this.settle = undefined;
        if (!first && changed) this.changed(visible);
      });
      this.observer.observe(this.el);
    });
  }
  stop(): void { this.stopped = true; this.observer?.disconnect(); this.settle?.(); this.settle = undefined; }
}
