import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { PauseHandle } from '$lib/services/fetch-bidirectional';
import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution, WorkflowStatus } from '$lib/types/workflows';
import { validTimeToDate } from '$lib/utilities/format-time';

export type ChainTransition = 'continue-as-new' | 'retry' | 'reset' | 'cron';

export type TimelineGroup = {
  timelineKey: string;
  runId: string;
  group: EventGroup;
};

export type TimelineRun = {
  runId: string;
  status: WorkflowStatus;
  startTimeMs: number;
  endTimeMs: number;
  groups: TimelineGroup[];
  active: boolean;
  successorRunId?: string;
};

export const getRenderableTimelineRuns = ({
  retainedRuns,
  activeRun,
  activeHistoryReady,
}: {
  retainedRuns: TimelineRun[];
  activeRun: TimelineRun;
  activeHistoryReady: boolean;
}): TimelineRun[] => {
  if (!activeHistoryReady && retainedRuns.length > 0) return retainedRuns;
  return [...retainedRuns, activeRun];
};

export type RetainedTimelineRun = Omit<TimelineRun, 'active'> & {
  predecessorRunId?: string;
  successorRunId?: string;
  transitionFromPrevious?: ChainTransition;
};

export type ChainViewportState = {
  widthPx: number;
  offsetPx: number;
  expandedDurationPerViewportMs: number;
  overscanViewports: number;
  followingLiveEdge: boolean;
  anchorTimeMs?: number;
  hasMeasuredGeometry: boolean;
};

export type ChainTruncationState = {
  beforeTimeMs: number;
  reason: 'run-limit' | 'group-limit' | 'event-limit';
  affectsVisibleInterval: boolean;
};

export type ChainRetentionWindow = {
  oldestRetainedTimeMs: number;
  visibleStartTimeMs: number;
  visibleEndTimeMs: number;
};

export type ChainRetentionLimits = {
  completedRuns: number;
  completedGroups: number;
  completedEvents: number;
  hopsPerCycle: number;
};

export const DEFAULT_CHAIN_RETENTION_LIMITS: ChainRetentionLimits = {
  completedRuns: 20,
  completedGroups: 2_000,
  completedEvents: 10_000,
  hopsPerCycle: 5,
};

export type RunFetchState = {
  fetchComplete: boolean;
  latestEventId: number;
  totalExpectedEvents: number;
  descMinId: number;
};

export type RunRuntimeState = {
  historyController: AbortController;
  livePollController: AbortController | null;
  pauseHandle: PauseHandle | null;
  lastPollToken: string;
  pollPaused: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stagingSuccessorRunId?: string;
  disposed: boolean;
  dispose: () => void;
};

export type ActiveRunState = {
  runId: string;
  workflow: WorkflowExecution;
  fetch: RunFetchState;
  runtime: RunRuntimeState;
};

export type ChainWorkflowSession = {
  namespace: string;
  workflowId: string;
  firstRunId: string;
  following: boolean;
  generation: number;
  active: ActiveRunState;
  retainedRuns: RetainedTimelineRun[];
  viewport: ChainViewportState;
  truncation: ChainTruncationState | null;
};

export const timelineKey = (runId: string, groupId: string): string =>
  `${runId}:${groupId}`;

export const toTimelineGroups = (
  runId: string,
  groups: EventGroup[],
): TimelineGroup[] =>
  groups.map((group) => ({
    timelineKey: timelineKey(runId, group.id),
    runId,
    group,
  }));

export const createRunRuntime = (): RunRuntimeState => {
  const runtime: RunRuntimeState = {
    historyController: new AbortController(),
    livePollController: null,
    pauseHandle: null,
    lastPollToken: '',
    pollPaused: false,
    retryTimer: null,
    disposed: false,
    dispose: () => {
      if (runtime.disposed) return;
      runtime.disposed = true;
      runtime.historyController.abort();
      runtime.livePollController?.abort();
      runtime.livePollController = null;
      if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
      runtime.retryTimer = null;
      const pauseHandle = runtime.pauseHandle;
      runtime.pauseHandle = null;
      pauseHandle?.resume();
      runtime.stagingSuccessorRunId = undefined;
    },
  };
  return runtime;
};

export const isCurrentRun = (
  session: ChainWorkflowSession,
  generation: number,
  runId: string,
): boolean =>
  session.generation === generation &&
  session.active.runId === runId &&
  !session.active.runtime.disposed;

export const commitActiveRun = ({
  session,
  expectedGeneration,
  sourceRunId,
  next,
  retained,
}: {
  session: ChainWorkflowSession;
  expectedGeneration: number;
  sourceRunId: string;
  next: ActiveRunState;
  retained?: RetainedTimelineRun;
}): boolean => {
  if (!isCurrentRun(session, expectedGeneration, sourceRunId)) {
    next.runtime.dispose();
    return false;
  }

  session.active.runtime.dispose();
  if (retained) session.retainedRuns.push(retained);
  session.active = next;
  session.generation += 1;
  return true;
};

