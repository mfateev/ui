import { describe, expect, it, vi } from 'vitest';

import type { WorkflowExecutionAPIResponse } from '$lib/types/workflows';

import {
  ChildWorkflowLoadError,
  classifyChildWorkflowError,
  describeChildWorkflow,
  loadChildWorkflow,
} from './child-workflow-loader';

const describeResponse = {
  workflowExecutionInfo: {
    execution: { workflowId: 'child', runId: 'child-run' },
    firstRunId: 'child-run',
    type: { name: 'Child' },
    status: 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
    startTime: '2024-01-01T00:00:00Z',
    closeTime: '2024-01-01T00:00:02Z',
    executionTime: '2024-01-01T00:00:00Z',
  },
} as unknown as WorkflowExecutionAPIResponse;

const rawEvent = (id: number) => ({
  eventId: String(id),
  eventTime: `2024-01-01T00:00:0${id}Z`,
  eventType: 'ActivityTaskScheduled',
  activityTaskScheduledEventAttributes: {
    activityId: String(id),
    activityType: { name: `Activity ${id}` },
  },
});

const continuedAsNewEvent = {
  eventId: '2',
  eventTime: '2024-01-01T00:00:02Z',
  eventType: 'WorkflowExecutionContinuedAsNew',
  workflowExecutionContinuedAsNewEventAttributes: {
    newExecutionRunId: 'successor-run',
  },
};

const completedEvent = {
  eventId: '2',
  eventTime: '2024-01-01T00:00:02Z',
  eventType: 'WorkflowExecutionCompleted',
  workflowExecutionCompletedEventAttributes: { result: null },
};

describe('loadChildWorkflow', () => {
  it('describes the exact child execution directly', async () => {
    const request = vi.fn().mockResolvedValue(describeResponse);

    const result = await describeChildWorkflow({
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      signal: new AbortController().signal,
      request,
    });

    expect(result).toMatchObject({
      id: 'child',
      runId: 'child-run',
      status: 'Completed',
      isRunning: false,
    });
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/workflows/child'),
      expect.objectContaining({
        params: { 'execution.runId': 'child-run' },
      }),
    );
  });

  it('stops before accepting a page that exceeds the event budget', async () => {
    const historyPages = [
      { history: { events: [rawEvent(1)] }, nextPageToken: 'next' },
      { history: { events: [rawEvent(2), rawEvent(3)] }, nextPageToken: '' },
    ];
    const request = vi.fn(async (route: string) =>
      route.endsWith('/history') ? historyPages.shift() : describeResponse,
    );

    const result = await loadChildWorkflow({
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      signal: new AbortController().signal,
      limits: { maximumEvents: 2, maximumGroups: 10 },
      request,
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(result.eventCount).toBe(1);
    expect(result.truncation).toEqual({ reason: 'event-limit' });
  });

  it('rejects a Describe response for a different exact run', async () => {
    const mismatched = structuredClone(describeResponse);
    mismatched.workflowExecutionInfo!.execution!.runId = 'other-run';
    await expect(
      loadChildWorkflow({
        reference: {
          namespace: 'default',
          workflowId: 'child',
          runId: 'child-run',
        },
        signal: new AbortController().signal,
        limits: { maximumEvents: 10, maximumGroups: 10 },
        request: vi.fn().mockResolvedValue(mismatched),
      }),
    ).rejects.toMatchObject({ kind: 'malformed', retryable: false });
  });

  it('preserves a continue-as-new successor omitted from grouped rows', async () => {
    const request = vi.fn(async (route: string) =>
      route.endsWith('/history')
        ? {
            history: { events: [rawEvent(1), continuedAsNewEvent] },
            nextPageToken: '',
          }
        : describeResponse,
    );

    const result = await loadChildWorkflow({
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      signal: new AbortController().signal,
      limits: { maximumEvents: 10, maximumGroups: 10 },
      request,
    });

    expect(result.run.successorRunId).toBe('successor-run');
  });

  it('uses terminal history when Describe still reports the run as active', async () => {
    const staleDescribe = structuredClone(describeResponse);
    staleDescribe.workflowExecutionInfo!.status =
      'WORKFLOW_EXECUTION_STATUS_RUNNING';
    staleDescribe.workflowExecutionInfo!.closeTime = '';
    const request = vi.fn(async (route: string) =>
      route.endsWith('/history')
        ? {
            history: { events: [rawEvent(1), completedEvent] },
            nextPageToken: '',
          }
        : staleDescribe,
    );

    const result = await loadChildWorkflow({
      reference: {
        namespace: 'default',
        workflowId: 'child',
        runId: 'child-run',
      },
      signal: new AbortController().signal,
      limits: { maximumEvents: 10, maximumGroups: 10 },
      request,
    });

    expect(result.run).toMatchObject({
      status: 'Completed',
      active: false,
      endTimeMs: Date.parse('2024-01-01T00:00:02Z'),
    });
  });
});

describe('classifyChildWorkflowError', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'unavailable'],
    [503, 'network'],
  ] as const)('maps HTTP %s to %s', (statusCode, kind) => {
    const error = classifyChildWorkflowError({
      statusCode,
      message: 'failure',
    });
    expect(error).toBeInstanceOf(ChildWorkflowLoadError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(kind === 'network');
  });
});
