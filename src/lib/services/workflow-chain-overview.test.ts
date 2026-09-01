import { describe, expect, it, vi } from 'vitest';

import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import { DEFAULT_TIMELINE_PERFORMANCE_LIMITS } from './timeline-performance-limits';
import {
  loadWorkflowChainOverview,
  mergeWorkflowChainOverviewRuns,
  WorkflowChainOverviewAccumulator,
} from './workflow-chain-overview';

const workflow = (
  runId: string,
  startTime: string,
  endTime = '',
): WorkflowExecution =>
  ({
    runId,
    firstExecutionRunId: 'run-1',
    startTime,
    endTime,
    status: endTime ? 'ContinuedAsNew' : 'Running',
  }) as WorkflowExecution;

const continuedAsNew = (runId: string, eventTime: string): WorkflowEvent =>
  ({
    eventType: 'WorkflowExecutionContinuedAsNew',
    eventTime,
    attributes: { newExecutionRunId: runId },
  }) as WorkflowEvent;

describe('loadWorkflowChainOverview', () => {
  it('walks successors from the first run and reports progress', async () => {
    const descriptions = new Map([
      [
        'run-1',
        workflow('run-1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'),
      ],
      ['run-2', workflow('run-2', '2026-01-01T00:01:00Z')],
    ]);
    const progress = vi.fn();

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      describeRun: async (runId) => descriptions.get(runId),
      fetchFinalEvents: async (runId) =>
        runId === 'run-1'
          ? [continuedAsNew('run-2', '2026-01-01T00:01:00Z')]
          : [],
      onProgress: progress,
    });

    expect(runs).toEqual([
      {
        runId: 'run-1',
        status: 'ContinuedAsNew',
        startTimeMs: Date.parse('2026-01-01T00:00:00Z'),
        endTimeMs: Date.parse('2026-01-01T00:01:00Z'),
        nextRunId: 'run-2',
        transitionToNext: 'continue-as-new',
      },
      expect.objectContaining({
        runId: 'run-2',
        status: 'Running',
        startTimeMs: Date.parse('2026-01-01T00:01:00Z'),
      }),
    ]);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('stops if a successor leaves the original chain', async () => {
    const next = workflow('run-2', '2026-01-01T00:01:00Z');
    next.firstExecutionRunId = 'another-chain';

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      describeRun: async (runId) =>
        runId === 'run-1'
          ? workflow('run-1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')
          : next,
      fetchFinalEvents: async (runId) =>
        runId === 'run-1'
          ? [continuedAsNew('run-2', '2026-01-01T00:01:00Z')]
          : [],
    });

    expect(runs.map(({ runId }) => runId)).toEqual(['run-1']);
  });

  it('refreshes only the known tail before appending a new successor', async () => {
    const existingRuns = [
      {
        runId: 'run-1',
        status: 'ContinuedAsNew' as const,
        startTimeMs: Date.parse('2026-01-01T00:00:00Z'),
        endTimeMs: Date.parse('2026-01-01T00:01:00Z'),
        nextRunId: 'run-2',
        transitionToNext: 'continue-as-new' as const,
      },
      {
        runId: 'run-2',
        status: 'Running' as const,
        startTimeMs: Date.parse('2026-01-01T00:01:00Z'),
        endTimeMs: Date.parse('2026-01-01T00:02:00Z'),
      },
    ];
    const describeRun = vi.fn(async (runId: string) =>
      runId === 'run-2'
        ? workflow('run-2', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z')
        : workflow('run-3', '2026-01-01T00:02:00Z'),
    );

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      existingRuns,
      describeRun,
      fetchFinalEvents: async (runId) =>
        runId === 'run-2'
          ? [continuedAsNew('run-3', '2026-01-01T00:02:00Z')]
          : [],
    });

    expect(describeRun).toHaveBeenCalledTimes(2);
    expect(describeRun).not.toHaveBeenCalledWith('run-1');
    expect(runs.map(({ runId }) => runId)).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('publishes one tagged run at a time and reports the discovery limit', async () => {
    const onRun = vi.fn();
    const onDiagnostic = vi.fn();
    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      generation: 7,
      limits: {
        ...DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
        successorDiscoveryRuns: 2,
      },
      describeRun: async (runId) =>
        workflow(
          runId,
          `2026-01-01T00:0${Number(runId.slice(4)) - 1}:00Z`,
          `2026-01-01T00:0${Number(runId.slice(4))}:00Z`,
        ),
      fetchFinalEvents: async (runId) => [
        continuedAsNew(
          `run-${Number(runId.slice(4)) + 1}`,
          '2026-01-01T00:01:00Z',
        ),
      ],
      onRun,
      onDiagnostic,
    });
    expect(runs).toHaveLength(2);
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun.mock.calls[0][0]).toMatchObject({
      generation: 7,
      firstRunId: 'run-1',
      mutation: 'append',
    });
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'discovery-limit' }),
    );
  });
});

describe('mergeWorkflowChainOverviewRuns', () => {
  it('adds completed and active runs without losing known transitions', () => {
    const merged = mergeWorkflowChainOverviewRuns(
      [
        {
          runId: 'run-1',
          status: 'Running',
          startTimeMs: 100,
          endTimeMs: 200,
          nextRunId: 'run-2',
          transitionToNext: 'continue-as-new',
        },
      ],
      [
        {
          runId: 'run-1',
          status: 'ContinuedAsNew',
          startTimeMs: 100,
          endTimeMs: 300,
        },
        {
          runId: 'run-2',
          status: 'Running',
          startTimeMs: 300,
          endTimeMs: 400,
        },
      ],
    );

    expect(merged).toEqual([
      {
        runId: 'run-1',
        status: 'ContinuedAsNew',
        startTimeMs: 100,
        endTimeMs: 300,
        nextRunId: 'run-2',
        transitionToNext: 'continue-as-new',
      },
      {
        runId: 'run-2',
        status: 'Running',
        startTimeMs: 300,
        endTimeMs: 400,
      },
    ]);
  });

  it('accumulates 10k ordered runs without sorting or copying prefixes', () => {
    const accumulator = new WorkflowChainOverviewAccumulator();
    for (let index = 0; index < 10_000; index += 1) {
      expect(
        accumulator.upsert({
          runId: `run-${index}`,
          status: 'Completed',
          startTimeMs: index,
          endTimeMs: index + 1,
        }),
      ).toBe('append');
    }
    expect(accumulator.runs).toHaveLength(10_000);
    expect(accumulator.indexOf('run-9999')).toBe(9999);
  });
});
