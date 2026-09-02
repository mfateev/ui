import { describe, expect, it } from 'vitest';

import {
  TimelinePresentationController,
  TimelineSceneBlockCache,
} from './timeline-presentation-chunks';

describe('TimelinePresentationController', () => {
  it('does not publish while scrolling inside the active chunk range', () => {
    const controller = new TimelinePresentationController(100, 2);
    const scene = {};
    const first = controller.update({
      sceneIdentity: scene,
      totalRows: 1_000,
      windowStart: 10,
      windowEnd: 90,
    });
    const second = controller.update({
      sceneIdentity: scene,
      totalRows: 1_000,
      windowStart: 20,
      windowEnd: 80,
    });
    expect(second).toBe(first);
    expect(controller.counters.updates).toBe(1);
  });

  it('parks and reuses chunks by scene-block identity', () => {
    const controller = new TimelinePresentationController(100, 2);
    const scene = {};
    const first = controller.update({
      sceneIdentity: scene,
      totalRows: 1_000,
      windowStart: 0,
      windowEnd: 100,
    })[0];
    controller.update({
      sceneIdentity: scene,
      totalRows: 1_000,
      windowStart: 100,
      windowEnd: 200,
    });
    const returned = controller
      .update({
        sceneIdentity: scene,
        totalRows: 1_000,
        windowStart: 0,
        windowEnd: 100,
      })
      .find(({ index }) => index === 0);
    expect(returned?.key).toBe(first.key);
    expect(controller.counters.lruHits).toBe(1);
  });

  it('extends an active partial chunk when progressive compilation grows', () => {
    const controller = new TimelinePresentationController(100, 1);
    const scene = {};
    const first = controller.update({
      sceneIdentity: scene,
      totalRows: 25,
      windowStart: 0,
      windowEnd: 25,
    });
    const grown = controller.update({
      sceneIdentity: scene,
      totalRows: 75,
      windowStart: 0,
      windowEnd: 25,
    });

    expect(first[0].rowEnd).toBe(25);
    expect(grown[0].rowEnd).toBe(75);
    expect(grown).not.toBe(first);
  });

  it('keeps parked DOM bounded and resets identities for a new scene', () => {
    const controller = new TimelinePresentationController(100, 1);
    const firstScene = {};
    for (let index = 0; index < 4; index += 1) {
      controller.update({
        sceneIdentity: firstScene,
        totalRows: 1_000,
        windowStart: index * 100,
        windowEnd: (index + 1) * 100,
      });
    }
    const chunks = controller.update({
      sceneIdentity: firstScene,
      totalRows: 1_000,
      windowStart: 300,
      windowEnd: 400,
    });
    expect(chunks).toHaveLength(2);
    const next = controller.update({
      sceneIdentity: {},
      totalRows: 1_000,
      windowStart: 300,
      windowEnd: 400,
    });
    expect(next[0].key).not.toBe(chunks.find(({ active }) => active)?.key);
  });

  it('compiles a scene block once and preserves its row identities', () => {
    const controller = new TimelinePresentationController(2, 1);
    const cache = new TimelineSceneBlockCache<{ key: string }>();
    const scene = {};
    const chunk = controller.update({
      sceneIdentity: scene,
      totalRows: 4,
      windowStart: 0,
      windowEnd: 2,
    })[0];
    const compile = (start: number, end: number) =>
      Array.from({ length: end - start }, (_, offset) => ({
        key: String(start + offset),
      }));

    const first = cache.get(scene, chunk, compile);
    const second = cache.get(scene, chunk, compile);

    expect(second).toBe(first);
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(cache.counters).toEqual({ compilations: 1, reuses: 1 });
  });

  it('recompiles a published block when its immutable row revision changes', () => {
    const controller = new TimelinePresentationController(2, 1);
    const cache = new TimelineSceneBlockCache<{ key: string }>();
    const scene = {};
    const chunk = controller.update({
      sceneIdentity: scene,
      totalRows: 2,
      windowStart: 0,
      windowEnd: 2,
    })[0];

    const first = cache.get(scene, chunk, () => [{ key: 'old' }], 'old');
    const second = cache.get(scene, chunk, () => [{ key: 'new' }], 'new');

    expect(second).not.toBe(first);
    expect(second.rows).toEqual([{ key: 'new' }]);
    expect(cache.counters).toEqual({ compilations: 2, reuses: 0 });
  });
});
