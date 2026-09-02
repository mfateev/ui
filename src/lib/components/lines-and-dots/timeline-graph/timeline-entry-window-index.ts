import type { EventGroup } from '$lib/models/event-groups/event-groups';
import { validTimeToDate } from '$lib/utilities/format-time';

import type { TimelineGroupEntry } from './timeline-run-entries';

const time = (value: EventGroup['initialEvent']['eventTime']): number =>
  value ? validTimeToDate(value).getTime() : 0;

const groupTimes = (
  group: TimelineGroupEntry['group'],
): { startTimeMs: number; lastTimeMs: number } => {
  if (
    'startTimeMs' in group &&
    'lastTimeMs' in group &&
    typeof group.startTimeMs === 'number' &&
    typeof group.lastTimeMs === 'number'
  ) {
    return { startTimeMs: group.startTimeMs, lastTimeMs: group.lastTimeMs };
  }
  const points = 'eventPoints' in group ? group.eventPoints : undefined;
  const startTimeMs = points?.[0]?.timeMs ?? time(group.initialEvent.eventTime);
  const lastTimeMs = points?.at(-1)?.timeMs ?? time(group.lastEvent.eventTime);
  return { startTimeMs, lastTimeMs: lastTimeMs || startTimeMs };
};

type PendingInterval = {
  ordinal: number;
  startTimeMs: number;
  lastTimeMs: number;
};

/** Immutable interval index optimized for already time-ordered histories. */
export class TimelineEntryWindowIndex {
  private readonly ordinals: Uint32Array;
  private readonly startTimes: Float64Array;
  private readonly endTimes: Float64Array;
  private readonly prefixMaximumEndTimes: Float64Array;
  private readonly pending: PendingInterval[];
  private readonly preservesInputOrder: boolean;

  constructor(private readonly entries: readonly TimelineGroupEntry[]) {
    const startByOrdinal = new Float64Array(entries.length);
    const endByOrdinal = new Float64Array(entries.length);
    const orderedOrdinals: number[] = [];
    const pending: PendingInterval[] = [];
    let previousStartTimeMs = Number.NEGATIVE_INFINITY;
    let alreadySorted = true;

    for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
      const entry = entries[ordinal];
      const group = entry.group;
      const { startTimeMs, lastTimeMs } = groupTimes(group);
      const groupIsPending = group.isPending;
      if (entry.active && groupIsPending) {
        pending.push({ ordinal, startTimeMs, lastTimeMs });
        continue;
      }
      startByOrdinal[ordinal] = startTimeMs;
      endByOrdinal[ordinal] =
        !entry.active && groupIsPending
          ? Math.max(lastTimeMs, entry.runEndTimeMs)
          : lastTimeMs;
      if (startTimeMs < previousStartTimeMs) alreadySorted = false;
      previousStartTimeMs = startTimeMs;
      orderedOrdinals.push(ordinal);
    }

    if (!alreadySorted) {
      orderedOrdinals.sort(
        (left, right) =>
          startByOrdinal[left] - startByOrdinal[right] || left - right,
      );
    }

    this.ordinals = Uint32Array.from(orderedOrdinals);
    this.startTimes = new Float64Array(orderedOrdinals.length);
    this.endTimes = new Float64Array(orderedOrdinals.length);
    this.prefixMaximumEndTimes = new Float64Array(orderedOrdinals.length);
    let maximumEndTimeMs = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < orderedOrdinals.length; index += 1) {
      const ordinal = orderedOrdinals[index];
      const endTimeMs = endByOrdinal[ordinal];
      this.startTimes[index] = startByOrdinal[ordinal];
      this.endTimes[index] = endTimeMs;
      maximumEndTimeMs = Math.max(maximumEndTimeMs, endTimeMs);
      this.prefixMaximumEndTimes[index] = maximumEndTimeMs;
    }
    this.pending = pending;
    this.preservesInputOrder = alreadySorted && pending.length === 0;
  }

  query(
    startTimeMs: number,
    endTimeMs: number,
    nowMs: number,
  ): {
    entries: TimelineGroupEntry[];
    visitedNodes: number;
    pendingVisited: number;
  } {
    const endIndex = this.firstStartAfter(endTimeMs);
    const startIndex = this.firstPrefixEndAtOrAfter(startTimeMs, endIndex);
    const matchingEntries: TimelineGroupEntry[] = [];
    const matchingOrdinals: number[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      if (this.endTimes[index] >= startTimeMs) {
        const ordinal = this.ordinals[index];
        if (this.preservesInputOrder) {
          matchingEntries.push(this.entries[ordinal]);
        } else {
          matchingOrdinals.push(ordinal);
        }
      }
    }
    for (const interval of this.pending) {
      if (
        interval.startTimeMs <= endTimeMs &&
        Math.max(interval.lastTimeMs, nowMs) >= startTimeMs
      ) {
        matchingOrdinals.push(interval.ordinal);
      }
    }
    if (!this.preservesInputOrder) {
      matchingOrdinals.sort((left, right) => left - right);
      for (const ordinal of matchingOrdinals) {
        matchingEntries.push(this.entries[ordinal]);
      }
    }
    return {
      entries: matchingEntries,
      visitedNodes: Math.max(0, endIndex - startIndex),
      pendingVisited: this.pending.length,
    };
  }

  private firstStartAfter(timeMs: number): number {
    let low = 0;
    let high = this.startTimes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.startTimes[middle] <= timeMs) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private firstPrefixEndAtOrAfter(timeMs: number, endIndex: number): number {
    let low = 0;
    let high = endIndex;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.prefixMaximumEndTimes[middle] < timeMs) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
