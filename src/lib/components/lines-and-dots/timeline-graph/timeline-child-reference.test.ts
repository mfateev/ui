import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';

import { getChildWorkflowReference } from './timeline-child-reference';

const group = ({
  startedNamespace,
  initiatedNamespace,
  workflowId = 'child',
  runId = 'run',
}: {
  startedNamespace?: string;
  initiatedNamespace?: string;
  workflowId?: string;
  runId?: string;
}): EventGroup =>
  ({
    eventList: [
      {
        eventType: 'StartChildWorkflowExecutionInitiated',
        attributes: { namespace: initiatedNamespace },
      },
      {
        eventType: 'ChildWorkflowExecutionStarted',
        attributes: {
          namespace: startedNamespace,
          workflowExecution: { workflowId, runId },
        },
      },
    ],
  }) as EventGroup;

describe('getChildWorkflowReference', () => {
  it('prefers the namespace on the started event', () => {
    expect(
      getChildWorkflowReference(
        group({ startedNamespace: 'target', initiatedNamespace: 'old' }),
        'current',
      ),
    ).toEqual({ namespace: 'target', workflowId: 'child', runId: 'run' });
  });

  it('falls back through the initiation event to the current namespace', () => {
    expect(
      getChildWorkflowReference(
        group({ initiatedNamespace: 'initiated' }),
        'current',
      )?.namespace,
    ).toBe('initiated');
    expect(getChildWorkflowReference(group({}), 'current')?.namespace).toBe(
      'current',
    );
  });

  it('does not load a child without an exact run identity', () => {
    expect(
      getChildWorkflowReference(group({ runId: '' }), 'current'),
    ).toBeNull();
    expect(
      getChildWorkflowReference(
        {
          eventList: [
            {
              eventType: 'StartChildWorkflowExecutionFailed',
              attributes: {},
            },
          ],
        } as EventGroup,
        'current',
      ),
    ).toBeNull();
  });
});
