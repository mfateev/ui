import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';

import { TimelineEntryWindowIndex } from './timeline-entry-window-index';
import type { TimelineGroupEntry } from './timeline-run-entries';

const entry = ({
  id,
  start,
  end,
  pending = false,
  active = false,
  runEnd = end,
}: {
  id: string;
  start: number;
  end: number;
  pending?: boolean;
  active?: boolean;
  runEnd?: number;
}): TimelineGroupEntry =>
  ({
    runId: 'run',
    timelineKey: id,
    active,
    runEndTimeMs: runEnd,
    group: {
      initialEvent: { eventTime: new Date(start).toISOString() },
      lastEvent: { eventTime: new Date(end).toISOString() },
      isPending: pending,
    } as unknown as EventGroup,
  }) as TimelineGroupEntry;

const keys = (entries: TimelineGroupEntry[]) =>
  entries.map(({ timelineKey }) => timelineKey);

describe('TimelineEntryWindowIndex', () => {
  it('finds overlapping intervals and preserves original entry order', () => {
    const entries = [
      entry({ id: 'later', start: 100, end: 120 }),
      entry({ id: 'wide', start: 0, end: 90 }),
      entry({ id: 'inside', start: 40, end: 50 }),
      entry({ id: 'after', start: 200, end: 220 }),
    ];
    const index = new TimelineEntryWindowIndex(entries);

    expect(keys(index.query(45, 60, 60).entries)).toEqual(['wide', 'inside']);
  });

  it('extends active pending entries to now and retained ones to the run end', () => {
    const entries = [
      entry({
        id: 'active-pending',
        start: 0,
        end: 10,
        pending: true,
        active: true,
      }),
      entry({
        id: 'retained-pending',
        start: 20,
        end: 30,
        pending: true,
        runEnd: 500,
      }),
    ];
    const index = new TimelineEntryWindowIndex(entries);

    expect(keys(index.query(400, 450, 1_000).entries)).toEqual([
      'active-pending',
      'retained-pending',
    ]);
    expect(index.query(1_001, 1_100, 1_000).entries).toEqual([]);
  });
});
