import type { EventGroup } from '$lib/models/event-groups/event-groups';
import { validTimeToDate } from '$lib/utilities/format-time';
import { isNullish } from '$lib/utilities/type-predicates';

import type { PixelRange } from './viewport-geometry';
import { intersectPixelRanges } from './viewport-geometry';

export function getTimelineGroupWorldRange({
  group,
  currentTimeMs,
  project,
}: {
  group: EventGroup;
  currentTimeMs: number;
  project: (timeMs: number) => number;
}): PixelRange | null {
  const startTime = group.initialEvent.eventTime;
  const lastTime = group.lastEvent.eventTime;

  if (isNullish(startTime)) return null;

  const startTimeMs = validTimeToDate(startTime).getTime();
  const lastTimeMs = isNullish(lastTime)
    ? startTimeMs
    : validTimeToDate(lastTime).getTime();
  const endTimeMs = group.isPending
    ? Math.max(currentTimeMs, lastTimeMs)
    : lastTimeMs;

  return {
    startPx: project(startTimeMs),
    endPx: project(endTimeMs),
  };
}

export function timelineGroupIntersectsViewport({
  group,
  currentTimeMs,
  project,
  visibleRange,
}: {
  group: EventGroup;
  currentTimeMs: number;
  project: (timeMs: number) => number;
  visibleRange: PixelRange;
}): boolean {
  const groupRange = getTimelineGroupWorldRange({
    group,
    currentTimeMs,
    project,
  });

  return groupRange
    ? intersectPixelRanges(groupRange, visibleRange) !== null
    : false;
}
