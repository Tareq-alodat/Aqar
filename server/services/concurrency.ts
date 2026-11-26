/** Runs at most `limit` tasks at a time; the rest wait in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be a positive integer");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      // Hand the slot straight to the next waiter; otherwise free it.
      if (next) next();
      else this.active--;
    }
  }

  /** Tasks running now / waiting (for tests and diagnostics). */
  get stats() {
    return { active: this.active, waiting: this.waiting.length };
  }
}
