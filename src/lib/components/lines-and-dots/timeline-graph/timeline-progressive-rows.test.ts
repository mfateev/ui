import { describe, expect, it } from 'vitest';

import {
  INITIAL_TIMELINE_PAINT_ROWS,
  initialTimelinePaintRows,
  nextTimelinePaintRows,
  shouldBatchTimelineRows,
} from './timeline-progressive-rows';

describe('timeline progressive rows', () => {
  it('shows timelines that fit in the first paint immediately', () => {
    expect(initialTimelinePaintRows(100)).toBe(100);
  });

  it('starts large layouts with a bounded first paint', () => {
    expect(initialTimelinePaintRows(500_000)).toBe(INITIAL_TIMELINE_PAINT_ROWS);
  });

  it('doubles painted rows without exceeding the available layout', () => {
    expect(
      nextTimelinePaintRows({
        availableRows: 500_000,
        presentedRows: INITIAL_TIMELINE_PAINT_ROWS,
      }),
    ).toBe(INITIAL_TIMELINE_PAINT_ROWS * 2);
    expect(
      nextTimelinePaintRows({
        availableRows: 500_000,
        presentedRows: 400_000,
      }),
    ).toBe(500_000);
  });

  it('does not delay an ordinary live update after initial presentation', () => {
    expect(
      shouldBatchTimelineRows({
        availableRows: 501,
        presentedRows: 500,
      }),
    ).toBe(false);
    expect(
      shouldBatchTimelineRows({
        availableRows: 10_000,
        presentedRows: 500,
      }),
    ).toBe(true);
  });
});
