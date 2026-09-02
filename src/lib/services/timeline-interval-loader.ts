import { toEventHistory } from '$lib/models/event-history';
import type { HistoryEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import { getClosureFromEvents } from './chain-workflow-session';
import {
  type CompleteRawHistory,
  fetchCompleteRawHistoryOrThrow,
} from './events-service';
import { createGroupedEventBuffer } from './grouped-event-buffer';
import {
  DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  type TimelinePartialResult,
  type TimelinePerformanceLimits,
} from './timeline-performance-limits';
import {
  BufferTimelineRunModel,
  type CompleteHistoryIdentity,
  estimateTimelineModelBytes,
  getTimelineModelSession,
  SealedTimelineRunModel,
  TimelineDetailCache,
  type TimelineRunModel,
  TimelineRunModelCache,
} from './timeline-run-model';
import { AbortableSemaphore, runWithConcurrency } from './timeline-scheduler';
import type { WorkflowChainOverviewRun } from './workflow-chain-overview';
import { fetchWorkflow } from './workflow-service';

export type IntervalRunLoadState =
  | 'queued'
  | 'loading'
  | 'ready'
  | 'error'
  | 'truncated';

export type IntervalRunState = {
  run: WorkflowChainOverviewRun;
  state: IntervalRunLoadState;
  error?: unknown;
  truncation?: TimelinePartialResult;
};

export type TimelineIntervalLoadResult = {
  states: IntervalRunState[];
  models: TimelineRunModel[];
  truncation: TimelinePartialResult[];
};

type DescribeRun = (
  runId: string,
  signal: AbortSignal,
) => Promise<WorkflowExecution>;
type FetchEdge = (
  runId: string,
  sort: 'ascending' | 'descending',
  signal: AbortSignal,
) => Promise<HistoryEvent[]>;
type FetchHistory = (
  runId: string,
  signal: AbortSignal,
  onPage?: (loadedEventIds: number, pages: number) => void,
) => Promise<CompleteRawHistory>;

export type TimelineHistoryLoadCounters = {
  historyPages: number;
  loadedEventIds: number;
  gaps: number;
  completenessChecks: number;
  rejectedSealAttempts: number;
  sealedRunCompilations: number;
  sealedModelCacheHits: number;
  sealedModelCacheMisses: number;
};

const createCounters = (): TimelineHistoryLoadCounters => ({
  historyPages: 0,
  loadedEventIds: 0,
  gaps: 0,
  completenessChecks: 0,
  rejectedSealAttempts: 0,
  sealedRunCompilations: 0,
  sealedModelCacheHits: 0,
  sealedModelCacheMisses: 0,
});

const closeTimeMs = (workflow: WorkflowExecution): number =>
  Date.parse(workflow.endTime);

const isClosed = (workflow: WorkflowExecution): boolean =>
  workflow.status !== null &&
  workflow.status !== 'Running' &&
  workflow.status !== 'Paused';

export const completeHistoryIdentity = ({
  namespace,
  workflowId,
  workflow,
}: {
  namespace: string;
  workflowId: string;
  workflow: WorkflowExecution;
}): CompleteHistoryIdentity | undefined => {
  const historyLength = Number(workflow.historyEvents);
  const authoritativeCloseTimeMs = closeTimeMs(workflow);
  if (
    !isClosed(workflow) ||
    !Number.isSafeInteger(historyLength) ||
    historyLength < 1 ||
    !Number.isFinite(authoritativeCloseTimeMs)
  ) {
    return undefined;
  }
  return {
    namespace,
    workflowId,
    runId: workflow.runId,
    closeTimeMs: authoritativeCloseTimeMs,
    historyLength,
  };
};

export const verifyCompleteClosedHistory = ({
  initial,
  final,
  history,
}: {
  initial: WorkflowExecution;
  final: WorkflowExecution;
  history: CompleteRawHistory;
}): { complete: boolean; gaps: number; reason?: string } => {
  const expected = Number(initial.historyEvents);
  if (
    initial.runId !== final.runId ||
    initial.status !== final.status ||
    initial.historyEvents !== final.historyEvents ||
    closeTimeMs(initial) !== closeTimeMs(final)
  ) {
    return { complete: false, gaps: 0, reason: 'snapshot-changed' };
  }
  if (!isClosed(final)) {
    return { complete: false, gaps: 0, reason: 'run-is-live' };
  }
  const ids = history.events.map((event) => Number(event.eventId));
  const idSet = new Set(ids);
  let gaps = 0;
  for (let expectedId = 1; expectedId <= expected; expectedId += 1) {
    if (!idSet.has(expectedId)) gaps += 1;
  }
  if (history.kind !== 'complete' || ids.length !== expected || gaps > 0) {
    return { complete: false, gaps, reason: 'incomplete-history' };
  }
  const closure = getClosureFromEvents(toEventHistory(history.events));
  if (
    !closure ||
    closure.status !== final.status ||
    closure.endTimeMs !== closeTimeMs(final)
  ) {
    return { complete: false, gaps, reason: 'close-event-mismatch' };
  }
  return { complete: true, gaps };
};

export const selectTimelineIntervalRuns = ({
  runs,
  startTimeMs,
  endTimeMs,
  maximumRuns,
}: {
  runs: readonly WorkflowChainOverviewRun[];
  startTimeMs: number;
  endTimeMs: number;
  maximumRuns: number;
}): { selected: WorkflowChainOverviewRun[]; omitted: number } => {
  const center = startTimeMs + (endTimeMs - startTimeMs) / 2;
  const intersecting: { run: WorkflowChainOverviewRun; index: number }[] = [];
  const intersectingRunIds = new Set<string>();
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (
      !intersectingRunIds.has(run.runId) &&
      run.endTimeMs >= startTimeMs &&
      run.startTimeMs <= endTimeMs
    ) {
      intersecting.push({ run, index });
      intersectingRunIds.add(run.runId);
    }
  }
  if (intersecting.length === 0) return { selected: [], omitted: 0 };

  intersecting.sort((left, right) => {
    const leftCenter = (left.run.startTimeMs + left.run.endTimeMs) / 2;
    const rightCenter = (right.run.startTimeMs + right.run.endTimeMs) / 2;
    return (
      Math.abs(leftCenter - center) - Math.abs(rightCenter - center) ||
      left.index - right.index
    );
  });

  const selected = intersecting.slice(0, maximumRuns).map(({ run }) => run);
  if (selected.length < maximumRuns) {
    const selectedIds = new Set(selected.map(({ runId }) => runId));
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const { index } of intersecting) {
      if (index < first) first = index;
      if (index > last) last = index;
    }
    for (const index of [first - 1, last + 1]) {
      const context = runs[index];
      if (!context || selectedIds.has(context.runId)) continue;
      selected.push(context);
      selectedIds.add(context.runId);
      if (selected.length >= maximumRuns) break;
    }
  }
  return {
    selected,
    omitted: Math.max(0, intersecting.length - selected.length),
  };
};

