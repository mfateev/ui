import { describe, expect, it, vi } from 'vitest';

import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import { DEFAULT_TIMELINE_PERFORMANCE_LIMITS } from './timeline-performance-limits';
import {
  limitWorkflowChainOverviewRuns,
  loadWorkflowChainIndex,
  loadWorkflowChainOverview,
  mergeWorkflowChainOverviewRuns,
  reconcileWorkflowChainOverviewProgress,
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

const continuedFrom = (runId: string): WorkflowEvent =>
  ({
    eventType: 'WorkflowExecutionStarted',
    attributes: { continuedExecutionRunId: runId },
  }) as WorkflowEvent;

describe('loadWorkflowChainOverview', () => {
  it('publishes link-ordered segments with explicit scan-limit boundaries', async () => {
    const snapshot = await loadWorkflowChainIndex({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      currentRunId: 'run-4',
      generation: 9,
      limits: {
        ...DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
        chainDiscoveryRuns: 1,
      },
      describeRun: async (runId) =>
        workflow(
          runId,
          `2026-01-01T00:0${Number(runId.slice(4)) - 1}:00Z`,
          runId === 'run-4' ? '' : `2026-01-01T00:0${runId.slice(4)}:00Z`,
        ),
      fetchInitialEvents: async (runId) =>
        runId === 'run-1'
          ? []
          : [continuedFrom(`run-${Number(runId.slice(4)) - 1}`)],
      fetchFinalEvents: async (runId) =>
        runId === 'run-4'
          ? []
          : [
              continuedAsNew(
                `run-${Number(runId.slice(4)) + 1}`,
                `2026-01-01T00:0${runId.slice(4)}:00Z`,
              ),
            ],
    });

    expect(snapshot.revision).toBe(9);
    expect(
      snapshot.segments.map((segment) =>
        segment.runs.map(({ runId }) => runId),
      ),
    ).toEqual([['run-1'], ['run-4']]);
    expect(snapshot.segments[0].after).toEqual({
      kind: 'scan-limit',
      resumeRunId: 'run-2',
    });
    expect(snapshot.segments[1].before).toEqual({
      kind: 'scan-limit',
      resumeRunId: 'run-3',
    });
  });

  it('walks the retained chain backwards and reports progress', async () => {
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
      currentRunId: 'run-2',
      describeRun: async (runId) => descriptions.get(runId),
      fetchInitialEvents: async (runId) =>
        runId === 'run-2' ? [continuedFrom('run-1')] : [],
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

  it('stops if the current run leaves the original chain', async () => {
    const next = workflow('run-2', '2026-01-01T00:01:00Z');
    next.firstExecutionRunId = 'another-chain';
    const onDiagnostic = vi.fn();

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      currentRunId: 'run-2',
      describeRun: async (runId) =>
        runId === 'run-1'
          ? workflow('run-1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')
          : next,
      fetchInitialEvents: async (runId) =>
        runId === 'run-2' ? [continuedFrom('run-1')] : [],
      fetchFinalEvents: async (runId) =>
        runId === 'run-1'
          ? [continuedAsNew('run-2', '2026-01-01T00:01:00Z')]
          : [],
      onDiagnostic,
    });

    expect(runs.map(({ runId }) => runId)).toEqual(['run-1']);
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'chain-mismatch', runId: 'run-2' }),
    );
  });

  it('walks backwards from the current run', async () => {
    const describeRun = vi.fn(async (runId: string) =>
      workflow(
        runId,
        `2026-01-01T00:0${Number(runId.slice(4)) - 1}:00Z`,
        runId === 'run-3' ? '' : `2026-01-01T00:0${runId.slice(4)}:00Z`,
      ),
    );

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      currentRunId: 'run-3',
      describeRun,
      fetchInitialEvents: async (runId) =>
        runId === 'run-1'
          ? []
          : [continuedFrom(`run-${Number(runId.slice(4)) - 1}`)],
      fetchFinalEvents: async (runId) =>
        runId === 'run-3'
          ? []
          : [
              continuedAsNew(
                `run-${Number(runId.slice(4)) + 1}`,
                `2026-01-01T00:0${runId.slice(4)}:00Z`,
              ),
            ],
    });

    expect(describeRun).toHaveBeenCalledTimes(3);
    expect(runs.map(({ runId }) => runId)).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('keeps the retained tail when the first and older runs have expired', async () => {
    const describeRun = vi.fn(async (runId: string) => {
      if (runId === 'run-1' || runId === 'run-2') return undefined;
      return workflow(
        runId,
        `2026-01-01T00:0${Number(runId.slice(4)) - 1}:00Z`,
      );
    });

    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      currentRunId: 'run-4',
      describeRun,
      fetchInitialEvents: async (runId) =>
        runId === 'run-4' ? [continuedFrom('run-3')] : [continuedFrom('run-2')],
      fetchFinalEvents: async () => [],
    });

    expect(runs.map(({ runId }) => runId)).toEqual(['run-3', 'run-4']);
    expect(describeRun).toHaveBeenCalledWith('run-1');
  });

  it('bounds both the recent tail and the runs after the retained first run', async () => {
    const onRun = vi.fn();
    const onDiagnostic = vi.fn();
    const runs = await loadWorkflowChainOverview({
      namespace: 'default',
      workflowId: 'workflow',
      firstRunId: 'run-1',
      currentRunId: 'run-6',
      generation: 7,
      limits: {
        ...DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
        chainDiscoveryRuns: 2,
      },
      describeRun: async (runId) =>
        workflow(
          runId,
          `2026-01-01T00:0${Number(runId.slice(4)) - 1}:00Z`,
          `2026-01-01T00:0${Number(runId.slice(4))}:00Z`,
        ),
      fetchInitialEvents: async (runId) =>
        runId === 'run-1'
          ? []
          : [continuedFrom(`run-${Number(runId.slice(4)) - 1}`)],
      fetchFinalEvents: async (runId) => [
        continuedAsNew(
          `run-${Number(runId.slice(4)) + 1}`,
          '2026-01-01T00:01:00Z',
        ),
      ],
      onRun,
      onDiagnostic,
    });
    expect(runs.map(({ runId }) => runId)).toEqual([
      'run-1',
      'run-2',
      'run-5',
      'run-6',
    ]);
    expect(onRun).toHaveBeenCalledTimes(4);
    expect(onRun.mock.calls[0][0]).toMatchObject({
      generation: 7,
      firstRunId: 'run-1',
      mutation: 'append',
    });
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
    expect(onDiagnostic).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reason: 'discovery-limit', runId: 'run-4' }),
    );
    expect(onDiagnostic).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reason: 'discovery-limit', runId: 'run-3' }),
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

