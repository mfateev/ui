import type { EventGroup } from '$lib/models/event-groups/event-groups';
import { validTimeToDate } from '$lib/utilities/format-time';
import { isNullish } from '$lib/utilities/type-predicates';

import type { PixelRange } from './viewport-geometry';
import { intersectPixelRanges } from './viewport-geometry';

export function getTimelineGroupWorldRange({
  group,
  currentTimeMs,
  retainedEndTimeMs,
  project,
}: {
  group: EventGroup;
  currentTimeMs: number;
  retainedEndTimeMs?: number;
  project: (timeMs: number) => number;
}): PixelRange | null {
  const startTime = group.initialEvent.eventTime;
  const lastTime = group.lastEvent.eventTime;

  if (isNullish(startTime)) return null;

  const startTimeMs = validTimeToDate(startTime).getTime();
  const lastTimeMs = isNullish(lastTime)
    ? startTimeMs
    : validTimeToDate(lastTime).getTime();
  // A group can still look pending in the immutable snapshot retained for a
  // predecessor run. It stopped being live when that run continued-as-new,
  // so cap it at that run's boundary instead of extending it to the current
  // clock forever.
  const endTimeMs = group.isPending
    ? Math.max(retainedEndTimeMs ?? currentTimeMs, lastTimeMs)
    : lastTimeMs;

  return {
    startPx: project(startTimeMs),
    endPx: project(endTimeMs),
  };
}

export function timelineGroupIntersectsViewport({
  group,
  currentTimeMs,
  retainedEndTimeMs,
  project,
  visibleRange,
  visibleTimeRange,
}: {
  group: EventGroup;
  currentTimeMs: number;
  retainedEndTimeMs?: number;
  project: (timeMs: number) => number;
  visibleRange: PixelRange;
  visibleTimeRange?: { startTimeMs: number; endTimeMs: number };
}): boolean {
  if (visibleTimeRange) {
    const startTime = group.initialEvent.eventTime;
    const lastTime = group.lastEvent.eventTime;
    if (isNullish(startTime)) return false;
    const groupStartTimeMs = validTimeToDate(startTime).getTime();
    const lastTimeMs = isNullish(lastTime)
      ? groupStartTimeMs
      : validTimeToDate(lastTime).getTime();
    const groupEndTimeMs = group.isPending
      ? Math.max(retainedEndTimeMs ?? currentTimeMs, lastTimeMs)
      : lastTimeMs;
    if (
      groupEndTimeMs < visibleTimeRange.startTimeMs ||
      groupStartTimeMs > visibleTimeRange.endTimeMs
    ) {
      return false;
    }
  }

  const groupRange = getTimelineGroupWorldRange({
    group,
    currentTimeMs,
    retainedEndTimeMs,
    project,
  });

  return groupRange
    ? intersectPixelRanges(groupRange, visibleRange) !== null
    : false;
}
