import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { TimelineRun } from '$lib/services/chain-workflow-session';

import {
  filterTimelineGroupEntries,
  getTimelineGroupEntries,
} from './timeline-run-entries';

const group = (id: string, category: EventGroup['category']): EventGroup =>
  ({ id, category }) as EventGroup;

const run = (
  runId: string,
  groups: EventGroup[],
  active: boolean,
): TimelineRun => ({
  runId,
  status: active ? 'Running' : 'Completed',
  startTimeMs: active ? 20 : 0,
  endTimeMs: active ? 30 : 10,
  active,
  groups: groups.map((item) => ({
    runId,
    timelineKey: `${runId}:${item.id}`,
    group: item,
  })),
});

describe('timeline run entries', () => {
  it('keeps duplicate group IDs owned by distinct runs', () => {
    const retainedGroup = group('7', 'activity');
    const activeGroup = group('7', 'activity');
    const entries = getTimelineGroupEntries([
      run('retained', [retainedGroup], false),
      run('active', [activeGroup], true),
    ]);

    expect(
      entries.map(({ runId, timelineKey, group: item }) => ({
        runId,
        timelineKey,
        item,
      })),
    ).toEqual([
      { runId: 'retained', timelineKey: 'retained:7', item: retainedGroup },
      { runId: 'active', timelineKey: 'active:7', item: activeGroup },
    ]);
  });

  it('applies the same event-type filter to active and retained entries', () => {
    const entries = getTimelineGroupEntries([
      run('retained', [group('1', 'activity'), group('2', 'timer')], false),
      run('active', [group('1', 'activity'), group('2', 'timer')], true),
    ]);

    expect(
      filterTimelineGroupEntries({
        entries,
        eventTypes: ['timer'],
        failedOrPending: false,
      }).map((entry) => entry.timelineKey),
    ).toEqual(['retained:2', 'active:2']);
  });
});