describe('limitWorkflowChainOverviewRuns', () => {
  it('keeps bounded beginning and current-edge segments', () => {
    const runs = Array.from({ length: 10 }, (_, index) => ({
      runId: `run-${index + 1}`,
      status: 'Completed' as const,
      startTimeMs: index,
      endTimeMs: index + 1,
    }));

    expect(
      limitWorkflowChainOverviewRuns(runs, 3).map(({ runId }) => runId),
    ).toEqual(['run-1', 'run-2', 'run-3', 'run-8', 'run-9', 'run-10']);
  });

  it('does not copy an already-bounded overview', () => {
    const runs = [
      {
        runId: 'run-1',
        status: 'Running' as const,
        startTimeMs: 0,
        endTimeMs: 1,
      },
    ];

    expect(limitWorkflowChainOverviewRuns(runs, 1)).toBe(runs);
  });
});

describe('reconcileWorkflowChainOverviewProgress', () => {
  it('inserts discovered runs ahead of an already-published live tail', () => {
    const timelineRun = (
      runId: string,
      startTimeMs: number,
      endTimeMs: number,
    ) => ({
      runId,
      status: 'Running' as const,
      startTimeMs,
      endTimeMs,
    });
    const current = [timelineRun('run-3', 300, 400)];

    reconcileWorkflowChainOverviewProgress(current, {
      run: timelineRun('run-1', 100, 200),
      index: 0,
    });
    reconcileWorkflowChainOverviewProgress(current, {
      run: timelineRun('run-2', 200, 300),
      index: 1,
    });
    reconcileWorkflowChainOverviewProgress(current, {
      run: timelineRun('run-3', 300, 450),
      index: 2,
    });

    expect(current.map(({ runId }) => runId)).toEqual([
      'run-1',
      'run-2',
      'run-3',
    ]);
    expect(current[2].endTimeMs).toBe(450);
  });
});
