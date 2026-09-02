import type { WorkflowEvent } from '$lib/types/events';
import { maxDate, validTimeToDate } from '$lib/utilities/format-time';
import { isNullish } from '$lib/utilities/type-predicates';

import { Timespan } from './timespan';
import type { TimeSegment } from './types';

export type TimelineActiveTimeRange = {
  startTimeMs: number;
  endTimeMs: number;
};

/** Satisfied by both EventGroup and LazyGroup, so neither needs building. */
type GroupForSegments = {
  initialEvent: WorkflowEvent;
  lastEvent: WorkflowEvent;
  isPending: boolean;
};

function getGroupStartMs(group: GroupForSegments): number | null {
  const { eventTime } = group.initialEvent;

  if (isNullish(eventTime)) {
    return null;
  }

  return validTimeToDate(eventTime).getTime();
}

function getGroupEndMs(
  group: GroupForSegments,
  pendingTimestampMs: number,
): number {
  const { eventTime } = group.lastEvent;

  if (isNullish(eventTime)) {
    return pendingTimestampMs;
  }

  if (group.isPending) {
    return maxDate(pendingTimestampMs, eventTime).getTime();
  }

  return validTimeToDate(eventTime).getTime();
}

export function buildTimeSegments<T extends GroupForSegments>({
  workflowTimespan,
  lazyGroups,
  getEventGroupEndMs,
}: {
  workflowTimespan: Timespan;
  lazyGroups: Iterable<T>;
  getEventGroupEndMs?: (group: T) => number | undefined;
}): TimeSegment[] {
  const groupTimespans: TimelineActiveTimeRange[] = [];

  let isSorted = true;
  let prevStartTimeMs = -Infinity;
  for (const group of lazyGroups) {
    // A completed one-event group has a zero-width timespan and can never
    // affect the segmented scale. Avoid timestamp parsing and allocation for
    // signal/marker-heavy histories where nearly every group takes this path.
    if (group.initialEvent === group.lastEvent && !group.isPending) continue;

    const startMs = getGroupStartMs(group);

    if (isNullish(startMs)) {
      continue;
    }

    const endMs =
      getEventGroupEndMs?.(group) ??
      getGroupEndMs(group, workflowTimespan.endTimeMs);

    if (isSorted && startMs < prevStartTimeMs) {
      isSorted = false;
    }

    if (endMs > startMs) {
      groupTimespans.push({ startTimeMs: startMs, endTimeMs: endMs });
    }

    prevStartTimeMs = startMs;
  }

  if (!isSorted) {
    groupTimespans.sort((a, b) => a.startTimeMs - b.startTimeMs);
  }

  return buildTimeSegmentsFromRanges({ workflowTimespan, groupTimespans });
}

export function buildTimeSegmentsFromRanges({
  workflowTimespan,
  groupTimespans,
}: {
  workflowTimespan: Timespan;
  groupTimespans: Iterable<TimelineActiveTimeRange>;
}): TimeSegment[] {
  const timeSegments: TimeSegment[] = [];

  let cursorMs: number = workflowTimespan.startTimeMs;

  for (const groupTimespan of groupTimespans) {
    const groupStart = workflowTimespan.clamp(groupTimespan.startTimeMs);
    const groupEnd = workflowTimespan.clamp(groupTimespan.endTimeMs);

    if (groupEnd <= groupStart) continue;

    const currentSegment = timeSegments.at(-1);

    if (
      currentSegment?.kind === 'active' &&
      groupStart <= currentSegment.timespan.endTimeMs
    ) {
      // Overlapping or touching the current active span → extend if needed
      if (groupEnd > currentSegment.timespan.endTimeMs) {
        currentSegment.timespan = new Timespan(
          currentSegment.timespan.startTimeMs,
          groupEnd,
        );
        cursorMs = groupEnd;
      }
      continue;
    }

    if (cursorMs < groupStart) {
      timeSegments.push({
        kind: 'inactive',
        timespan: new Timespan(cursorMs, groupStart),
      });
    }

    timeSegments.push({
      kind: 'active',
      timespan: new Timespan(groupStart, groupEnd),
    });

    cursorMs = groupEnd;
  }

  if (cursorMs < workflowTimespan.endTimeMs) {
    timeSegments.push({
      kind: 'inactive',
      timespan: new Timespan(cursorMs, workflowTimespan.endTimeMs, {
        endUnbounded: workflowTimespan.endUnbounded,
      }),
    });
  }

  return timeSegments;
}
