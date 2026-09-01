import { describe, expect, it } from 'vitest';

import { AbortableSemaphore, runWithConcurrency } from './timeline-scheduler';

describe('AbortableSemaphore', () => {
  it('never exceeds its limit', async () => {
    const semaphore = new AbortableSemaphore(3);
    let active = 0;
    let peak = 0;
    const work = Array.from({ length: 30 }, () =>
      semaphore.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      }),
    );
    await Promise.all(work);
    expect(peak).toBe(3);
  });

  it('removes aborted work from the queue', async () => {
    const semaphore = new AbortableSemaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const queued = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(semaphore.queuedCount).toBe(0);
    release();
  });
});

describe('runWithConcurrency', () => {
  it('does not start queued jobs after abort', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await runWithConcurrency({
      values: [0, 1, 2, 3],
      concurrency: 1,
      signal: controller.signal,
      run: async (value) => {
        started.push(value);
        controller.abort();
      },
    });
    expect(started).toEqual([0]);
  });
});
