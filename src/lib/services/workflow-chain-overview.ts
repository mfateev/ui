import { toEventHistory } from '$lib/models/event-history';
import {
  getPredecessorFromEvents,
  getSuccessorFromEvents,
} from '$lib/services/chain-workflow-session';
import { fetchPartialRawEvents } from '$lib/services/events-service';
import { fetchWorkflow } from '$lib/services/workflow-service';
import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution, WorkflowStatus } from '$lib/types/workflows';
import { isNotFound } from '$lib/utilities/handle-error';

import type { ChainTransition } from './chain-workflow-session';
import {
  DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  type TimelinePerformanceLimits,
} from './timeline-performance-limits';
import { WorkflowChainOverviewAccumulator } from './workflow-chain-accumulator';
import {
  assertChainIndex,
  type ChainBoundary,
  type ChainIndexSnapshot,
  chainRunEndTimeMs,
  type ChainRunSummary,
  type ChainSegment,
  createChainIndexSnapshot,
} from './workflow-chain-index';

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

export const limitWorkflowChainOverviewRuns = (
  runs: WorkflowChainOverviewRun[],
  runsPerEdge = DEFAULT_TIMELINE_PERFORMANCE_LIMITS.chainDiscoveryRuns,
): WorkflowChainOverviewRun[] => {
  const edgeLimit = Math.max(1, runsPerEdge);
  if (runs.length <= edgeLimit * 2) return runs;
  return [...runs.slice(0, edgeLimit), ...runs.slice(-edgeLimit)];
};

export const reconcileWorkflowChainOverviewProgress = (
  current: WorkflowChainOverviewRun[],
  progress: Pick<WorkflowChainOverviewProgress, 'run' | 'index'>,
): void => {
  const existingIndex = current.findIndex(
    ({ runId }) => runId === progress.run.runId,
  );
  const existing =
    existingIndex < 0 ? undefined : current.splice(existingIndex, 1)[0];
  const run = existing
    ? mergeWorkflowChainOverviewRuns([existing], [progress.run])[0]
    : progress.run;
  current.splice(Math.min(progress.index, current.length), 0, run);
};

export interface LoadWorkflowChainOverviewOptions {
  namespace: string;
  workflowId: string;
  firstRunId: string;
  currentRunId: string;
  signal?: AbortSignal;
  onProgress?: (runs: WorkflowChainOverviewRun[]) => void;
  onRun?: (progress: WorkflowChainOverviewProgress) => void;
  onDiagnostic?: (diagnostic: WorkflowChainOverviewDiagnostic) => void;
  generation?: number;
  limits?: TimelinePerformanceLimits;
  describeRun?: (runId: string) => Promise<WorkflowExecution | undefined>;
  fetchInitialEvents?: (runId: string) => Promise<WorkflowEvent[]>;
  fetchFinalEvents?: (runId: string) => Promise<WorkflowEvent[]>;
}

const timestamp = (value: string, fallback: number): number =>
  Date.parse(value) || fallback;

