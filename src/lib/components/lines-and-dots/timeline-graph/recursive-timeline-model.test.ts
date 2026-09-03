import { describe, expect, it } from 'vitest';

import type { WorkflowExecution } from '$lib/types/workflows';

import {
  childEdgeKey,
  childExecutionKey,
  executionKey,
  flattenWorkflowNodes,
  type TimelineWorkflowNode,
  workflowFrameKey,
  workflowGroupKey,
} from './recursive-timeline-model';

const workflowNode = (key: string, depth = 0): TimelineWorkflowNode => ({
  key,
  namespace: 'default',
  workflowId: key,
  firstRunId: `${key}-run`,
  workflow: { id: key } as WorkflowExecution,
  runs: [],
  childrenByGroupKey: new Map(),
  depth,
});

describe('recursive timeline keys', () => {
  it('keeps ambiguous identities and reused workflow IDs distinct', () => {
    const first = executionKey({
      namespace: 'a:b',
      workflowId: 'c',
      firstRunId: 'd',
    });
    const second = executionKey({
      namespace: 'a',
      workflowId: 'b:c',
      firstRunId: 'd',
    });
    expect(first).not.toBe(second);
    expect(
      childExecutionKey({ namespace: 'a', workflowId: 'same', runId: 'one' }),
    ).not.toBe(
      childExecutionKey({ namespace: 'a', workflowId: 'same', runId: 'two' }),
    );
  });

  it('qualifies group, edge, and frame keys by their owner', () => {
    const group = workflowGroupKey({
      executionKey: 'owner',
      runId: 'run',
      timelineKey: 'run:7',
    });
    expect(group).toContain('owner');
    expect(
      childEdgeKey({
        parentExecutionKey: 'owner',
        parentGroupKey: group,
        childExecutionKey: 'child',
      }),
    ).toContain('child');
    expect(
      workflowFrameKey({ executionKey: 'owner', kind: 'run', runId: 'run' }),
    ).toContain('run');
  });
});

describe('flattenWorkflowNodes', () => {
  it('does not flatten a partially loaded child that reached a safety limit', () => {
    const root = workflowNode('root');
    const child = workflowNode('child', 1);
    root.childrenByGroupKey.set('relationship', {
      key: 'edge',
      parentGroupKey: 'relationship',
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      expansion: 'expanded',
      load: {
        state: 'loaded',
        node: child,
        truncation: { reason: 'event-limit' },
      },
      depth: 1,
      lastVisibleAt: 0,
    });

    expect(flattenWorkflowNodes(root)).toEqual([root]);
  });
});
