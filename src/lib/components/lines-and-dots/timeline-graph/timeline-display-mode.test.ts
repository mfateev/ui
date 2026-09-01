import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMELINE_DISPLAY_MODE,
  expandedDurationPerViewportMs,
  fixedWindowScaleDurationMs,
} from './timeline-display-mode';
import { Timespan } from './timespan';
import type { TimeSegment } from './types';

describe('TimelineGraph display mode default', () => {
  it('keeps omitted display modes isolated to full-duration behavior', () => {
    expect(DEFAULT_TIMELINE_DISPLAY_MODE).toBe('full-duration');
  });
});

describe('expandedDurationPerViewportMs', () => {
  it('uses a one-minute window in fixed-window mode', () => {
    expect(
      expandedDurationPerViewportMs({
        displayMode: 'fixed-window',
        viewportWidthPx: 1_000,
        expandedDurationMs: 300_000,
        collapsedSegmentCount: 2,
      }),
    ).toBe(60_000);
  });

  it('fits expanded time to the viewport in full-duration mode', () => {
    expect(
      expandedDurationPerViewportMs({
        displayMode: 'full-duration',
        viewportWidthPx: 1_000,
        expandedDurationMs: 300_000,
        collapsedSegmentCount: 0,
      }),
    ).toBe(300_000);
  });

  it('reserves fixed space for collapsed gaps in full-duration mode', () => {
    expect(
      expandedDurationPerViewportMs({
        displayMode: 'full-duration',
        viewportWidthPx: 1_000,
        expandedDurationMs: 300_000,
        collapsedSegmentCount: 2,
      }),
    ).toBeCloseTo(331_858.407);
  });

  it('suppresses expanded widths when collapsed gaps fill the viewport', () => {
    expect(
      expandedDurationPerViewportMs({
        displayMode: 'full-duration',
        viewportWidthPx: 40,
        expandedDurationMs: 300_000,
        collapsedSegmentCount: 1,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fixedWindowScaleDurationMs', () => {
  const segment = (
    startTimeMs: number,
    endTimeMs: number,
    kind: TimeSegment['kind'] = 'active',
  ): TimeSegment => ({ kind, timespan: new Timespan(startTimeMs, endTimeMs) });

  it('keeps the requested wall-clock duration when there are no collapsed gaps', () => {
    expect(
      fixedWindowScaleDurationMs({
        viewportWidthPx: 1_000,
        windowStartTimeMs: 0,
        windowDurationMs: 60_000,
        segments: [segment(0, 60_000)],
        isCollapsed: () => false,
      }),
    ).toBe(60_000);
  });

  it('leaves proportional empty space when the window starts before the workflow', () => {
    expect(
      fixedWindowScaleDurationMs({
        viewportWidthPx: 1_000,
        windowStartTimeMs: 0,
        windowDurationMs: 60_000,
        segments: [segment(45_000, 60_000)],
        isCollapsed: () => false,
      }),
    ).toBe(60_000);
  });

  it('reserves collapsed gap space inside the requested window', () => {
    const idle = segment(20_000, 40_000, 'inactive');
    expect(
      fixedWindowScaleDurationMs({
        viewportWidthPx: 1_000,
        windowStartTimeMs: 0,
        windowDurationMs: 60_000,
        segments: [segment(0, 20_000), idle, segment(40_000, 60_000)],
        isCollapsed: (candidate) => candidate === idle,
      }),
    ).toBeCloseTo(42_016.8067);
  });

  it('only reserves the visible fraction of a boundary gap', () => {
    const idle = segment(0, 40_000, 'inactive');
    expect(
      fixedWindowScaleDurationMs({
        viewportWidthPx: 1_000,
        windowStartTimeMs: 20_000,
        windowDurationMs: 40_000,
        segments: [idle, segment(40_000, 60_000)],
        isCollapsed: (candidate) => candidate === idle,
      }),
    ).toBeCloseTo(20_491.8033);
  });
});
