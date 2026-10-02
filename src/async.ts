/** Queue by vault and logical resource, including work before the final write. */
const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
export function serialized<T>(owner: object, key: string, run: () => Promise<T>): Promise<T> {
  let entries = queues.get(owner);
  if (!entries) { entries = new Map(); queues.set(owner, entries); }
  const next = (entries.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
  entries.set(key, next);
  void next.finally(() => { if (entries.get(key) === next) entries.delete(key); }).catch(() => undefined);
  return next;
}

/** Every caller settles; a new batch waits for any running batch to finish. */
export class DebouncedTask {
  private timer: number | undefined;
  private waiters: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  private running: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private readonly run: () => Promise<void>, private readonly delay = 150) {}
  schedule(immediate = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    const promise = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (immediate) this.flush();
    else this.timer = window.setTimeout(() => this.flush(), this.delay);
    return promise;
  }
  private flush(): void {
    this.timer = undefined;
    const batch = this.waiters.splice(0);
    this.running = this.running.catch(() => undefined).then(async () => {
      if (!this.stopped) await this.run();
    });
    void this.running.then(() => batch.forEach(w => w.resolve()), error => batch.forEach(w => w.reject(error)));
  }
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.waiters.splice(0).forEach(w => w.resolve());
  }
}

/** Yield between bounded history batches so input and other plugins can run. */
export function yieldToHost(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

/** Shared concurrency bound, including requests from different views and years. */
export class AsyncPool {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await run(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}

function createAbortError(): Error {
  const error = new Error("Loading cancelled");
  error.name = "AbortError";
  return error;
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}
/** Detach one consumer without cancelling a read still needed by another consumer. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(createAbortError()); };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) cancel();
  });
}
export function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
