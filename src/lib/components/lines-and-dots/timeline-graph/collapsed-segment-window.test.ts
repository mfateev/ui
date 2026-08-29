import { describe, expect, it } from 'vitest';

import { getCollapsedSegmentWindow } from './collapsed-segment-window';

const windowSegment = (
  startWorldPx: number,
  endWorldPx: number,
  isCollapsed = true,
) =>
  getCollapsedSegmentWindow({
    startWorldPx,
    endWorldPx,
    isCollapsed,
    viewportOffsetPx: 100,
    viewportWidthPx: 200,
    hitHalfWidthPx: 12,
    zigzagHalfWidthPx: 5,
  });

describe('getCollapsedSegmentWindow', () => {
  it('preserves a fully visible collapsed marker and hit target', () => {
    expect(windowSegment(176, 224)).toEqual({
      hitRange: { startPx: 88, endPx: 112 },
      markerRange: { startPx: 88, endPx: 112 },
      zigzagRange: { startPx: 95, endPx: 105 },
      centerPx: 100,
      centerVisible: true,
    });
  });

  it('clips a collapsed marker entering the left edge', () => {
    expect(windowSegment(72, 120)).toEqual({
      hitRange: { startPx: 0, endPx: 8 },
      markerRange: { startPx: 0, endPx: 8 },
      zigzagRange: { startPx: 0, endPx: 1 },
      centerPx: -4,
      centerVisible: false,
    });
  });

  it('suppresses a fully offscreen collapsed segment', () => {
    expect(windowSegment(20, 68)).toEqual({
      hitRange: null,
      markerRange: null,
      zigzagRange: null,
      centerPx: -56,
      centerVisible: false,
    });
  });

  it('clips an expanded idle segment hit target to the viewport', () => {
    expect(windowSegment(50, 150, false).hitRange).toEqual({
      startPx: 0,
      endPx: 50,
    });
  });
});
