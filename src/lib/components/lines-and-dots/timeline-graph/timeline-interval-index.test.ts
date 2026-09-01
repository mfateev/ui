import { describe, expect, it } from 'vitest';

import type {
  TimelineGroupSummary,
  TimelineRunModel,
} from '$lib/services/timeline-run-model';

import {
  TimelineIntervalIndex,
  TimelineVisibilityBitset,
} from './timeline-interval-index';

const summary = (
  ordinal: number,
  startTimeMs: number,
  endTimeMs: number,
  pending = false,
): TimelineGroupSummary => ({
  key: `group-${ordinal}`,
  version: 1,
  initialEventId: ordinal * 2 + 1,
  finalEventId: ordinal * 2 + 2,
  startTimeMs,
  endTimeMs,
  category: 'activity',
  classification: 'Completed',
  finalClassification: 'Completed',
  eventCount: 2,
  points: [],
  row: {
    displayName: '',
    prefix: '',
    initialEventType: 'ActivityTaskScheduled',
    retryAttempt: 0,
    retried: false,
    scheduling: false,
    timelineCategory: 'activity',
    pendingPaused: false,
  },
  pending,
});

const model = (summaries: TimelineGroupSummary[]): TimelineRunModel => ({
  run: {
    runId: 'run',
    status: 'Completed',
    startTimeMs: 0,
    endTimeMs: 1,
  },
  revision: 1,
  groupCount: summaries.length,
  groupAt: (ordinal) => summaries[ordinal],
  groups: (start, end) => summaries.slice(start, end),
  loadDetails: async () => {
    throw new Error('not used');
  },
  retain: () => () => undefined,
  dispose: () => undefined,
});

describe('TimelineIntervalIndex', () => {
  it('finds nested, equal, and zero-duration intervals', () => {
    const summaries = [
      summary(0, 0, 100),
      summary(1, 20, 30),
      summary(2, 25, 25),
      summary(3, 25, 60),
      summary(4, 200, 210),
    ];
    const index = new TimelineIntervalIndex(model(summaries));
    index.ingest();
    expect(index.query(25, 25, 25).ordinals).toEqual([0, 1, 2, 3]);
    expect(index.query(205, 205, 205).ordinals).toEqual([4]);
  });

  it('bounds pathological pending scans and extends pending intervals', () => {
    const summaries = Array.from({ length: 10 }, (_, ordinal) =>
      summary(ordinal, ordinal, ordinal, true),
    );
    const index = new TimelineIntervalIndex(model(summaries), 4);
    index.ingest();
    const result = index.query(100, 101, 200);
    expect(result.pendingVisited).toBe(4);
    expect(result.truncatedPending).toBe(true);
    expect(result.ordinals).toEqual([0, 1, 2, 3]);
  });

  it('visits the search path plus returned intervals', () => {
    const summaries = Array.from({ length: 10_000 }, (_, ordinal) =>
      summary(ordinal, ordinal * 10, ordinal * 10 + 2),
    );
    const index = new TimelineIntervalIndex(model(summaries));
    index.ingest();
    const result = index.query(50_000, 50_100, 50_100);
    expect(result.ordinals).toHaveLength(11);
    expect(result.visitedNodes).toBeLessThan(100);
  });
});

describe('TimelineVisibilityBitset', () => {
  it('supports word-wise intersection, rank, and select', () => {
    const left = new TimelineVisibilityBitset(200);
    const right = new TimelineVisibilityBitset(200);
    for (const ordinal of [1, 2, 31, 32, 100, 199]) left.set(ordinal);
    for (const ordinal of [2, 31, 100, 150]) right.set(ordinal);
    const intersection = left.and(right);
    expect(intersection.count).toBe(3);
    expect(intersection.rank(100)).toBe(2);
    expect([0, 1, 2].map((rank) => intersection.select(rank))).toEqual([
      2, 31, 100,
    ]);
  });
});
