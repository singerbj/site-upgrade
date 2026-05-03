// A small concurrency primitive. We want:
//   - A bounded-concurrency queue (for crawl + lighthouse).
//   - A strictly-serial queue for Mistral (rate limit = 1 in-flight).
// Both share the same shape so the orchestrator can treat them uniformly.

type Task<T> = () => Promise<T>;

export interface QueueStats {
  size: number;
  active: number;
  done: number;
  errors: number;
}

export class Queue {
  private concurrency: number;
  private active = 0;
  private waiting: Array<() => void> = [];
  private _done = 0;
  private _errors = 0;
  private _enqueued = 0;
  private listeners = new Set<(s: QueueStats) => void>();

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency | 0);
  }

  async run<T>(task: Task<T>): Promise<T> {
    this._enqueued++;
    this.emit();
    await this.acquire();
    try {
      const out = await task();
      this._done++;
      return out;
    } catch (e) {
      this._errors++;
      throw e;
    } finally {
      this.release();
      this.emit();
    }
  }

  // Fire and forget — used when the orchestrator wants to schedule work
  // but not wait inline for every item to finish.
  enqueue<T>(task: Task<T>, onError?: (err: unknown) => void): Promise<T> {
    return this.run(task).catch((e) => {
      if (onError) onError(e);
      throw e;
    });
  }

  stats(): QueueStats {
    return {
      size: this._enqueued - this._done - this._errors - this.active,
      active: this.active,
      done: this._done,
      errors: this._errors,
    };
  }

  onChange(fn: (s: QueueStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.stats();
    for (const fn of this.listeners) fn(s);
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release() {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
  }

  // Resolves once every currently-enqueued (and any newly enqueued)
  // task has settled. Call after all work is scheduled.
  async drain(): Promise<void> {
    while (this.active > 0 || this.waiting.length > 0) {
      await new Promise<void>((resolve) => {
        const off = this.onChange((s) => {
          if (s.active === 0 && s.size === 0) {
            off();
            resolve();
          }
        });
        // Re-check synchronously in case nothing pending.
        const s = this.stats();
        if (s.active === 0 && s.size === 0) {
          off();
          resolve();
        }
      });
    }
  }
}
