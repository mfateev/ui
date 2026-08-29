import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMELINE_DISPLAY_MODE,
  expandedDurationPerViewportMs,
} from './timeline-display-mode';

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
