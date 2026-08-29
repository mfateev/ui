import { describe, expect, it } from 'vitest';

import {
  TIMELINE_ROW_HEIGHT_GRACE_MS,
  TimelineRowHeightRetention,
} from './timeline-row-height-retention';

import { DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS } from './timeline-scale.svelte';

const RETENTION_DURATION_MS =
  DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS + TIMELINE_ROW_HEIGHT_GRACE_MS;

describe('TimelineRowHeightRetention', () => {
  it('grows immediately and holds the peak for the retention duration', () => {
    const retention = new TimelineRowHeightRetention();

    expect(
      retention.update({
        visibleRowCount: 10,
        nowMs: 1_000,
        retain: true,
        retentionDurationMs: RETENTION_DURATION_MS,
      }),
    ).toBe(10);
    expect(
      retention.update({
        visibleRowCount: 8,
        nowMs: 61_999,
        retain: true,
        retentionDurationMs: RETENTION_DURATION_MS,
      }),
    ).toBe(10);
  });

  it('does not refresh the retention period when the peak is unchanged', () => {
    const retention = new TimelineRowHeightRetention();
    const update = (visibleRowCount: number, nowMs: number) =>
      retention.update({
        visibleRowCount,
        nowMs,
        retain: true,
        retentionDurationMs: RETENTION_DURATION_MS,
      });

    expect(update(10, 1_000)).toBe(10);
    expect(update(8, 60_000)).toBe(10);
    expect(update(10, 61_000)).toBe(10);
    expect(update(8, 61_999)).toBe(10);
    expect(update(8, 62_000)).toBe(8);
  });

  it('shrinks immediately when retention is disabled', () => {
    const retention = new TimelineRowHeightRetention();

    retention.update({
      visibleRowCount: 10,
      nowMs: 1_000,
      retain: true,
      retentionDurationMs: RETENTION_DURATION_MS,
    });
    expect(
      retention.update({
        visibleRowCount: 4,
        nowMs: 2_000,
        retain: false,
        retentionDurationMs: RETENTION_DURATION_MS,
      }),
    ).toBe(4);
  });

  it('clears retained height for a new lifecycle', () => {
    const retention = new TimelineRowHeightRetention();

    retention.update({
      visibleRowCount: 10,
      nowMs: 1_000,
      retain: true,
      retentionDurationMs: RETENTION_DURATION_MS,
    });
    retention.reset();

    expect(
      retention.update({
        visibleRowCount: 4,
        nowMs: 2_000,
        retain: true,
        retentionDurationMs: RETENTION_DURATION_MS,
      }),
    ).toBe(4);
  });

  it('starts a new retention lifecycle when its key changes', () => {
    const retention = new TimelineRowHeightRetention();
    const update = (visibleRowCount: number, retentionKey: string) =>
      retention.update({
        visibleRowCount,
        nowMs: 1_000,
        retain: true,
        retentionDurationMs: RETENTION_DURATION_MS,
        retentionKey,
      });

    expect(update(10, 'run-a:all')).toBe(10);
    expect(update(4, 'run-a:all')).toBe(10);
    expect(update(4, 'run-b:all')).toBe(4);
  });
});
