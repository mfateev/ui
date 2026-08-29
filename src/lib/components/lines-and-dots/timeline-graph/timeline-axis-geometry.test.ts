import { describe, expect, it } from 'vitest';

import {
  getTimelineAxisTicks,
  screenToTimelineWorld,
} from './timeline-axis-geometry';

describe('screenToTimelineWorld', () => {
  it('adds the viewport offset after removing the screen gutter', () => {
    expect(screenToTimelineWorld(80, 20, 300)).toBe(360);
  });
});

describe('getTimelineAxisTicks', () => {
  it('maps visible screen positions to the offset world interval', () => {
    expect(
      getTimelineAxisTicks({
        screenStartPx: 20,
        screenEndPx: 220,
        gutterPx: 20,
        viewportOffsetPx: 300,
        collapsedWorldRanges: [],
        targetTickPx: 50,
      }),
    ).toEqual([
      { screenPx: 70, worldPx: 350 },
      { screenPx: 120, worldPx: 400 },
      { screenPx: 170, worldPx: 450 },
    ]);
  });

  it('filters ticks whose world positions are inside collapsed segments', () => {
    expect(
      getTimelineAxisTicks({
        screenStartPx: 20,
        screenEndPx: 220,
        gutterPx: 20,
        viewportOffsetPx: 300,
        collapsedWorldRanges: [{ startPx: 390, endPx: 410 }],
        targetTickPx: 50,
      }),
    ).toEqual([
      { screenPx: 70, worldPx: 350 },
      { screenPx: 170, worldPx: 450 },
    ]);
  });

  it('keeps tick world identities stable as the viewport advances', () => {
    const initial = getTimelineAxisTicks({
      screenStartPx: 20,
      screenEndPx: 220,
      gutterPx: 20,
      viewportOffsetPx: 300,
      collapsedWorldRanges: [],
      targetTickPx: 50,
    });
    const advanced = getTimelineAxisTicks({
      screenStartPx: 20,
      screenEndPx: 220,
      gutterPx: 20,
      viewportOffsetPx: 310,
      collapsedWorldRanges: [],
      targetTickPx: 50,
    });

    expect(initial).toEqual([
      { screenPx: 70, worldPx: 350 },
      { screenPx: 120, worldPx: 400 },
      { screenPx: 170, worldPx: 450 },
    ]);
    expect(advanced).toEqual([
      { screenPx: 60, worldPx: 350 },
      { screenPx: 110, worldPx: 400 },
      { screenPx: 160, worldPx: 450 },
      { screenPx: 210, worldPx: 500 },
    ]);
  });

  it('keeps tick density bounded for very small and large viewports', () => {
    expect(
      getTimelineAxisTicks({
        screenStartPx: 0,
        screenEndPx: 10,
        gutterPx: 0,
        viewportOffsetPx: 0,
        collapsedWorldRanges: [],
      }),
    ).toHaveLength(1);
    expect(
      getTimelineAxisTicks({
        screenStartPx: 0,
        screenEndPx: 10_000,
        gutterPx: 0,
        viewportOffsetPx: 0,
        collapsedWorldRanges: [],
      }),
    ).toHaveLength(39);
  });
});