export class TimelineIntervalLoader {
  readonly detailCache: TimelineDetailCache;
  readonly modelCache: TimelineRunModelCache;
  private generation = 0;
  private controller: AbortController | null = null;
  private activeModelReleases: (() => void)[] = [];
  readonly counters: TimelineHistoryLoadCounters = createCounters();

  constructor(
    private readonly limits: TimelinePerformanceLimits = DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
    session?: {
      detailCache: TimelineDetailCache;
      modelCache: TimelineRunModelCache;
    },
  ) {
    const resolvedSession =
      session ??
      getTimelineModelSession({
        maximumEntries: limits.intervalCacheRuns,
        maximumModelBytes: limits.intervalCacheBytes,
        maximumDetailBytes: limits.detailCacheBytes,
      });
    this.detailCache = resolvedSession.detailCache;
    this.modelCache = resolvedSession.modelCache;
  }

  abort(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    for (const release of this.activeModelReleases) release();
    this.activeModelReleases = [];
  }

  dispose(): void {
    this.abort();
  }

  async load({
    namespace,
    workflowId,
    runs,
    startTimeMs,
    endTimeMs,
    onState,
    onModel,
    describeRun,
    fetchEdge,
    fetchHistory,
  }: {
    namespace: string;
    workflowId: string;
    runs: readonly WorkflowChainOverviewRun[];
    startTimeMs: number;
    endTimeMs: number;
    onState?: (state: IntervalRunState, generation: number) => void;
    onModel?: (model: TimelineRunModel, generation: number) => void;
    describeRun?: DescribeRun;
    fetchEdge?: FetchEdge;
    fetchHistory?: FetchHistory;
  }): Promise<TimelineIntervalLoadResult> {
    this.abort();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const isCurrent = () =>
      this.generation === generation &&
      this.controller === controller &&
      !controller.signal.aborted;
    const http = new AbortableSemaphore(this.limits.intervalHttpRequests);
    const describe: DescribeRun =
      describeRun ??
      (async (runId, signal) => {
        const { workflow, error } = await fetchWorkflow(
          { namespace, workflowId, runId },
          (input, init) => fetch(input, { ...init, signal }),
        );
        if (error) throw new Error(error.message);
        if (!workflow) throw new Error('The workflow run was not found.');
        return workflow;
      });
    const history: FetchHistory =
      fetchHistory ??
      (fetchEdge
        ? async (runId, signal) => {
            const [ascending, descending] = await Promise.all([
              fetchEdge(runId, 'ascending', signal),
              fetchEdge(runId, 'descending', signal),
            ]);
            const byId = new Map<number, HistoryEvent>();
            for (const event of [...ascending, ...descending]) {
              byId.set(Number(event.eventId), event);
            }
            return {
              kind: 'complete',
              events: [...byId]
                .sort(([left], [right]) => left - right)
                .map(([, event]) => event),
              pages: 2,
              duplicateEventIds:
                ascending.length + descending.length - byId.size,
            };
          }
        : (runId, signal, onPage) =>
            fetchCompleteRawHistoryOrThrow({
              namespace,
              workflowId,
              runId,
              maximumPageSize: '1000',
              signal,
              onPage,
            }));

    const selection = selectTimelineIntervalRuns({
      runs,
      startTimeMs,
      endTimeMs,
      maximumRuns: this.limits.intervalRuns,
    });
    const states: IntervalRunState[] = selection.selected.map((run) => ({
      run,
      state: 'queued',
    }));
    const models: TimelineRunModel[] = [];
    const truncation: TimelinePartialResult[] = [];
    if (selection.omitted > 0) {
      truncation.push({
        reason: 'run-limit',
        startTimeMs,
        endTimeMs,
        omittedRuns: selection.omitted,
        affectsSelectedWindow: true,
      });
    }
    for (const state of states) onState?.(state, generation);

    let groups = 0;
    let events = 0;
    let bytes = 0;
    const publishState = (state: IntervalRunState): void => {
      if (isCurrent()) onState?.(state, generation);
    };

    await runWithConcurrency({
      values: states,
      concurrency: this.limits.intervalRunJobs,
      signal: controller.signal,
      run: async (runState) => {
        if (!isCurrent()) return;
        runState.state = 'loading';
        publishState(runState);
        try {
          const initialWorkflow = await http.run(
            () => describe(runState.run.runId, controller.signal),
            controller.signal,
          );
          if (!isCurrent()) return;
          const identity = completeHistoryIdentity({
            namespace,
            workflowId,
            workflow: initialWorkflow,
          });
          if (identity) this.modelCache.invalidateRunSnapshot(identity);
          const resolvedCached = identity
            ? this.modelCache.get(identity)
            : undefined;
          if (resolvedCached) {
            this.counters.sealedModelCacheHits += 1;
            runState.state = 'ready';
            this.activeModelReleases.push(resolvedCached.retain());
            models.push(resolvedCached);
            onModel?.(resolvedCached, generation);
            publishState(runState);
            return;
          }
          if (identity) this.counters.sealedModelCacheMisses += 1;
          const loadedHistory = await http.run(
            () => history(runState.run.runId, controller.signal),
            controller.signal,
          );
          const finalWorkflow = await http.run(
            () => describe(runState.run.runId, controller.signal),
            controller.signal,
          );
          if (!isCurrent()) return;
          this.counters.historyPages += loadedHistory.pages;
          this.counters.loadedEventIds += loadedHistory.events.length;
          const buffer = createGroupedEventBuffer({ formatTimestamps: false });
          buffer.reset(Number(finalWorkflow.historyEvents) || 0);
          for (const event of loadedHistory.events) {
            buffer.ingestHistoryEvent(event);
          }
          const resolvedRun = {
            ...runState.run,
            status: finalWorkflow.status,
          };
          let model: TimelineRunModel;
          const finalIdentity = completeHistoryIdentity({
            namespace,
            workflowId,
            workflow: finalWorkflow,
          });
          if (identity && finalIdentity) {
            this.counters.completenessChecks += 1;
            const verification = verifyCompleteClosedHistory({
              initial: initialWorkflow,
              final: finalWorkflow,
              history: loadedHistory,
            });
            this.counters.gaps += verification.gaps;
            if (!verification.complete) {
              this.counters.rejectedSealAttempts += 1;
              buffer.reset(0);
              throw new Error(
                `Closed workflow history could not be sealed: ${verification.reason}.`,
              );
            }
            model = await SealedTimelineRunModel.fromBufferCooperatively({
              identity: finalIdentity,
              run: resolvedRun,
              namespace,
              buffer,
              detailCache: this.detailCache,
              signal: controller.signal,
            });
            this.counters.sealedRunCompilations += 1;
          } else {
            model = new BufferTimelineRunModel(
              resolvedRun,
              namespace,
              workflowId,
              buffer,
              this.detailCache,
            );
          }
          const modelGroups = model.groupCount;
          const statistics = model.statistics;
          let modelEvents = statistics?.eventCount ?? 0;
          if (!statistics) {
            for (let ordinal = 0; ordinal < modelGroups; ordinal += 1) {
              modelEvents += model.groupAt(ordinal)?.eventCount ?? 0;
            }
          }
          const modelBytes =
            statistics?.estimatedBytes ?? estimateTimelineModelBytes(model);
          const reason =
            groups + modelGroups > this.limits.intervalGroups
              ? 'group-limit'
              : events + modelEvents > this.limits.intervalEvents
                ? 'event-limit'
                : bytes + modelBytes > this.limits.intervalBytes
                  ? 'byte-limit'
                  : undefined;
          if (reason) {
            model.dispose();
            runState.state = 'truncated';
            runState.truncation = {
              reason,
              startTimeMs: runState.run.startTimeMs,
              endTimeMs: runState.run.endTimeMs,
              omittedRuns: 1,
              omittedGroups: modelGroups,
              affectsSelectedWindow:
                runState.run.endTimeMs >= startTimeMs &&
                runState.run.startTimeMs <= endTimeMs,
            };
            truncation.push(runState.truncation);
            publishState(runState);
            return;
          }

          groups += modelGroups;
          events += modelEvents;
          bytes += modelBytes;
          if (model instanceof SealedTimelineRunModel && finalIdentity) {
            this.modelCache.set(finalIdentity, model, modelBytes);
          }
          this.activeModelReleases.push(model.retain());
          runState.state = 'ready';
          if (isCurrent()) {
            models.push(model);
            onModel?.(model, generation);
            publishState(runState);
          }
        } catch (error) {
          if (!isCurrent()) return;
          runState.state = 'error';
          runState.error = error;
          runState.truncation = {
            reason: 'load-error',
            startTimeMs: runState.run.startTimeMs,
            endTimeMs: runState.run.endTimeMs,
            omittedRuns: 1,
            affectsSelectedWindow:
              runState.run.endTimeMs >= startTimeMs &&
              runState.run.startTimeMs <= endTimeMs,
          };
          truncation.push(runState.truncation);
          publishState(runState);
        }
      },
    });

    return { states, models, truncation };
  }
}
