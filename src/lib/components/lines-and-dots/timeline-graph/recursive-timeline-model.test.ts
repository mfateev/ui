import { describe, expect, it } from 'vitest';

import {
  childEdgeKey,
  childExecutionKey,
  executionKey,
  workflowFrameKey,
  workflowGroupKey,
} from './recursive-timeline-model';

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