const transitionByEventType: Partial<
  Record<WorkflowEvent['eventType'], ChainTransition>
> = {
  WorkflowExecutionContinuedAsNew: 'continue-as-new',
  WorkflowExecutionFailed: 'retry',
  WorkflowExecutionTimedOut: 'retry',
  WorkflowExecutionCompleted: 'cron',
};

const closureStatusByEventType: Partial<
  Record<
    WorkflowEvent['eventType'],
    Exclude<WorkflowStatus, 'Running' | 'Paused' | null>
  >
> = {
  WorkflowExecutionCanceled: 'Canceled',
  WorkflowExecutionCompleted: 'Completed',
  WorkflowExecutionContinuedAsNew: 'ContinuedAsNew',
  WorkflowExecutionFailed: 'Failed',
  WorkflowExecutionTerminated: 'Terminated',
  WorkflowExecutionTimedOut: 'TimedOut',
};

export const getClosureFromEvents = (
  events: WorkflowEvent[],
): { status: WorkflowStatus; endTimeMs: number } | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const status = closureStatusByEventType[event.eventType];
    if (!status || !event.eventTime) continue;
    return {
      status,
      endTimeMs: validTimeToDate(event.eventTime).getTime(),
    };
  }
  return null;
};

export const getSuccessorFromEvents = (
  events: WorkflowEvent[],
): { runId: string; transition: ChainTransition; timeMs: number } | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const attributes = event.attributes as Record<string, unknown>;
    const resetRunId = attributes.newRunId;
    if (
      typeof resetRunId === 'string' &&
      resetRunId &&
      typeof attributes.baseRunId === 'string'
    ) {
      return {
        runId: resetRunId,
        transition: 'reset',
        timeMs: event.eventTime
          ? validTimeToDate(event.eventTime).getTime()
          : 0,
      };
    }

    const transition = transitionByEventType[event.eventType];
    const runId = attributes.newExecutionRunId;
    if (transition && typeof runId === 'string' && runId) {
      return {
        runId,
        transition,
        timeMs: event.eventTime
          ? validTimeToDate(event.eventTime).getTime()
          : 0,
      };
    }
  }
  return null;
};

export const getPredecessorFromEvents = (
  events: WorkflowEvent[],
): string | null => {
  const started = events.find(
    (event) => event.eventType === 'WorkflowExecutionStarted',
  );
  const runId = (started?.attributes as Record<string, unknown> | undefined)
    ?.continuedExecutionRunId;
  return typeof runId === 'string' && runId ? runId : null;
};

export const pruneRetainedRuns = (
  session: ChainWorkflowSession,
  limits: ChainRetentionLimits = DEFAULT_CHAIN_RETENTION_LIMITS,
  retentionWindow?: ChainRetentionWindow | null,
): void => {
  const retainedRuns = retentionWindow
    ? retainRunsWithinWindow(session.retainedRuns, retentionWindow)
    : session.retainedRuns;
  const result = limitRetainedRuns(retainedRuns, limits, retentionWindow);
  session.retainedRuns = result.runs;
  if (result.truncation) {
    session.truncation = session.truncation
      ? {
          ...result.truncation,
          beforeTimeMs: Math.max(
            session.truncation.beforeTimeMs,
            result.truncation.beforeTimeMs,
          ),
          affectsVisibleInterval:
            session.truncation.affectsVisibleInterval ||
            result.truncation.affectsVisibleInterval,
        }
      : result.truncation;
  }
};

export const getChainRetentionWindow = ({
  viewport,
  unprojectWorldPx,
}: {
  viewport: ChainViewportState;
  unprojectWorldPx: (worldPx: number) => number;
}): ChainRetentionWindow | null => {
  if (!viewport.hasMeasuredGeometry || viewport.widthPx <= 0) return null;

  const visibleStartWorldPx = Math.max(0, viewport.offsetPx);
  const visibleEndWorldPx = visibleStartWorldPx + viewport.widthPx;
  const oldestRetainedWorldPx = Math.max(
    0,
    visibleStartWorldPx - viewport.widthPx * viewport.overscanViewports,
  );

  return {
    oldestRetainedTimeMs: unprojectWorldPx(oldestRetainedWorldPx),
    visibleStartTimeMs: unprojectWorldPx(visibleStartWorldPx),
    visibleEndTimeMs: unprojectWorldPx(visibleEndWorldPx),
  };
};

