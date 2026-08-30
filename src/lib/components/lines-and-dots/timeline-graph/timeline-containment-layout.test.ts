import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { TimelineRun } from '$lib/services/chain-workflow-session';
import type { WorkflowExecution } from '$lib/types/workflows';

import {
  type TimelineChildEdge,
  timelineRunKey,
  type TimelineWorkflowNode,
} from './recursive-timeline-model';
import { getRecursiveTimelineContainmentLayout } from './timeline-containment-layout';
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

describe('getRecursiveTimelineContainmentLayout', () => {
  it('places consecutive run spans on one shared boundary', () => {
    const firstEntry = entry('first', 1);
    const secondEntry = entry('second', 2);
    const root = {
      key: 'root',
      namespace: 'default',
      workflowId: 'root',
      firstRunId: 'first',
      workflow: { id: 'root' } as WorkflowExecution,
      runs: [
        { ...run('first', 0), groups: [firstEntry] },
        { ...run('second', 20), groups: [secondEntry] },
      ],
      childrenByGroupKey: new Map(),
      depth: 0,
    } as TimelineWorkflowNode;

    const layout = getRecursiveTimelineContainmentLayout({
      root,
      visibleEntries: [firstEntry, secondEntry],
      participatingRunKeys: new Set([
        timelineRunKey('root', 'first'),
        timelineRunKey('root', 'second'),
      ]),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.runSpans[0].rowEnd).toBe(layout.runSpans[1].rowStart);
  });

  it('flattens child and grandchild blocks while enclosing them in ancestor spans', () => {
    const rootRelationship = entry('root-run', 1);
    const rootAction = entry('root-run', 2);
    const childAction = entry('child-run', 1);
    const childNode: TimelineWorkflowNode = {
      key: 'child',
      namespace: 'default',
      workflowId: 'child',
      firstRunId: 'child-run',
      workflow: { id: 'child' } as WorkflowExecution,
      runs: [
        {
          ...run('child-run', 2),
          groups: [childAction],
        },
      ],
      childrenByGroupKey: new Map(),
      depth: 1,
    };
    const edge: TimelineChildEdge = {
      key: 'root-edge',
      parentGroupKey: rootRelationship.timelineKey,
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      expansion: 'expanded',
      load: { state: 'loaded', node: childNode },
      depth: 1,
      lastVisibleAt: 0,
    };
    const root: TimelineWorkflowNode = {
      key: 'root',
      namespace: 'default',
      workflowId: 'root',
      firstRunId: 'root-run',
      workflow: { id: 'root' } as WorkflowExecution,
      runs: [
        {
          ...run('root-run', 0),
          groups: [rootRelationship, rootAction],
        },
      ],
      childrenByGroupKey: new Map([[rootRelationship.timelineKey, edge]]),
      depth: 0,
    };

    const layout = getRecursiveTimelineContainmentLayout({
      root,
      visibleEntries: [rootRelationship, rootAction, childAction],
      participatingRunKeys: new Set([
        timelineRunKey('root', 'root-run'),
        timelineRunKey('child', 'child-run'),
      ]),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    });

    expect(layout.rows.map((row) => row.key)).toEqual([
      expect.stringContaining('workflow-header'),
      expect.stringContaining('frame-header'),
      expect.stringContaining('workflow-spacing-before'),
      expect.stringContaining('workflow-header'),
      expect.stringContaining('frame-header'),
      expect.stringContaining('child'),
      expect.stringContaining('workflow-spacing-after'),
      expect.stringContaining('workflow-spacing-after-padding'),
      expect.stringContaining('root'),
    ]);
    expect(layout.runSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: timelineRunKey('root', 'root-run'),
          rowStart: 1,
          rowEnd: 9,
        }),
        expect.objectContaining({
          key: timelineRunKey('child', 'child-run'),
          rowStart: 4,
          rowEnd: 6,
        }),
      ]),
    );
    const childSpan = layout.workflowSpans.find(
      (span) => span.workflowKey === 'child',
    );
    const leadingSpacing = layout.rows.find((row) =>
      row.key.endsWith('workflow-spacing-before'),
    );
    const trailingSpacing = layout.rows.find((row) =>
      row.key.endsWith('workflow-spacing-after'),
    );
    const trailingPadding = layout.rows.find((row) =>
      row.key.endsWith('workflow-spacing-after-padding'),
    );
    const followingParentRow = layout.rows.find(
      (row) => row.kind === 'group' && row.entry === rootAction,
    );
    expect(leadingSpacing?.rowIndex).toBe((childSpan?.rowStart ?? 0) - 1);
    expect(trailingSpacing?.rowIndex).toBe(childSpan?.rowEnd);
    expect(trailingPadding?.rowIndex).toBe(
      (trailingSpacing?.rowIndex ?? 0) + 1,
    );
    expect(followingParentRow?.rowIndex).toBe(
      (trailingPadding?.rowIndex ?? 0) + 1,
    );
  });

  it('omits a relationship row when its event is filtered out', () => {
    const relationship = entry('root-run', 1);
    const edge = {
      key: 'stable-edge',
      parentGroupKey: relationship.timelineKey,
      reference: { namespace: 'default', workflowId: 'child', runId: 'run' },
      expansion: 'expanded',
      load: { state: 'idle' },
      depth: 1,
      lastVisibleAt: 0,
    } as TimelineChildEdge;
    const root = {
      key: 'root',
      namespace: 'default',
      workflowId: 'root',
      firstRunId: 'root-run',
      workflow: { id: 'root' } as WorkflowExecution,
      runs: [{ ...run('root-run', 0), groups: [relationship] }],
      childrenByGroupKey: new Map([[relationship.timelineKey, edge]]),
      depth: 0,
    } as TimelineWorkflowNode;
    const input = {
      root,
      participatingRunKeys: new Set([timelineRunKey('root', 'root-run')]),
      reverseSort: false,
      pendingGroupCount: 0,
      descMinId: 0,
    };

    const shown = getRecursiveTimelineContainmentLayout({
      ...input,
      visibleEntries: [relationship],
    });
    const filtered = getRecursiveTimelineContainmentLayout({
      ...input,
      visibleEntries: [],
    });

    expect(shown.rows.find((row) => row.key === 'stable-edge')).toMatchObject({
      kind: 'group',
      key: 'stable-edge',
    });
    expect(filtered.rows.some((row) => row.key === 'stable-edge')).toBe(false);
  });
});
