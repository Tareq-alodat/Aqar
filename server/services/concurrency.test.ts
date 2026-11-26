import { describe, expect, it } from "vitest";
import { Semaphore } from "./concurrency";

describe("Semaphore", () => {
  it("never runs more than the limit at once and runs everything", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        sem.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done).toHaveLength(8);
    expect(sem.stats).toEqual({ active: 0, waiting: 0 });
  });

  it("frees the slot when a task throws", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(sem.run(async () => "ok")).resolves.toBe("ok");
    expect(sem.stats).toEqual({ active: 0, waiting: 0 });
  });

  it("rejects a bad limit", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
