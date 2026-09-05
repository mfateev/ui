import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelineSceneDoubleBuffer } from './timeline-scene-double-buffer';

type Scene = { keys: string[]; value: string };

afterEach(() => {
  vi.useRealTimers();
});

const createBuffer = (shouldWait?: () => boolean) => {
  const commits: Scene[] = [];
  const buffer = new TimelineSceneDoubleBuffer<Scene>({
    delayMs: 1_100,
    keys: (scene) => scene.keys,
    onCommit: (scene) => commits.push(scene),
    shouldWait,
  });
  return { buffer, commits };
};

describe('TimelineSceneDoubleBuffer', () => {
  it('commits the initial scene immediately', () => {
    const { buffer, commits } = createBuffer();
    const scene = { keys: ['a'], value: 'initial' };

    buffer.publish(scene, true);

    expect(commits).toEqual([scene]);
  });

  it('keeps the committed scene while structural updates settle', () => {
    vi.useFakeTimers();
    const { buffer, commits } = createBuffer();
    const initial = { keys: ['a'], value: 'initial' };
    const first = { keys: ['b', 'a'], value: 'first' };
    const latest = { keys: ['c', 'b', 'a'], value: 'latest' };

    buffer.publish(initial, true);
    buffer.publish(first, true);
    vi.advanceTimersByTime(900);
    buffer.publish(latest, true);
    vi.advanceTimersByTime(1_099);

    expect(commits).toEqual([initial]);

    vi.advanceTimersByTime(1);

    expect(commits).toEqual([initial, latest]);
  });

  it('does not restart the swap timer for pending content updates', () => {
    vi.useFakeTimers();
    const { buffer, commits } = createBuffer();
    const initial = { keys: ['a'], value: 'initial' };
    const pending = { keys: ['b', 'a'], value: 'pending' };
    const refreshed = { keys: ['b', 'a'], value: 'refreshed' };

    buffer.publish(initial, true);
    buffer.publish(pending, true);
    vi.advanceTimersByTime(1_000);
    buffer.publish(refreshed, true);
    vi.advanceTimersByTime(100);

    expect(commits).toEqual([initial, refreshed]);
  });

  it('commits same-structure content updates immediately', () => {
    vi.useFakeTimers();
    const { buffer, commits } = createBuffer();
    const initial = { keys: ['a'], value: 'running' };
    const completed = { keys: ['a'], value: 'completed' };

    buffer.publish(initial, true);
    buffer.publish(completed, true);

    expect(commits).toEqual([initial, completed]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for outstanding scene work before swapping', () => {
    vi.useFakeTimers();
    let waiting = true;
    const { buffer, commits } = createBuffer(() => waiting);
    const initial = { keys: ['a'], value: 'initial' };
    const next = { keys: ['b', 'a'], value: 'next' };

    buffer.publish(initial, true);
    buffer.publish(next, true);
    vi.advanceTimersByTime(1_150);

    expect(commits).toEqual([initial]);

    waiting = false;
    vi.advanceTimersByTime(50);

    expect(commits).toEqual([initial, next]);
  });

  it('flushes a pending structural scene for direct manipulation', () => {
    vi.useFakeTimers();
    const { buffer, commits } = createBuffer();
    const initial = { keys: ['a'], value: 'initial' };
    const next = { keys: ['b', 'a'], value: 'next' };

    buffer.publish(initial, true);
    buffer.publish(next, true);
    buffer.flush();

    expect(commits).toEqual([initial, next]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