const scanWorkflowChainIndex = async ({
  namespace,
  workflowId,
  firstRunId,
  currentRunId,
  signal,
  onProgress,
  onRun,
  onDiagnostic,
  generation = 0,
  limits = DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  describeRun,
  fetchInitialEvents,
  fetchFinalEvents,
}: LoadWorkflowChainOverviewOptions): Promise<ChainIndexSnapshot> => {
  const requestWithSignal: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal });
  const describe =
    describeRun ??
    (async (runId: string) => {
      const { workflow, error } = await fetchWorkflow(
        { namespace, workflowId, runId },
        requestWithSignal,
      );
      if (isNotFound(error)) return undefined;
      if (error) throw error;
      return workflow;
    });
  const initialEvents =
    fetchInitialEvents ??
    (async (runId: string) =>
      toEventHistory(
        await fetchPartialRawEvents({
          namespace,
          workflowId,
          runId,
          sort: 'ascending',
          maximumPageSize: '1',
          signal,
        }),
      ));
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

  const tailRuns: ChainRunSummary[] = [];
  const headRuns: ChainRunSummary[] = [];
  const visited = new Set<string>();
  let tailBefore: ChainBoundary = { kind: 'not-scanned' };
  let tailAfter: ChainBoundary = { kind: 'not-scanned' };
  let headBefore: ChainBoundary = { kind: 'not-scanned' };
  let headAfter: ChainBoundary = { kind: 'not-scanned' };

  const diagnose = (
    reason: WorkflowChainDiagnosticReason,
    diagnosticRunId?: string,
  ) =>
    onDiagnostic?.({
      reason,
      runId: diagnosticRunId,
      discoveredRuns: headRuns.length + tailRuns.length,
      generation,
      firstRunId,
    });

  const loadRun = async (runId: string) => {
    const workflow = await describe(runId);
    if (!workflow) return undefined;
    if (
      workflow.firstExecutionRunId &&
      workflow.firstExecutionRunId !== firstRunId
    ) {
      diagnose('chain-mismatch', workflow.runId);
      return { invalid: true as const };
    }

    const [firstEvents, lastEvents] = await Promise.all([
      initialEvents(runId),
      finalEvents(runId),
    ]);
    const now = Date.now();
    const successor = getSuccessorFromEvents(lastEvents);
    const startTimeMs = timestamp(workflow.startTime, now);
    const live = workflow.status === 'Running' || workflow.status === 'Paused';
    const predecessorRunId = getPredecessorFromEvents(firstEvents) ?? undefined;
    return Object.freeze({
      runId: workflow.runId,
      status: workflow.status,
      startTimeMs,
      end: live
        ? Object.freeze({ kind: 'live' as const })
        : Object.freeze({
            kind: 'closed' as const,
            timeMs: Math.max(
              startTimeMs,
              successor?.timeMs || timestamp(workflow.endTime, now),
            ),
          }),
      predecessorRunId,
      successorRunId: successor?.runId,
      transitionToSuccessor: successor?.transition,
    } satisfies ChainRunSummary);
  };

  let runId: string | undefined = currentRunId;
  let expectedSuccessorRunId: string | undefined;
  while (runId) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (tailRuns.length >= limits.chainDiscoveryRuns) {
      diagnose('discovery-limit', runId);
      tailBefore = { kind: 'scan-limit', resumeRunId: runId };
      break;
    }
    if (visited.has(runId)) {
      diagnose('cycle', runId);
      tailBefore = { kind: 'invalid-chain', reason: 'cycle' };
      break;
    }
    visited.add(runId);

    const result = await loadRun(runId);
    if (!result) {
      tailBefore = { kind: 'retention', missingRunId: runId };
      break;
    }
    if ('invalid' in result) {
      tailBefore = { kind: 'invalid-chain', reason: 'mismatch' };
      break;
    }
    if (
      expectedSuccessorRunId !== undefined &&
      result.successorRunId !== undefined &&
      result.successorRunId !== expectedSuccessorRunId
    ) {
      diagnose('chain-mismatch', result.runId);
      tailBefore = { kind: 'invalid-chain', reason: 'mismatch' };
      break;
    }
    const verifiedRun =
      expectedSuccessorRunId !== undefined && !result.successorRunId
        ? Object.freeze({
            ...result,
            end:
              result.end.kind === 'live' && tailRuns[0]
                ? Object.freeze({
                    kind: 'closed' as const,
                    timeMs: tailRuns[0].startTimeMs,
                  })
                : result.end,
            successorRunId: expectedSuccessorRunId,
            transitionToSuccessor: 'continue-as-new' as const,
          })
        : result;
    tailRuns.unshift(verifiedRun);
    const overviewRun = toOverviewRun(verifiedRun, Date.now());
    onRun?.({
      run: overviewRun,
      index: 0,
      mutation: 'append',
      generation,
      firstRunId,
    });
    onProgress?.(tailRuns.map((run) => toOverviewRun(run, Date.now())));
    if (!verifiedRun.predecessorRunId) {
      tailBefore =
        verifiedRun.runId === firstRunId
          ? { kind: 'known-chain-start' }
          : { kind: 'retention' };
      break;
    }
    expectedSuccessorRunId = verifiedRun.runId;
    runId = verifiedRun.predecessorRunId;
  }

  const tailLast = tailRuns.at(-1);
  tailAfter = tailLast
    ? tailLast.end.kind === 'live'
      ? { kind: 'live-edge' }
      : tailLast.successorRunId
        ? { kind: 'not-scanned', resumeRunId: tailLast.successorRunId }
        : { kind: 'known-chain-end' }
    : { kind: 'not-scanned', resumeRunId: currentRunId };

  if (!visited.has(firstRunId)) {
    const headVisited = new Set<string>();
    runId = firstRunId;
    let expectedPredecessorRunId: string | undefined;
    while (runId && !visited.has(runId)) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (headRuns.length >= limits.chainDiscoveryRuns) {
        diagnose('discovery-limit', runId);
        headAfter = { kind: 'scan-limit', resumeRunId: runId };
        break;
      }
      if (headVisited.has(runId)) {
        diagnose('cycle', runId);
        headAfter = { kind: 'invalid-chain', reason: 'cycle' };
        break;
      }
      headVisited.add(runId);

      const result = await loadRun(runId);
      if (!result) {
        if (headRuns.length === 0)
          headBefore = { kind: 'retention', missingRunId: runId };
        else headAfter = { kind: 'retention', missingRunId: runId };
        break;
      }
      if ('invalid' in result) {
        headAfter = { kind: 'invalid-chain', reason: 'mismatch' };
        break;
      }
      if (
        expectedPredecessorRunId !== undefined &&
        result.predecessorRunId !== expectedPredecessorRunId
      ) {
        diagnose('chain-mismatch', result.runId);
        headAfter = { kind: 'invalid-chain', reason: 'mismatch' };
        break;
      }
      headRuns.push(result);
      const overviewRun = toOverviewRun(result, Date.now());
      onRun?.({
        run: overviewRun,
        index: headRuns.length - 1,
        mutation: 'append',
        generation,
        firstRunId,
      });
      onProgress?.(
        [...headRuns, ...tailRuns].map((run) => toOverviewRun(run, Date.now())),
      );
      expectedPredecessorRunId = result.runId;
      runId = result.successorRunId;
    }
    headBefore =
      headRuns[0]?.runId === firstRunId
        ? { kind: 'known-chain-start' }
        : headBefore;
    if (runId && visited.has(runId)) {
      const tailFirst = tailRuns[0];
      const headLast = headRuns.at(-1);
      if (
        tailFirst &&
        headLast?.successorRunId === tailFirst.runId &&
        tailFirst.predecessorRunId === headLast.runId
      ) {
        tailRuns.unshift(...headRuns);
        headRuns.length = 0;
        tailBefore = headBefore;
      } else {
        diagnose('chain-mismatch', runId);
        headAfter = { kind: 'invalid-chain', reason: 'mismatch' };
      }
    } else if (headRuns.length && headAfter.kind === 'not-scanned') {
      const nextRunId = headRuns.at(-1)?.successorRunId;
      headAfter = nextRunId
        ? { kind: 'not-scanned', resumeRunId: nextRunId }
        : { kind: 'known-chain-end' };
    }
  }

  const segments: ChainSegment[] = [];
  if (headRuns.length)
    segments.push({ runs: headRuns, before: headBefore, after: headAfter });
  if (tailRuns.length)
    segments.push({ runs: tailRuns, before: tailBefore, after: tailAfter });
  const snapshot = createChainIndexSnapshot({
    namespace,
    workflowId,
    firstExecutionRunId: firstRunId,
    currentRunId,
    revision: generation,
    segments,
  });
  assertChainIndex(snapshot);
  return snapshot;
};

