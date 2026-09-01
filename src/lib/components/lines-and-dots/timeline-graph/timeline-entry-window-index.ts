import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type {
  TimelineGroupSummary,
  TimelineRunModel,
} from '$lib/services/timeline-run-model';
import { validTimeToDate } from '$lib/utilities/format-time';

import { TimelineIntervalIndex } from './timeline-interval-index';
import type { TimelineGroupEntry } from './timeline-run-entries';

const time = (value: EventGroup['initialEvent']['eventTime']): number =>
  value ? validTimeToDate(value).getTime() : 0;

export class TimelineEntryWindowIndex {
  private readonly index: TimelineIntervalIndex;

  constructor(private readonly entries: readonly TimelineGroupEntry[]) {
    const model: TimelineRunModel = {
      run: {
        runId: 'entry-window-index',
        status: null,
        startTimeMs: 0,
        endTimeMs: 0,
      },
      revision: 0,
      groupCount: entries.length,
      groupAt: (ordinal) => this.summaryAt(ordinal),
      groups: (start, end) => {
        const summaries: TimelineGroupSummary[] = [];
        for (let ordinal = start; ordinal < end; ordinal += 1) {
          const summary = this.summaryAt(ordinal);
          if (summary) summaries.push(summary);
        }
        return summaries;
      },
      loadDetails: async () => {
        throw new Error('The entry window index does not own event details.');
      },
      retain: () => () => undefined,
      dispose: () => undefined,
    };
    this.index = new TimelineIntervalIndex(model);
    this.index.ingest();
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
    const result = this.index.query(startTimeMs, endTimeMs, nowMs);
    return {
      entries: result.ordinals.map((ordinal) => this.entries[ordinal]),
      visitedNodes: result.visitedNodes,
      pendingVisited: result.pendingVisited,
    };
  }

  private summaryAt(ordinal: number): TimelineGroupSummary | undefined {
    const entry = this.entries[ordinal];
    if (!entry) return undefined;
    const group = entry.group;
    const startTimeMs = time(group.initialEvent.eventTime);
    const lastTimeMs = time(group.lastEvent.eventTime) || startTimeMs;
    const pending = entry.active && group.isPending;
    return {
      key: entry.timelineKey,
      version: 'version' in group ? (group.version ?? 0) : 0,
      initialEventId: Number(group.initialEvent.id),
      finalEventId: Number(group.lastEvent.id),
      startTimeMs,
      endTimeMs:
        !entry.active && group.isPending
          ? Math.max(lastTimeMs, entry.runEndTimeMs)
          : lastTimeMs,
      category: group.category,
      classification: group.classification,
      finalClassification: group.finalClassification,
      eventCount: group.eventCount,
      points: [],
      row: {
        displayName: '',
        prefix: '',
        initialEventType: group.initialEvent.eventType,
        retryAttempt: 0,
        retried: false,
        scheduling: false,
        timelineCategory: group.category,
        pendingPaused: false,
      },
      pending,
    };
  }
}
