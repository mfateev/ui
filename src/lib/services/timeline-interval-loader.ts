import type { HistoryEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import { fetchPartialRawEventsOrThrow } from './events-service';
import { createGroupedEventBuffer } from './grouped-event-buffer';
import {
  DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  type TimelinePartialResult,
  type TimelinePerformanceLimits,
} from './timeline-performance-limits';
import {
  BufferTimelineRunModel,
  estimateTimelineModelBytes,
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

  constructor(
    private readonly limits: TimelinePerformanceLimits = DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
  ) {
    this.detailCache = new TimelineDetailCache(limits.detailCacheBytes);
    this.modelCache = new TimelineRunModelCache(
      limits.intervalCacheRuns,
      limits.intervalCacheBytes,
    );
  }

  abort(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  dispose(): void {
    this.abort();
    this.modelCache.clear();
    this.detailCache.clear();
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
    const edge: FetchEdge =
      fetchEdge ??
      ((runId, sort, signal) =>
        fetchPartialRawEventsOrThrow({
          namespace,
          workflowId,
          runId,
          sort,
          maximumPageSize: '1000',
          signal,
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
        const baseCacheKey = `${namespace}:${workflowId}:${runState.run.runId}`;
        const overviewIsClosed =
          runState.run.status !== 'Running' && runState.run.status !== 'Paused';
        const cached = overviewIsClosed
          ? this.modelCache.get(baseCacheKey)
          : undefined;
        if (cached) {
          runState.state = 'ready';
          if (isCurrent()) {
            models.push(cached);
            onModel?.(cached, generation);
            publishState(runState);
          }
          return;
        }

        try {
          const [workflow, ascending, descending] = await Promise.all([
            http.run(
              () => describe(runState.run.runId, controller.signal),
              controller.signal,
            ),
            http.run(
              () => edge(runState.run.runId, 'ascending', controller.signal),
              controller.signal,
            ),
            http.run(
              () => edge(runState.run.runId, 'descending', controller.signal),
              controller.signal,
            ),
          ]);
          if (!isCurrent()) return;
          const resolvedCacheKey =
            workflow.status === 'Running' || workflow.status === 'Paused'
              ? `${baseCacheKey}:${workflow.historyEvents ?? '0'}`
              : baseCacheKey;
          const resolvedCached = this.modelCache.get(resolvedCacheKey);
          if (resolvedCached) {
            runState.state = 'ready';
            models.push(resolvedCached);
            onModel?.(resolvedCached, generation);
            publishState(runState);
            return;
          }
          const buffer = createGroupedEventBuffer();
          buffer.reset(Number(workflow.historyEvents) || 0);
          for (const event of ascending) buffer.ingestHistoryEvent(event);
          for (const event of descending) buffer.ingestHistoryEvent(event);
          const model = new BufferTimelineRunModel(
            {
              ...runState.run,
              status: workflow.status,
            },
            namespace,
            workflowId,
            buffer,
            this.detailCache,
          );
          const modelGroups = model.groupCount;
          let modelEvents = 0;
          for (let ordinal = 0; ordinal < modelGroups; ordinal += 1) {
            modelEvents += model.groupAt(ordinal)?.eventCount ?? 0;
          }
          const modelBytes = estimateTimelineModelBytes(model);
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
          this.modelCache.set(resolvedCacheKey, model, modelBytes);
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