const eventTimeMs = (event: WorkflowEvent | undefined): number | null => {
  if (!event?.eventTime) return null;
  const timeMs = validTimeToDate(event.eventTime).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
};

const groupTimeRange = (
  timelineGroup: TimelineGroup,
  run: RetainedTimelineRun,
): { startTimeMs: number; endTimeMs: number } => ({
  startTimeMs: eventTimeMs(timelineGroup.group.initialEvent) ?? run.startTimeMs,
  endTimeMs: eventTimeMs(timelineGroup.group.lastEvent) ?? run.endTimeMs,
});

export const retainRunsWithinWindow = (
  retainedRuns: RetainedTimelineRun[],
  retentionWindow: ChainRetentionWindow,
): RetainedTimelineRun[] =>
  retainedRuns.flatMap((run) => {
    const groups = run.groups.filter(
      (timelineGroup) =>
        groupTimeRange(timelineGroup, run).endTimeMs >=
        retentionWindow.oldestRetainedTimeMs,
    );

    if (
      run.endTimeMs < retentionWindow.oldestRetainedTimeMs &&
      groups.length === 0
    ) {
      return [];
    }

    return groups.length === run.groups.length ? [run] : [{ ...run, groups }];
  });

export const limitRetainedRuns = (
  retainedRuns: RetainedTimelineRun[],
  limits: ChainRetentionLimits = DEFAULT_CHAIN_RETENTION_LIMITS,
  retentionWindow?: ChainRetentionWindow | null,
): {
  runs: RetainedTimelineRun[];
  truncation: ChainTruncationState | null;
} => {
  const runs = retainedRuns.map((run) => ({ ...run, groups: [...run.groups] }));
  let truncation: ChainTruncationState | null = null;
  let groupCount = runs.reduce((count, run) => count + run.groups.length, 0);
  let eventCount = runs.reduce(
    (count, run) =>
      count +
      run.groups.reduce(
        (runCount, timelineGroup) =>
          runCount + timelineGroup.group.eventList.length,
        0,
      ),
    0,
  );

  const recordTruncation = (
    beforeTimeMs: number,
    reason: ChainTruncationState['reason'],
    affectsVisibleInterval: boolean,
  ) => {
    truncation = {
      beforeTimeMs: Math.max(
        truncation?.beforeTimeMs ?? -Infinity,
        beforeTimeMs,
      ),
      reason,
      affectsVisibleInterval:
        (truncation?.affectsVisibleInterval ?? false) || affectsVisibleInterval,
    };
  };

  const intersectsVisibleInterval = (startTimeMs: number, endTimeMs: number) =>
    retentionWindow
      ? endTimeMs >= retentionWindow.visibleStartTimeMs &&
        startTimeMs <= retentionWindow.visibleEndTimeMs
      : false;

  while (runs.length > limits.completedRuns) {
    const removed = runs.shift();
    if (!removed) break;
    const removedEvents = removed.groups.reduce(
      (count, timelineGroup) => count + timelineGroup.group.eventList.length,
      0,
    );
    groupCount -= removed.groups.length;
    eventCount -= removedEvents;
    recordTruncation(
      removed.endTimeMs,
      'run-limit',
      intersectsVisibleInterval(removed.startTimeMs, removed.endTimeMs),
    );
  }

  const removeOldestGroup = (
    reason: Extract<
      ChainTruncationState['reason'],
      'group-limit' | 'event-limit'
    >,
  ): boolean => {
    let candidate:
      | {
          runIndex: number;
          groupIndex: number;
          startTimeMs: number;
          endTimeMs: number;
          visible: boolean;
        }
      | undefined;

    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const run = runs[runIndex];
      for (
        let groupIndex = 0;
        groupIndex < run.groups.length;
        groupIndex += 1
      ) {
        const range = groupTimeRange(run.groups[groupIndex], run);
        const visible = intersectsVisibleInterval(
          range.startTimeMs,
          range.endTimeMs,
        );
        if (
          !candidate ||
          (candidate.visible && !visible) ||
          (candidate.visible === visible &&
            range.endTimeMs < candidate.endTimeMs)
        ) {
          candidate = { runIndex, groupIndex, ...range, visible };
        }
      }
    }

    if (!candidate) return false;
    const [removed] = runs[candidate.runIndex].groups.splice(
      candidate.groupIndex,
      1,
    );
    groupCount -= 1;
    eventCount -= removed.group.eventList.length;
    recordTruncation(candidate.endTimeMs, reason, candidate.visible);
    return true;
  };

  while (groupCount > limits.completedGroups) {
    if (!removeOldestGroup('group-limit')) break;
  }

  while (eventCount > limits.completedEvents) {
    if (!removeOldestGroup('event-limit')) break;
  }
  return { runs, truncation };
};
