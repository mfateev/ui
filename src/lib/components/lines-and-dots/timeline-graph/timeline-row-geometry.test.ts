import { describe, expect, it } from 'vitest';

import {
  getTimelineRowGeometry,
  isTimelineLabelVisible,
} from './timeline-row-geometry';

const geometry = (points: number[], isPending = false) =>
  getTimelineRowGeometry({
    points,
    viewportStartPx: 20,
    viewportEndPx: 120,
    isPending,
    hasPauseTime: false,
    haloPx: 6,
  });

describe('getTimelineRowGeometry', () => {
  it('suppresses geometry that is fully outside the viewport', () => {
    expect(geometry([-40, -10])).toEqual({
      connectors: [],
      dots: [],
      hitRange: null,
    });
  });

  it('keeps visible dots and connectors', () => {
    expect(geometry([40, 80])).toEqual({
      connectors: [{ startPx: 40, endPx: 80, index: 0, pending: false }],
      dots: [
        { xPx: 40, index: 0 },
        { xPx: 80, index: 1 },
      ],
      hitRange: { startPx: 34, endPx: 86 },
    });
  });

  it('clips a boundary-crossing bar while suppressing its offscreen dots', () => {
    expect(geometry([-10, 150])).toEqual({
      connectors: [{ startPx: 20, endPx: 120, index: 0, pending: false }],
      dots: [],
      hitRange: { startPx: 20, endPx: 120 },
    });
  });

  it('clips connectors entering and leaving the viewport', () => {
    const result = geometry([0, 50, 150]);
    expect(result.connectors).toEqual([
      { startPx: 20, endPx: 50, index: 0, pending: false },
      { startPx: 50, endPx: 120, index: 1, pending: false },
    ]);
    expect(result.dots).toEqual([{ xPx: 50, index: 1 }]);
  });

  it('keeps a pending bar clickable when its event dot is left of the window', () => {
    expect(geometry([-20], true)).toEqual({
      connectors: [{ startPx: 20, endPx: 120, index: 0, pending: true }],
      dots: [],
      hitRange: { startPx: 20, endPx: 120 },
    });
  });

  it('does not extend paused rows to the right edge', () => {
    expect(
      getTimelineRowGeometry({
        points: [-20],
        viewportStartPx: 20,
        viewportEndPx: 120,
        isPending: true,
        hasPauseTime: true,
        haloPx: 6,
      }),
    ).toEqual({ connectors: [], dots: [], hitRange: null });
  });
});

describe('isTimelineLabelVisible', () => {
  it('shows labels anchored within the viewport, including its edges', () => {
    expect(isTimelineLabelVisible(20, 20, 120)).toBe(true);
    expect(isTimelineLabelVisible(80, 20, 120)).toBe(true);
    expect(isTimelineLabelVisible(120, 20, 120)).toBe(true);
  });

  it('suppresses labels anchored outside the viewport', () => {
    expect(isTimelineLabelVisible(19, 20, 120)).toBe(false);
    expect(isTimelineLabelVisible(121, 20, 120)).toBe(false);
  });

  it('keeps a running label mounted while its pending bar is visible', () => {
    expect(isTimelineLabelVisible(-40, 20, 120, true)).toBe(true);
  });
});
