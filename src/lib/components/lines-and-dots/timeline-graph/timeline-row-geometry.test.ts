import { describe, expect, it } from 'vitest';

import {
  getTimelineDotAlignment,
  getTimelineDotRole,
  getTimelineRowGeometry,
  isTimelineLabelVisible,
} from './timeline-row-geometry';

describe('getTimelineDotAlignment', () => {
  it('anchors the initial marker by its left edge', () => {
    expect(
      getTimelineDotAlignment({ index: 0, eventCount: 3, pending: false }),
    ).toBe('start');
  });

  it('anchors only a true completion marker by its right edge', () => {
    expect(
      getTimelineDotAlignment({ index: 2, eventCount: 3, pending: false }),
    ).toBe('end');
    expect(
      getTimelineDotAlignment({ index: 2, eventCount: 3, pending: true }),
    ).toBe('center');
  });

  it('keeps intermediate markers centered', () => {
    expect(
      getTimelineDotAlignment({ index: 1, eventCount: 3, pending: false }),
    ).toBe('center');
  });

  it('centers a requested single marker on its timestamp', () => {
    expect(
      getTimelineDotAlignment({
        index: 0,
        eventCount: 1,
        pending: false,
        centerSingleMarker: true,
      }),
    ).toBe('center');
  });

  it('fans boundary markers outward when edge alignment would reverse them', () => {
    expect(
      getTimelineDotAlignment({
        index: 0,
        eventCount: 3,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
        fanOutShortBoundaryMarkers: true,
      }),
    ).toBe('end');
    expect(
      getTimelineDotAlignment({
        index: 2,
        eventCount: 3,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
        fanOutShortBoundaryMarkers: true,
      }),
    ).toBe('start');
    expect(
      getTimelineDotAlignment({
        index: 1,
        eventCount: 3,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
        fanOutShortBoundaryMarkers: true,
      }),
    ).toBe('center');
  });

  it('fans out a described completion beyond the history event count', () => {
    expect(
      getTimelineDotAlignment({
        index: 2,
        eventCount: 2,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
        boundaryEndIndex: 2,
        fanOutShortBoundaryMarkers: true,
      }),
    ).toBe('start');
  });

  it('keeps compact non-child boundaries centered', () => {
    expect(
      getTimelineDotAlignment({
        index: 0,
        eventCount: 2,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
      }),
    ).toBe('center');
    expect(
      getTimelineDotAlignment({
        index: 1,
        eventCount: 2,
        pending: false,
        boundarySpanPx: 6,
        markerSizePx: 20,
      }),
    ).toBe('center');
  });

  it('keeps boundary markers edge-aligned when they fit chronologically', () => {
    expect(
      getTimelineDotAlignment({
        index: 0,
        eventCount: 3,
        pending: false,
        boundarySpanPx: 20,
        markerSizePx: 20,
      }),
    ).toBe('start');
    expect(
      getTimelineDotAlignment({
        index: 2,
        eventCount: 3,
        pending: false,
        boundarySpanPx: 20,
        markerSizePx: 20,
      }),
    ).toBe('end');
  });
});

describe('getTimelineDotRole', () => {
  it('renders a described terminal child state as a completion point', () => {
    expect(
      getTimelineDotRole({
        index: 2,
        eventCount: 2,
        pointCount: 3,
        pending: true,
        livePending: false,
        hasPauseTime: false,
        active: false,
        resolvedTerminal: true,
      }),
    ).toBe('completion');
  });

  it('does not retain the stale pending marker after description resolves it', () => {
    expect(
      getTimelineDotRole({
        index: 1,
        eventCount: 2,
        pointCount: 3,
        pending: true,
        livePending: false,
        hasPauseTime: false,
        active: false,
        resolvedTerminal: true,
      }),
    ).toBeNull();
  });

  const role = (
    index: number,
    overrides: Partial<Parameters<typeof getTimelineDotRole>[0]> = {},
  ) =>
    getTimelineDotRole({
      index,
      eventCount: 3,
      pointCount: 3,
      pending: false,
      livePending: false,
      hasPauseTime: false,
      active: true,
      ...overrides,
    });

  it('keeps completed action boundary icons and suppresses interior icons', () => {
    expect(role(0)).toBe('start');
    expect(role(1)).toBeNull();
    expect(role(2)).toBe('completion');
  });

  it('shows one current-state icon for a live pending action', () => {
    expect(
      role(1, {
        eventCount: 2,
        pointCount: 2,
        pending: true,
        livePending: true,
      }),
    ).toBe('pending');
  });

  it('preserves explicit pause markers', () => {
    expect(
      role(3, {
        pointCount: 4,
        pending: true,
        livePending: true,
        hasPauseTime: true,
      }),
    ).toBe('pause');
  });
});

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

  it('caps a pending bar at its owning run boundary', () => {
    expect(
      getTimelineRowGeometry({
        points: [40],
        viewportStartPx: 20,
        viewportEndPx: 120,
        pendingEndPx: 90,
        isPending: true,
        hasPauseTime: false,
        haloPx: 6,
      }),
    ).toEqual({
      connectors: [{ startPx: 40, endPx: 90, index: 0, pending: true }],
      dots: [{ xPx: 40, index: 0 }],
      hitRange: { startPx: 34, endPx: 96 },
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

  it('keeps a label mounted while its connector is visible', () => {
    expect(isTimelineLabelVisible(-40, 20, 120, true)).toBe(true);
  });
});
