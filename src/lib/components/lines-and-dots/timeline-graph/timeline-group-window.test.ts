import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { EventTypeCategory } from '$lib/types/events';

import {
  getTimelineGroupWorldRange,
  timelineGroupIntersectsViewport,
} from './timeline-group-window';

const T0 = Date.UTC(2022, 0, 1);
const time = (offsetMs: number): string =>
  new Date(T0 + offsetMs).toISOString();

function group({
  startMs,
  endMs,
  isPending = false,
  category = 'activity',
}: {
  startMs: number;
  endMs: number;
  isPending?: boolean;
  category?: EventTypeCategory;
}): EventGroup {
  const initialEvent = { eventTime: time(startMs) };
  const lastEvent = { eventTime: time(endMs) };

  return {
    initialEvent,
    lastEvent,
    eventList: [initialEvent, lastEvent],
    isPending,
    category,
  } as unknown as EventGroup;
}

const project = (timeMs: number): number => timeMs - T0;
const visibleRange = { startPx: 100, endPx: 200 };

describe('timelineGroupIntersectsViewport', () => {
  it('filters groups fully before and after the visible range', () => {
    expect(
      timelineGroupIntersectsViewport({
        group: group({ startMs: 10, endMs: 90 }),
        currentTimeMs: T0 + 250,
        project,
        visibleRange,
      }),
    ).toBe(false);
    expect(
      timelineGroupIntersectsViewport({
        group: group({ startMs: 210, endMs: 230 }),
        currentTimeMs: T0 + 250,
        project,
        visibleRange,
      }),
    ).toBe(false);
  });

  it('retains groups crossing either viewport boundary', () => {
    expect(
      timelineGroupIntersectsViewport({
        group: group({ startMs: 50, endMs: 150 }),
        currentTimeMs: T0 + 250,
        project,
        visibleRange,
      }),
    ).toBe(true);
    expect(
      timelineGroupIntersectsViewport({
        group: group({ startMs: 150, endMs: 250 }),
        currentTimeMs: T0 + 250,
        project,
        visibleRange,
      }),
    ).toBe(true);
  });

  it('retains groups spanning the entire viewport', () => {
    expect(
      timelineGroupIntersectsViewport({
        group: group({ startMs: 50, endMs: 250 }),
        currentTimeMs: T0 + 250,
        project,
        visibleRange,
      }),
    ).toBe(true);
  });

  it.each([
    'activity',
    'nexus',
    'timer',
    'child-workflow',
  ] as EventTypeCategory[])(
    'extends a pending %s group to the current clock',
    (category) => {
      const pendingGroup = group({
        startMs: 50,
        endMs: 75,
        isPending: true,
        category,
      });

      expect(
        timelineGroupIntersectsViewport({
          group: pendingGroup,
          currentTimeMs: T0 + 150,
          project,
          visibleRange,
        }),
      ).toBe(true);
      expect(pendingGroup.pendingActivity).toBeUndefined();
    },
  );
});

describe('getTimelineGroupWorldRange', () => {
  it('uses the later of the pending clock and last event', () => {
    expect(
      getTimelineGroupWorldRange({
        group: group({ startMs: 50, endMs: 175, isPending: true }),
        currentTimeMs: T0 + 150,
        project,
      }),
    ).toEqual({ startPx: 50, endPx: 175 });
  });
});
