import { describe, expect, it, vi } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { WorkflowEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import {
  type ActiveRunState,
  type ChainWorkflowSession,
  commitActiveRun,
  createRunRuntime,
  getChainRetentionWindow,
  getPredecessorFromEvents,
  getSuccessorFromEvents,
  isCurrentRun,
  limitRetainedRuns,
  pruneRetainedRuns,
  retainRunsWithinWindow,
  timelineKey,
  toTimelineGroups,
} from './chain-workflow-session';

const workflow = (runId: string): WorkflowExecution =>
  ({ runId, id: 'workflow-id' }) as WorkflowExecution;

const active = (runId: string): ActiveRunState => ({
  runId,
  workflow: workflow(runId),
  fetch: {
    fetchComplete: false,
    latestEventId: 0,
    totalExpectedEvents: 0,
    descMinId: 0,
  },
  runtime: createRunRuntime(),
});

const session = (): ChainWorkflowSession => ({
  namespace: 'default',
  workflowId: 'workflow-id',
  firstRunId: 'run-1',
  following: true,
  generation: 1,
  active: active('run-1'),
  retainedRuns: [],
  viewport: {
    widthPx: 0,
    offsetPx: 0,
    expandedDurationPerViewportMs: 0,
    overscanViewports: 1,
    followingLiveEdge: true,
    hasMeasuredGeometry: false,
  },
  truncation: null,
});

const event = (id: string, timeMs: number): WorkflowEvent =>
  ({ id, eventTime: new Date(timeMs).toISOString() }) as WorkflowEvent;

const group = (
  id: string,
  startTimeMs: number,
  endTimeMs: number,
  eventCount = 2,
): EventGroup => {
  const events = Array.from({ length: eventCount }, (_, index) =>
    event(
      String(Number(id) + index),
      index === eventCount - 1 ? endTimeMs : startTimeMs,
    ),
  );
  return {
    id,
    initialEvent: events[0],
    lastEvent: events.at(-1),
    eventList: events,
  } as EventGroup;
};

const retainedRun = (
  runId: string,
  startTimeMs: number,
  endTimeMs: number,
  groups: EventGroup[],
) => ({
  runId,
  status: 'ContinuedAsNew' as const,
  startTimeMs,
  endTimeMs,
  groups: toTimelineGroups(runId, groups),
});

describe('chain workflow session', () => {
  it('namespaces timeline identities by run without changing group ids', () => {
    const group = { id: '12' } as EventGroup;
    const [wrapped] = toTimelineGroups('run-2', [group]);

    expect(wrapped.timelineKey).toBe(timelineKey('run-2', '12'));
    expect(wrapped.group).toBe(group);
    expect(group.id).toBe('12');
  });

  it('commits only for the current generation and source run', () => {
    const state = session();
    const oldRuntime = state.active.runtime;
    const next = active('run-2');

    expect(
      commitActiveRun({
        session: state,
        expectedGeneration: 1,
        sourceRunId: 'run-1',
        next,
      }),
    ).toBe(true);
    expect(oldRuntime.disposed).toBe(true);
    expect(state.active).toBe(next);
    expect(state.generation).toBe(2);
    expect(isCurrentRun(state, 2, 'run-2')).toBe(true);

    const stale = active('run-3');
    expect(
      commitActiveRun({
        session: state,
        expectedGeneration: 1,
        sourceRunId: 'run-1',
        next: stale,
      }),
    ).toBe(false);
    expect(stale.runtime.disposed).toBe(true);
    expect(state.active).toBe(next);
  });

  it('disposes all run-owned resources and releases a paused fetch', () => {
    vi.useFakeTimers();
    const runtime = createRunRuntime();
    const livePoll = new AbortController();
    const resume = vi.fn();
    runtime.livePollController = livePoll;
    runtime.pauseHandle = { resume };
    runtime.retryTimer = setTimeout(() => undefined, 1000);
    runtime.stagingSuccessorRunId = 'run-2';

    runtime.dispose();

    expect(runtime.historyController.signal.aborted).toBe(true);
    expect(livePoll.signal.aborted).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    expect(runtime.retryTimer).toBeNull();
    expect(runtime.stagingSuccessorRunId).toBeUndefined();
    runtime.dispose();
    expect(resume).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('extracts a validated continue-as-new link', () => {
    const event = {
      eventType: 'WorkflowExecutionContinuedAsNew',
      eventTime: '2026-01-01T00:00:00Z',
      attributes: { newExecutionRunId: 'run-2' },
    } as WorkflowEvent;

    expect(getSuccessorFromEvents([event])).toEqual({
      runId: 'run-2',
      transition: 'continue-as-new',
      timeMs: Date.parse('2026-01-01T00:00:00Z'),
    });
  });

  it('extracts a predecessor from started-event metadata', () => {
    expect(
      getPredecessorFromEvents([
        {
          eventType: 'WorkflowExecutionStarted',
          attributes: { continuedExecutionRunId: 'run-1' },
        } as WorkflowEvent,
      ]),
    ).toBe('run-1');
  });

  it('prunes oldest runs at configurable hard limits', () => {
    const state = session();
    const group = { id: '1', eventList: [{}, {}] } as EventGroup;
    state.retainedRuns = ['run-1', 'run-2'].map((runId, index) => ({
      runId,
      status: 'ContinuedAsNew',
      startTimeMs: index,
      endTimeMs: index + 1,
      groups: toTimelineGroups(runId, [group]),
    }));

    pruneRetainedRuns(state, {
      completedRuns: 1,
      completedGroups: 10,
      completedEvents: 10,
      hopsPerCycle: 1,
    });

    expect(state.retainedRuns.map((run) => run.runId)).toEqual(['run-2']);
    expect(state.truncation?.reason).toBe('run-limit');
  });

  it('derives the retained time window from viewport geometry and overscan', () => {
    const state = session();
    state.viewport = {
      widthPx: 200,
      offsetPx: 500,
      expandedDurationPerViewportMs: 60_000,
      overscanViewports: 1.5,
      followingLiveEdge: false,
      hasMeasuredGeometry: true,
    };

    expect(
      getChainRetentionWindow({
        viewport: state.viewport,
        unprojectWorldPx: (worldPx) => worldPx * 10,
      }),
    ).toEqual({
      oldestRetainedTimeMs: 2_000,
      visibleStartTimeMs: 5_000,
      visibleEndTimeMs: 7_000,
    });
  });

  it('does not derive a viewport window before geometry is measured', () => {
    const state = session();
    expect(
      getChainRetentionWindow({
        viewport: state.viewport,
        unprojectWorldPx: (worldPx) => worldPx,
      }),
    ).toBeNull();
  });

  it('prunes completed groups before the time boundary and retains crossing groups', () => {
    const crossing = group('1', 100, 350);
    const expired = group('3', 100, 250);
    const runs = [
      retainedRun('expired-run', 0, 250, [expired]),
      retainedRun('crossing-run', 100, 400, [expired, crossing]),
    ];

    const result = retainRunsWithinWindow(runs, {
      oldestRetainedTimeMs: 300,
      visibleStartTimeMs: 400,
      visibleEndTimeMs: 600,
    });

    expect(result.map((run) => run.runId)).toEqual(['crossing-run']);
    expect(result[0].groups.map((item) => item.group)).toEqual([crossing]);
    expect(result[0].groups[0].group).toBe(crossing);
    expect(runs[1].groups).toHaveLength(2);
  });

  it('drops overscan groups before visible groups at the group hard limit', () => {
    const overscan = group('1', 100, 200);
    const visible = group('3', 450, 550);
    const result = limitRetainedRuns(
      [retainedRun('run-1', 0, 600, [visible, overscan])],
      {
        completedRuns: 10,
        completedGroups: 1,
        completedEvents: 10,
        hopsPerCycle: 1,
      },
      {
        oldestRetainedTimeMs: 0,
        visibleStartTimeMs: 400,
        visibleEndTimeMs: 600,
      },
    );

    expect(result.runs[0].groups.map((item) => item.group)).toEqual([visible]);
    expect(result.truncation).toEqual({
      beforeTimeMs: 200,
      reason: 'group-limit',
      affectsVisibleInterval: false,
    });
  });

  it('reports the event limit that caused pruning and marks visible truncation', () => {
    const visible = group('1', 450, 550, 4);
    const result = limitRetainedRuns(
      [retainedRun('run-1', 400, 600, [visible])],
      {
        completedRuns: 10,
        completedGroups: 10,
        completedEvents: 2,
        hopsPerCycle: 1,
      },
      {
        oldestRetainedTimeMs: 0,
        visibleStartTimeMs: 400,
        visibleEndTimeMs: 600,
      },
    );

    expect(result.runs[0].groups).toEqual([]);
    expect(result.truncation).toEqual({
      beforeTimeMs: 550,
      reason: 'event-limit',
      affectsVisibleInterval: true,
    });
  });

  it('does not clear an existing hard-limit truncation during time pruning', () => {
    const state = session();
    state.retainedRuns = [retainedRun('run-1', 0, 100, [group('1', 0, 100)])];
    state.truncation = {
      beforeTimeMs: 50,
      reason: 'event-limit',
      affectsVisibleInterval: true,
    };

    pruneRetainedRuns(
      state,
      {
        completedRuns: 10,
        completedGroups: 10,
        completedEvents: 10,
        hopsPerCycle: 1,
      },
      {
        oldestRetainedTimeMs: 200,
        visibleStartTimeMs: 300,
        visibleEndTimeMs: 500,
      },
    );

    expect(state.retainedRuns).toEqual([]);
    expect(state.truncation).toEqual({
      beforeTimeMs: 50,
      reason: 'event-limit',
      affectsVisibleInterval: true,
    });
  });
});
