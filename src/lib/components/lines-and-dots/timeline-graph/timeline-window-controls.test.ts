import { describe, expect, it } from 'vitest';

import {
  clampTimelineWindowDuration,
  formatTimelineWindowDuration,
  getTimelineWindowModeAfterManualPosition,
  getTimelineWindowTimeRange,
  getTimelineWindowZoomDuration,
  timelineWindowIsAtEnd,
} from './timeline-window-controls';

describe('getTimelineWindowModeAfterManualPosition', () => {
  it.each([
    ['paused', 'paused'],
    ['playing', 'playing'],
    ['following', 'playing'],
  ] as const)('maps %s to %s', (mode, expected) => {
    expect(getTimelineWindowModeAfterManualPosition(mode)).toBe(expected);
  });
});

describe('getTimelineWindowZoomDuration', () => {
  it('steps inward and outward from the default one-minute window', () => {
    expect(getTimelineWindowZoomDuration(60_000, 'in')).toBe(30_000);
    expect(getTimelineWindowZoomDuration(60_000, 'out')).toBe(300_000);
  });

  it('clamps at the minimum and maximum zoom levels', () => {
    expect(getTimelineWindowZoomDuration(1_000, 'in')).toBe(1_000);
    expect(getTimelineWindowZoomDuration(86_400_000, 'out')).toBe(86_400_000);
  });
});

describe('clampTimelineWindowDuration', () => {
  it('allows continuous durations within the supported zoom range', () => {
    expect(clampTimelineWindowDuration(42_500)).toBe(42_500);
  });

  it('clamps durations at both zoom limits', () => {
    expect(clampTimelineWindowDuration(250)).toBe(1_000);
    expect(clampTimelineWindowDuration(172_800_000)).toBe(86_400_000);
  });
});

describe('formatTimelineWindowDuration', () => {
  it.each([
    [15_000, '15s'],
    [75_000, '1m 15s'],
    [300_000, '5m'],
    [5_430_000, '1h 30m'],
    [21_600_000, '6h'],
  ])('formats %i milliseconds as %s', (durationMs, expected) => {
    expect(formatTimelineWindowDuration(durationMs)).toBe(expected);
  });
});

describe('getTimelineWindowTimeRange', () => {
  it('recomputes a following window from resized viewport geometry', () => {
    expect(
      getTimelineWindowTimeRange({
        following: true,
        frozenAnchorTimeMs: null,
        durationMs: 60_000,
        followingEndTimeMs: 125_000,
      }),
    ).toEqual({ startTimeMs: 65_000, endTimeMs: 125_000 });
  });

  it('keeps the time anchor stable while paused or playing', () => {
    expect(
      getTimelineWindowTimeRange({
        following: false,
        frozenAnchorTimeMs: 25_000,
        durationMs: 5_000,
        followingEndTimeMs: 100_000,
      }),
    ).toEqual({ startTimeMs: 25_000, endTimeMs: 30_000 });
  });

  it('clamps a stale paused anchor when the available range contracts', () => {
    expect(
      getTimelineWindowTimeRange({
        following: false,
        frozenAnchorTimeMs: 75_000,
        durationMs: 30_000,
        availableStartTimeMs: 10_000,
        followingEndTimeMs: 100_000,
      }),
    ).toEqual({ startTimeMs: 70_000, endTimeMs: 100_000 });
  });

  it('clamps a paused anchor before the available range', () => {
    expect(
      getTimelineWindowTimeRange({
        following: false,
        frozenAnchorTimeMs: 5_000,
        durationMs: 30_000,
        availableStartTimeMs: 10_000,
        followingEndTimeMs: 100_000,
      }),
    ).toEqual({ startTimeMs: 10_000, endTimeMs: 40_000 });
  });
});

describe('timelineWindowIsAtEnd', () => {
  it('allows playback only while forward time remains', () => {
    expect(timelineWindowIsAtEnd(99_000, 100_000)).toBe(false);
    expect(timelineWindowIsAtEnd(100_000, 100_000)).toBe(true);
    expect(timelineWindowIsAtEnd(99_999.75, 100_000)).toBe(true);
  });
});
