import { mockWorkflow } from './mocks/workflow';

import type { HistoryEvent } from '$src/lib/types/events';
import type { WorkflowExecutionAPIResponse } from '$src/lib/types/workflows';

const DEFAULT_START_TIME_MS = Date.UTC(2026, 0, 1);

export type TimelineStressRun = {
  index: number;
  runId: string;
  startTimeMs: number;
  endTimeMs: number;
  rowCount: number;
  eventCount: number;
  rowType: 'marker' | 'activity';
  nextRunId?: string;
};

export type TimelineStressHistoryPage = {
  events: HistoryEvent[];
  nextPageToken: string | null;
};

export type TimelineStressFixture = {
  workflowId: string;
  firstRunId: string;
  currentRunId: string;
  totalRows: number;
  runs: readonly TimelineStressRun[];
  workflowResponse: (runId: string) => WorkflowExecutionAPIResponse;
  historyPage: (
    runId: string,
    sort: 'ascending' | 'descending',
    maximumPageSize: number,
    nextPageToken?: string | null,
  ) => TimelineStressHistoryPage;
};

export type TimelineStressFixtureOptions = {
  workflowId?: string;
  runCount: number;
  rowsPerRun: number;
  runDurationMs?: number;
  startTimeMs?: number;
  rowType?: 'marker' | 'activity';
};

const timestamp = (milliseconds: number): string =>
  new Date(milliseconds).toISOString();

const baseEvent = (
  eventId: number,
  eventTimeMs: number,
  eventType: string,
): HistoryEvent =>
  ({
    eventId: String(eventId),
    eventTime: timestamp(eventTimeMs),
    eventType,
    version: '0',
    taskId: String(eventId),
    links: [],
  }) as unknown as HistoryEvent;

const eventAt = (run: TimelineStressRun, eventIndex: number): HistoryEvent => {
  const eventId = eventIndex + 1;
  if (eventIndex === 0) {
    return {
      ...baseEvent(eventId, run.startTimeMs, 'WorkflowExecutionStarted'),
      workflowExecutionStartedEventAttributes: {
        workflowType: { name: 'TimelineStressWorkflow' },
        taskQueue: { name: 'timeline-stress', kind: 'Normal' },
        input: null,
        attempt: 1,
        firstExecutionRunId: 'unused-by-the-timeline-fixture',
        originalExecutionRunId: 'unused-by-the-timeline-fixture',
      },
    } as unknown as HistoryEvent;
  }

  if (eventIndex === run.eventCount - 1 && run.nextRunId) {
    return {
      ...baseEvent(eventId, run.endTimeMs, 'WorkflowExecutionContinuedAsNew'),
      workflowExecutionContinuedAsNewEventAttributes: {
        newExecutionRunId: run.nextRunId,
        workflowType: { name: 'TimelineStressWorkflow' },
        taskQueue: { name: 'timeline-stress', kind: 'Normal' },
        input: null,
      },
    } as unknown as HistoryEvent;
  }

  if (eventIndex === run.eventCount - 1) {
    return {
      ...baseEvent(eventId, run.endTimeMs, 'WorkflowExecutionCompleted'),
      workflowExecutionCompletedEventAttributes: { result: null },
    } as unknown as HistoryEvent;
  }

  const eventOffset = eventIndex - 1;
  const rowIndex =
    run.rowType === 'activity' ? Math.floor(eventOffset / 3) : eventOffset;
  const eventInRow = run.rowType === 'activity' ? eventOffset % 3 : 0;
  const rowSlotMs = (run.endTimeMs - run.startTimeMs) / (run.rowCount + 1);
  const eventTimeMs =
    run.startTimeMs + Math.floor((rowIndex + 1 + eventInRow / 4) * rowSlotMs);
  if (run.rowType === 'activity') {
    const scheduledEventId = 2 + rowIndex * 3;
    if (eventInRow === 0) {
      return {
        ...baseEvent(eventId, eventTimeMs, 'ActivityTaskScheduled'),
        activityTaskScheduledEventAttributes: {
          activityId: `stress-activity-${rowIndex + 1}`,
          activityType: { name: 'TimelineStressActivity' },
          taskQueue: { name: 'timeline-stress', kind: 'Normal' },
          input: null,
          workflowTaskCompletedEventId: '1',
        },
      } as unknown as HistoryEvent;
    }
    if (eventInRow === 1) {
      return {
        ...baseEvent(eventId, eventTimeMs, 'ActivityTaskStarted'),
        activityTaskStartedEventAttributes: {
          scheduledEventId: String(scheduledEventId),
          identity: 'timeline-stress-worker',
          requestId: `stress-request-${rowIndex + 1}`,
          attempt: 1,
          lastFailure: null,
        },
      } as unknown as HistoryEvent;
    }
    return {
      ...baseEvent(eventId, eventTimeMs, 'ActivityTaskCompleted'),
      activityTaskCompletedEventAttributes: {
        result: null,
        scheduledEventId: String(scheduledEventId),
        startedEventId: String(scheduledEventId + 1),
        identity: 'timeline-stress-worker',
      },
    } as unknown as HistoryEvent;
  }
  return {
    ...baseEvent(eventId, eventTimeMs, 'MarkerRecorded'),
    markerRecordedEventAttributes: {
      markerName: 'LocalActivity',
      details: {},
      workflowTaskCompletedEventId: '1',
    },
  } as unknown as HistoryEvent;
};

const boundedInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
};

export const createTimelineStressFixture = ({
  workflowId = 'timeline-stress-chain',
  runCount: requestedRunCount,
  rowsPerRun: requestedRowsPerRun,
  runDurationMs = 60_000,
  startTimeMs = DEFAULT_START_TIME_MS,
  rowType = 'marker',
}: TimelineStressFixtureOptions): TimelineStressFixture => {
  const runCount = boundedInteger(requestedRunCount, 'runCount');
  const rowsPerRun = boundedInteger(requestedRowsPerRun, 'rowsPerRun');
  boundedInteger(runDurationMs, 'runDurationMs');
  const runIds = Array.from(
    { length: runCount },
    (_, index) => `timeline-stress-run-${String(index + 1).padStart(4, '0')}`,
  );
  const runs: TimelineStressRun[] = runIds.map((runId, index) => {
    return {
      index,
      runId,
      startTimeMs: startTimeMs + index * runDurationMs,
      endTimeMs: startTimeMs + (index + 1) * runDurationMs,
      rowCount: rowsPerRun,
      eventCount: rowsPerRun * (rowType === 'activity' ? 3 : 1) + 2,
      rowType,
      nextRunId: runIds[index + 1],
    };
  });
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const firstRunId = runs[0].runId;
  const currentRunId = runs.at(-1)!.runId;

  const requireRun = (runId: string): TimelineStressRun => {
    const run = runById.get(runId);
    if (!run) throw new Error(`Unknown timeline stress run: ${runId}`);
    return run;
  };

  return {
    workflowId,
    firstRunId,
    currentRunId,
    totalRows: runCount * rowsPerRun,
    runs,
    workflowResponse: (runId) => {
      const run = requireRun(runId);
      return {
        ...mockWorkflow,
        executionConfig: {
          ...mockWorkflow.executionConfig,
          taskQueue: {
            ...mockWorkflow.executionConfig.taskQueue,
            name: 'timeline-stress',
          },
        },
        workflowExecutionInfo: {
          ...mockWorkflow.workflowExecutionInfo,
          execution: { workflowId, runId },
          type: { name: 'TimelineStressWorkflow' },
          firstRunId,
          startTime: timestamp(run.startTimeMs),
          executionTime: timestamp(run.startTimeMs),
          closeTime: timestamp(run.endTimeMs),
          status: run.nextRunId ? 'ContinuedAsNew' : 'Completed',
          historyLength: String(run.eventCount),
          historySizeBytes: String(run.eventCount * 160),
        },
        pendingActivities: [],
        pendingChildren: [],
      } as WorkflowExecutionAPIResponse;
    },
    historyPage: (runId, sort, requestedMaximumPageSize, nextPageToken) => {
      const run = requireRun(runId);
      const maximumPageSize = Math.min(
        1_000,
        Math.max(1, Math.floor(requestedMaximumPageSize)),
      );
      const offset = Math.max(0, Number(nextPageToken ?? 0) || 0);
      const end = Math.min(run.eventCount, offset + maximumPageSize);
      const events: HistoryEvent[] = [];
      for (let orderedIndex = offset; orderedIndex < end; orderedIndex += 1) {
        const eventIndex =
          sort === 'ascending'
            ? orderedIndex
            : run.eventCount - orderedIndex - 1;
        events.push(eventAt(run, eventIndex));
      }
      return {
        events,
        nextPageToken: end < run.eventCount ? String(end) : null,
      };
    },
  };
};
