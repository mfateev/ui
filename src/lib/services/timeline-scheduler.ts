export class TimelineSchedulerAbortedError extends DOMException {
  constructor() {
    super('Aborted', 'AbortError');
  }
}

export class AbortableSemaphore {
  private active = 0;
  private readonly queued: {
    signal?: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (reason: unknown) => void;
    onAbort: () => void;
  }[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('A semaphore limit must be a positive integer.');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queued.length;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new TimelineSchedulerAbortedError();
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaseOnce();
    }

    return new Promise<() => void>((resolve, reject) => {
      const item = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.queued.indexOf(item);
          if (index >= 0) this.queued.splice(index, 1);
          reject(new TimelineSchedulerAbortedError());
        },
      };
      signal?.addEventListener('abort', item.onAbort, { once: true });
      this.queued.push(item);
    });
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new TimelineSchedulerAbortedError();
      return await work();
    } finally {
      release();
    }
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.queued.length > 0) {
      const item = this.queued.shift();
      if (!item) return;
      item.signal?.removeEventListener('abort', item.onAbort);
      if (item.signal?.aborted) {
        item.reject(new TimelineSchedulerAbortedError());
        continue;
      }
      this.active += 1;
      item.resolve(this.releaseOnce());
    }
  }
}

export const runWithConcurrency = async <T, R>({
  values,
  concurrency,
  signal,
  run,
}: {
  values: readonly T[];
  concurrency: number;
  signal?: AbortSignal;
  run: (value: T, index: number) => Promise<R>;
}): Promise<PromiseSettledResult<R>[]> => {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < values.length && !signal?.aborted) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await run(values[index], index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};