const toOverviewRun = (
  run: ChainRunSummary,
  liveTimeMs: number,
): WorkflowChainOverviewRun => ({
  runId: run.runId,
  status: run.status,
  startTimeMs: run.startTimeMs,
  endTimeMs: chainRunEndTimeMs(run, liveTimeMs),
  nextRunId: run.successorRunId,
  transitionToNext: run.transitionToSuccessor,
});

export const loadWorkflowChainIndex = (
  options: LoadWorkflowChainOverviewOptions,
): Promise<ChainIndexSnapshot> => scanWorkflowChainIndex(options);

export const workflowChainIndexOverviewSegments = (
  index: ChainIndexSnapshot,
  liveTimeMs = Date.now(),
): readonly Readonly<{
  runs: readonly WorkflowChainOverviewRun[];
  before: ChainBoundary;
  after: ChainBoundary;
}>[] =>
  index.segments.map((segment) =>
    Object.freeze({
      runs: Object.freeze(
        segment.runs.map((run) => toOverviewRun(run, liveTimeMs)),
      ),
      before: segment.before,
      after: segment.after,
    }),
  );

export const loadWorkflowChainOverview = async (
  options: LoadWorkflowChainOverviewOptions,
): Promise<WorkflowChainOverviewRun[]> => {
  const index = await loadWorkflowChainIndex(options);
  return workflowChainIndexOverviewSegments(index, index.scannedAtMs).flatMap(
    (segment) => segment.runs,
  );
};
