import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { TimelineRun } from '$lib/services/chain-workflow-session';

import { getTimelineContainmentLayout } from './timeline-containment-layout';
import type { TimelineGroupEntry } from './timeline-run-entries';

const entry = (runId: string, id: number): TimelineGroupEntry => ({
  runId,
  timelineKey: `${runId}:${id}`,
  group: {
    id: String(id),
    initialEvent: { id: String(id) },
  } as EventGroup,
  active: runId === 'active',
  runEndTimeMs: 100,
});

const run = (
  runId: string,
  startTimeMs: number,
  active = false,
): TimelineRun => ({
  runId,
  startTimeMs,
  endTimeMs: startTimeMs + 10,
  status: active ? 'Running' : 'Completed',
  active,
  groups: [],
});

describe('getTimelineContainmentLayout', () => {
  it('orders run blocks and their groups without changing ownership', () => {
    const layout = getTimelineContainmentLayout({
      runs: [run('old', 0), run('active', 20, true)],
      visibleEntries: [entry('active', 3), entry('old', 2), entry('old', 1)],
      participatingRunIds: new Set(['old', 'active']),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.rows.map((row) => row.key)).toEqual([
      'old:1',
      'old:2',
      'active:3',
    ]);
    expect(layout.runSpans).toEqual([
      {
        runId: 'old',
        rowStart: 0,
        rowEnd: 2,
        empty: false,
        pendingRowStart: null,
        pendingRowCount: 0,
      },
      {
        runId: 'active',
        rowStart: 2,
        rowEnd: 3,
        empty: false,
        pendingRowStart: null,
        pendingRowCount: 0,
      },
    ]);
  });

  it('reverses run blocks and local rows while retaining stable keys', () => {
    const layout = getTimelineContainmentLayout({
      runs: [run('old', 0), run('active', 20, true)],
      visibleEntries: [entry('old', 1), entry('old', 2), entry('active', 1)],
      participatingRunIds: new Set(['old', 'active']),
      reverseSort: true,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.rows.map((row) => row.key)).toEqual([
      'active:1',
      'old:2',
      'old:1',
    ]);
  });

  it('gives a filtered-empty participating run one row', () => {
    const layout = getTimelineContainmentLayout({
      runs: [run('old', 0), run('offscreen', 10)],
      visibleEntries: [],
      participatingRunIds: new Set(['old']),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.rows).toEqual([
      {
        kind: 'empty-run',
        key: 'empty-run:old',
        runId: 'old',
        rowIndex: 0,
      },
    ]);
    expect(layout.totalRowCount).toBe(1);
  });

  it('assigns the cursor gap only to the active run', () => {
    const layout = getTimelineContainmentLayout({
      runs: [run('old', 0), run('active', 20, true)],
      visibleEntries: [
        entry('old', 1),
        entry('active', 2),
        entry('active', 90),
      ],
      participatingRunIds: new Set(['old', 'active']),
      reverseSort: false,
      pendingGroupCount: 4,
      descMinId: 80,
    });

    expect(layout.rows.map((row) => [row.key, row.rowIndex])).toEqual([
      ['old:1', 0],
      ['active:2', 1],
      ['active:90', 6],
    ]);
    expect(layout.runSpans[0].rowEnd).toBe(1);
    expect(layout.runSpans[1]).toMatchObject({
      rowStart: 1,
      rowEnd: 7,
      pendingRowStart: 2,
      pendingRowCount: 4,
    });
  });

  it('keeps duplicate group IDs unique by run ID', () => {
    const layout = getTimelineContainmentLayout({
      runs: [run('old', 0), run('active', 20, true)],
      visibleEntries: [entry('old', 7), entry('active', 7)],
      participatingRunIds: new Set(['old', 'active']),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.rows.map((row) => row.key)).toEqual(['old:7', 'active:7']);
  });
});
