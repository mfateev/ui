import { describe, expect, it } from 'vitest';

import {
  getTimelineSegmentedScrollModel,
  physicalYForLogicalRow,
  rebaseTimelineScroll,
  revealTimelineLogicalRow,
  TIMELINE_NORMAL_SCROLL_LIMIT_PX,
  TIMELINE_SEGMENTED_SCROLL_HEIGHT_PX,
} from './timeline-segmented-scroll';

describe('timeline segmented scrolling', () => {
  it('keeps ordinary histories in page flow', () => {
    const model = getTimelineSegmentedScrollModel({
      totalRows: 100,
      rowHeightPx: 44,
    });
    expect(model.segmented).toBe(false);
    expect(model.physicalHeightPx).toBe(4_400);
  });

  it('caps the physical element for million-row histories', () => {
    const model = getTimelineSegmentedScrollModel({
      totalRows: 1_000_000,
      rowHeightPx: 44,
    });
    expect(model.segmented).toBe(true);
    expect(model.physicalHeightPx).toBe(TIMELINE_SEGMENTED_SCROLL_HEIGHT_PX);
    expect(model.physicalHeightPx).toBeGreaterThan(
      TIMELINE_NORMAL_SCROLL_LIMIT_PX,
    );
  });

  it('can keep a progressively growing large layout in its scroll container', () => {
    const model = getTimelineSegmentedScrollModel({
      totalRows: 128,
      rowHeightPx: 44,
      forceSegmented: true,
    });
    expect(model.segmented).toBe(true);
    expect(model.physicalHeightPx).toBe(128 * 44);
  });

  it('rebases without moving the viewport anchor', () => {
    const model = getTimelineSegmentedScrollModel({
      totalRows: 1_000_000,
      rowHeightPx: 44,
    });
    const before = { originRow: 0, scrollTop: 6_500_000 };
    const anchor = before.originRow + (before.scrollTop + 400) / 44;
    const next = rebaseTimelineScroll({
      model,
      ...before,
      viewportHeightPx: 800,
    });
    const beforeY = physicalYForLogicalRow(model, before.originRow, anchor);
    const afterY = physicalYForLogicalRow(model, next.originRow, anchor);
    expect(afterY - next.scrollTop).toBeCloseTo(beforeY - before.scrollTop, 8);
    expect(next.originRow).toBeGreaterThan(0);
  });

  it('reveals the first and last logical rows', () => {
    const model = getTimelineSegmentedScrollModel({
      totalRows: 1_000_000,
      rowHeightPx: 44,
    });
    const last = revealTimelineLogicalRow({
      model,
      originRow: 0,
      logicalRow: 999_999,
      viewportHeightPx: 800,
    });
    expect(last.originRow).toBeGreaterThan(0);
    expect(last.scrollTop).toBeGreaterThan(0);
    const first = revealTimelineLogicalRow({
      model,
      originRow: last.originRow,
      logicalRow: 0,
      viewportHeightPx: 800,
    });
    expect(first).toEqual({ originRow: 0, scrollTop: 0 });
  });
});
