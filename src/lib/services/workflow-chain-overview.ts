import { toEventHistory } from '$lib/models/event-history';
import { getSuccessorFromEvents } from '$lib/services/chain-workflow-session';
import { fetchPartialRawEvents } from '$lib/services/events-service';
import { fetchWorkflow } from '$lib/services/workflow-service';
import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution, WorkflowStatus } from '$lib/types/workflows';

import type { ChainTransition } from './chain-workflow-session';

export interface WorkflowChainOverviewRun {
  runId: string;
  status: WorkflowStatus;
  startTimeMs: number;
  endTimeMs: number;
  nextRunId?: string;
  transitionToNext?: ChainTransition;
}

export const mergeWorkflowChainOverviewRuns = (
  current: WorkflowChainOverviewRun[],
  updates: WorkflowChainOverviewRun[],
): WorkflowChainOverviewRun[] => {
  const runs = new Map(current.map((run) => [run.runId, run]));

  for (const update of updates) {
    const existing = runs.get(update.runId);
    runs.set(update.runId, {
      ...existing,
      ...update,
      nextRunId: update.nextRunId ?? existing?.nextRunId,
      transitionToNext: update.transitionToNext ?? existing?.transitionToNext,
    });
  }

  return [...runs.values()].sort(
    (left, right) => left.startTimeMs - right.startTimeMs,
  );
};

interface LoadWorkflowChainOverviewOptions {
  namespace: string;
  workflowId: string;
  firstRunId: string;
  signal?: AbortSignal;
  existingRuns?: WorkflowChainOverviewRun[];
  onProgress?: (runs: WorkflowChainOverviewRun[]) => void;
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

  while (runId && !visited.has(runId)) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
      break;
    }

    const now = Date.now();
    const successor = getSuccessorFromEvents(events);
    const startTimeMs = timestamp(workflow.startTime, now);
    const endTimeMs = Math.max(
      startTimeMs,
      successor?.timeMs || timestamp(workflow.endTime, now),
    );
    runs.push({
      runId: workflow.runId,
      status: workflow.status,
      startTimeMs,
      endTimeMs,
      nextRunId: successor?.runId,
      transitionToNext: successor?.transition,
    });
    onProgress?.([...runs]);
    runId = successor?.runId;
  }

  return runs;
};
