import { toEventHistory } from '$lib/models/event-history';
import { getSuccessorFromEvents } from '$lib/services/chain-workflow-session';
import { fetchPartialRawEvents } from '$lib/services/events-service';
import { fetchWorkflow } from '$lib/services/workflow-service';
import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution, WorkflowStatus } from '$lib/types/workflows';

import type { ChainTransition } from './chain-workflow-session';
import {
  DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  type TimelinePerformanceLimits,
} from './timeline-performance-limits';
import { WorkflowChainOverviewAccumulator } from './workflow-chain-accumulator';

export { WorkflowChainOverviewAccumulator } from './workflow-chain-accumulator';

export interface WorkflowChainOverviewRun {
  runId: string;
  status: WorkflowStatus;
  startTimeMs: number;
  endTimeMs: number;
  nextRunId?: string;
  transitionToNext?: ChainTransition;
}

export type WorkflowChainDiagnosticReason =
  | 'discovery-limit'
  | 'cycle'
  | 'duplicate-run'
  | 'chain-mismatch';

export type WorkflowChainOverviewProgress = {
  run: WorkflowChainOverviewRun;
  index: number;
  mutation: 'append' | 'replace';
  generation: number;
  firstRunId: string;
};

export type WorkflowChainOverviewDiagnostic = {
  reason: WorkflowChainDiagnosticReason;
  runId?: string;
  discoveredRuns: number;
  generation: number;
  firstRunId: string;
};

export const mergeWorkflowChainOverviewRuns = (
  current: WorkflowChainOverviewRun[],
  updates: WorkflowChainOverviewRun[],
): WorkflowChainOverviewRun[] => {
  const accumulator = new WorkflowChainOverviewAccumulator(current);
  for (const update of updates) accumulator.upsert(update);
  return accumulator.snapshot();
};

interface LoadWorkflowChainOverviewOptions {
  namespace: string;
  workflowId: string;
  firstRunId: string;
  signal?: AbortSignal;
  existingRuns?: WorkflowChainOverviewRun[];
  onProgress?: (runs: WorkflowChainOverviewRun[]) => void;
  onRun?: (progress: WorkflowChainOverviewProgress) => void;
  onDiagnostic?: (diagnostic: WorkflowChainOverviewDiagnostic) => void;
  generation?: number;
  limits?: TimelinePerformanceLimits;
  describeRun?: (runId: string) => Promise<WorkflowExecution | undefined>;
  fetchFinalEvents?: (runId: string) => Promise<WorkflowEvent[]>;
}

const timestamp = (value: string, fallback: number): number =>
  Date.parse(value) || fallback;

export const loadWorkflowChainOverview = async ({
  namespace,
  workflowId,
  firstRunId,
  signal,
  existingRuns = [],
  onProgress,
  onRun,
  onDiagnostic,
  generation = 0,
  limits = DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  describeRun,
  fetchFinalEvents,
}: LoadWorkflowChainOverviewOptions): Promise<WorkflowChainOverviewRun[]> => {
  const requestWithSignal: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal });
  const describe =
    describeRun ??
    (async (runId: string) => {
      const { workflow, error } = await fetchWorkflow(
        { namespace, workflowId, runId },
        requestWithSignal,
      );
      if (error) throw new Error(error.message);
      return workflow;
    });
  const finalEvents =
    fetchFinalEvents ??
    (async (runId: string) =>
      toEventHistory(
        await fetchPartialRawEvents({
          namespace,
          workflowId,
          runId,
          sort: 'descending',
          maximumPageSize: '1',
          signal,
        }),
      ));

  const runs = existingRuns.slice(0, -1);
  const visited = new Set(runs.map(({ runId }) => runId));
  let runId: string | undefined = existingRuns.at(-1)?.runId ?? firstRunId;

  const diagnose = (
    reason: WorkflowChainDiagnosticReason,
    diagnosticRunId?: string,
  ) =>
    onDiagnostic?.({
      reason,
      runId: diagnosticRunId,
      discoveredRuns: runs.length,
      generation,
      firstRunId,
    });

  while (runId) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (runs.length >= limits.successorDiscoveryRuns) {
      diagnose('discovery-limit', runId);
      break;
    }
    if (visited.has(runId)) {
      diagnose(runId === runs.at(-1)?.runId ? 'duplicate-run' : 'cycle', runId);
      break;
    }
    visited.add(runId);

    const [workflow, events] = await Promise.all([
      describe(runId),
      finalEvents(runId),
    ]);
    if (!workflow) break;
    if (
      workflow.firstExecutionRunId &&
      workflow.firstExecutionRunId !== firstRunId
    ) {
      diagnose('chain-mismatch', workflow.runId);
      break;
    }

    const now = Date.now();
    const successor = getSuccessorFromEvents(events);
    const startTimeMs = timestamp(workflow.startTime, now);
    const endTimeMs = Math.max(
      startTimeMs,
      successor?.timeMs || timestamp(workflow.endTime, now),
    );
    const run: WorkflowChainOverviewRun = {
      runId: workflow.runId,
      status: workflow.status,
      startTimeMs,
      endTimeMs,
      nextRunId: successor?.runId,
      transitionToNext: successor?.transition,
    };
    const existingIndex = runs.findIndex(({ runId }) => runId === run.runId);
    const mutation = existingIndex < 0 ? 'append' : 'replace';
    const index = existingIndex < 0 ? runs.length : existingIndex;
    if (mutation === 'append') runs.push(run);
    else runs[index] = run;
    onRun?.({ run, index, mutation, generation, firstRunId });
    onProgress?.(runs);
    runId = successor?.runId;
  }

  return runs;
};
