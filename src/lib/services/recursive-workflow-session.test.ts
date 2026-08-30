import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_RECURSIVE_TIMELINE_LIMITS } from '$lib/components/lines-and-dots/timeline-graph/recursive-timeline-model';
import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { TimelineRun } from '$lib/services/chain-workflow-session';
import type { HistoryEvent } from '$lib/types/events';
import type { WorkflowExecution } from '$lib/types/workflows';

import {
  loadChildWorkflow,
  type LoadedChildWorkflow,
} from './child-workflow-loader';
import type { LivePollOptions } from './live-poll';

import { RecursiveWorkflowSession } from './recursive-workflow-session.svelte';

const workflow = (id: string, runId: string): WorkflowExecution =>
  ({
    id,
    runId,
    firstExecutionRunId: runId,
    status: 'Completed',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:01Z',
    executionTime: '2024-01-01T00:00:00Z',
    isRunning: false,
    isPaused: false,
  }) as WorkflowExecution;

const childGroup = (id: number, workflowId = `child-${id}`): EventGroup =>
  ({
    id: String(id),
    initialEvent: { id: String(id) },
    eventList: [
      {
        eventType: 'ChildWorkflowExecutionStarted',
        attributes: {
          workflowExecution: { workflowId, runId: `${workflowId}-run` },
        },
      },
    ],
  }) as EventGroup;

const childGroupWithRun = (
  id: number,
  workflowId: string,
  runId: string,
): EventGroup => {
  const group = childGroup(id, workflowId);
  const event = group.eventList[0] as HistoryEvent & {
    attributes: { workflowExecution: { workflowId: string; runId: string } };
  };
  event.attributes.workflowExecution.runId = runId;
  return group;
};

const rootRun = (groups: EventGroup[]): TimelineRun => ({
  runId: 'root-run',
  status: 'Completed',
  startTimeMs: 0,
  endTimeMs: 1,
  active: false,
  groups: groups.map((group) => ({
    runId: 'root-run',
    timelineKey: `root-run:${group.id}`,
    group,
  })),
});

const loaded = (id: string): LoadedChildWorkflow => ({
  workflow: workflow(id, `${id}-run`),
  run: {
    runId: `${id}-run`,
    status: 'Completed',
    startTimeMs: 0,
    endTimeMs: 1,
    active: false,
    groups: [],
  },
  eventCount: 0,
  groupCount: 0,
});

const running = (id: string): LoadedChildWorkflow => ({
  workflow: {
    ...workflow(id, `${id}-run`),
    status: 'Running',
    endTime: '',
    isRunning: true,
  },
  run: {
    runId: `${id}-run`,
    status: 'Running',
    startTimeMs: 0,
    endTimeMs: 1,
    active: true,
    groups: [],
  },
  eventCount: 0,
  groupCount: 0,
});

describe('RecursiveWorkflowSession', () => {
  it('deduplicates execution loads and never exceeds four workers', async () => {
    const resolvers: (() => void)[] = [];
    let active = 0;
    let maximumActive = 0;
    const loader = vi.fn(
      ({ reference }: Parameters<typeof loadChildWorkflow>[0]) =>
        new Promise<LoadedChildWorkflow>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          resolvers.push(() => {
            active -= 1;
            resolve(loaded(reference.workflowId));
          });
        }),
    );
    const groups = [1, 2, 3, 4, 5, 6].map((id) => childGroup(id));
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun(groups)],
      loader,
    });
    const edgeKeys = [...session.snapshot.childrenByGroupKey.values()].map(
      (edge) => edge.key,
    );

    session.observeEdges(edgeKeys);
    session.syncRoot({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun(groups)],
    });
    expect(loader).toHaveBeenCalledTimes(4);
    resolvers.shift()?.();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(5));
    resolvers.shift()?.();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(6));
    for (const resolve of resolvers) resolve();
    await vi.waitFor(() => expect(session.requestCount).toBe(0));
    expect(maximumActive).toBe(4);
    expect(
      [...session.snapshot.childrenByGroupKey.values()].every(
        (edge) => edge.load.state === 'loaded',
      ),
    ).toBe(true);
    session.dispose();
  });

  it('shares one request for duplicate child execution references', async () => {
    const loader = vi.fn().mockResolvedValue(loaded('same'));
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([childGroup(1, 'same'), childGroup(2, 'same')])],
      loader,
    });
    session.observeEdges(
      [...session.snapshot.childrenByGroupKey.values()].map((edge) => edge.key),
    );
    await vi.waitFor(() => expect(session.requestCount).toBe(0));
    expect(loader).toHaveBeenCalledOnce();
    expect(
      [...session.snapshot.childrenByGroupKey.values()].every(
        (edge) => edge.load.state === 'loaded',
      ),
    ).toBe(true);
    session.dispose();
  });

  it('aborts outstanding child work on disposal', () => {
    let signal: AbortSignal | undefined;
    const loader = vi.fn(
      ({ signal: nextSignal }) =>
        new Promise<LoadedChildWorkflow>(() => {
          signal = nextSignal;
        }),
    );
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([childGroup(1)])],
      loader,
    });
    const edge = [...session.snapshot.childrenByGroupKey.values()][0];
    session.observeEdges([edge.key]);
    session.dispose();
    expect(signal?.aborted).toBe(true);
    expect(edge.load.state).toBe('idle');
  });

  it('loads a known Continue-As-New successor immediately', async () => {
    const first = loaded('child-1');
    first.run.successorRunId = 'child-1-successor';
    const successor = loaded('child-1');
    successor.workflow.runId = 'child-1-successor';
    successor.workflow.firstExecutionRunId = 'child-1-run';
    successor.run.runId = 'child-1-successor';
    successor.run.startTimeMs = 2;
    successor.run.endTimeMs = 3;
    const loader = vi.fn(
      ({ reference }: Parameters<typeof loadChildWorkflow>[0]) =>
        Promise.resolve(reference.runId === 'child-1-run' ? first : successor),
    );
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([childGroup(1)])],
      loader,
    });
    const edge = [...session.snapshot.childrenByGroupKey.values()][0];

    session.observeEdges([edge.key]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(session.requestCount).toBe(0));

    expect(edge.load.state).toBe('loaded');
    if (edge.load.state === 'loaded') {
      expect(edge.load.node.runs.map((run) => run.runId)).toEqual([
        'child-1-run',
        'child-1-successor',
      ]);
    }
    session.dispose();
  });

  it('long-polls every expanded running child and refreshes new events', async () => {
    const pollOptions: LivePollOptions[] = [];
    const livePoller = vi.fn(
      (options: LivePollOptions) =>
        new Promise<string>((resolve) => {
          pollOptions.push(options);
          options.signal.addEventListener('abort', () => resolve(''), {
            once: true,
          });
        }),
    );
    let loads = 0;
    const loader = vi.fn(
      ({ reference }: Parameters<typeof loadChildWorkflow>[0]) => {
        loads += 1;
        return Promise.resolve(
          loads <= 6
            ? running(reference.workflowId)
            : loaded(reference.workflowId),
        );
      },
    );
    const groups = [1, 2, 3, 4, 5, 6].map((id) => childGroup(id));
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun(groups)],
      loader,
      livePoller,
    });
    const edges = [...session.snapshot.childrenByGroupKey.values()];

    session.observeEdges(edges.map((edge) => edge.key));
    await vi.waitFor(() => expect(livePoller).toHaveBeenCalledTimes(6));

    expect(pollOptions.every(({ route }) => route.includes('/history'))).toBe(
      true,
    );
    expect(pollOptions.map(({ runId }) => runId)).toEqual(
      groups.map((_, index) => `child-${index + 1}-run`),
    );

    expect(pollOptions[0].onEvent({ eventId: '99' } as HistoryEvent)).toBe(
      true,
    );
    pollOptions[0].onNewEvents();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(7));
    await vi.waitFor(() => expect(session.requestCount).toBe(0));

    const firstEdge = edges[0];
    expect(firstEdge.load.state).toBe('loaded');
    if (firstEdge.load.state === 'loaded') {
      expect(firstEdge.load.node.runs).toHaveLength(1);
      expect(firstEdge.load.node.runs[0].status).toBe('Completed');
    }
    expect(pollOptions[0].signal.aborted).toBe(true);
    session.dispose();
  });

  it('preserves loaded descendant state when a parent refreshes', async () => {
    const pollOptions: LivePollOptions[] = [];
    const livePoller = vi.fn(
      (options: LivePollOptions) =>
        new Promise<string>((resolve) => {
          pollOptions.push(options);
          options.signal.addEventListener('abort', () => resolve(''), {
            once: true,
          });
        }),
    );
    const parentGroup = childGroup(1, 'parent');
    const grandchildGroup = childGroup(2, 'grandchild');
    const parentResult = running('parent');
    parentResult.run.groups = [
      {
        runId: parentResult.run.runId,
        timelineKey: `${parentResult.run.runId}:${grandchildGroup.id}`,
        group: grandchildGroup,
      },
    ];
    const loader = vi.fn(
      ({ reference }: Parameters<typeof loadChildWorkflow>[0]) =>
        Promise.resolve(
          reference.workflowId === 'parent'
            ? structuredClone(parentResult)
            : loaded(reference.workflowId),
        ),
    );
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([parentGroup])],
      loader,
      livePoller,
    });
    const parentEdge = [...session.snapshot.childrenByGroupKey.values()][0];

    session.observeEdges([parentEdge.key]);
    await vi.waitFor(() => expect(parentEdge.load.state).toBe('loaded'));
    if (parentEdge.load.state !== 'loaded')
      throw new Error('parent not loaded');
    const parentNode = parentEdge.load.node;
    const grandchildEdge = [...parentNode.childrenByGroupKey.values()][0];
    session.observeEdges([grandchildEdge.key]);
    await vi.waitFor(() => expect(grandchildEdge.load.state).toBe('loaded'));
    session.toggle(grandchildEdge.key);
    expect(grandchildEdge.expansion).toBe('collapsed');

    const parentPoll = pollOptions.find(
      ({ runId }) => runId === parentResult.run.runId,
    );
    parentPoll?.onNewEvents();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(session.requestCount).toBe(0));

    expect(parentEdge.load.state).toBe('loaded');
    if (parentEdge.load.state === 'loaded') {
      expect(parentEdge.load.node).toBe(parentNode);
      expect([...parentEdge.load.node.childrenByGroupKey.values()][0]).toBe(
        grandchildEdge,
      );
    }
    expect(grandchildEdge.expansion).toBe('collapsed');
    expect(grandchildEdge.load.state).toBe('loaded');
    expect(livePoller).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('keeps a shared node cached until its last loaded edge is evicted', async () => {
    const loader = vi.fn().mockResolvedValue(loaded('same'));
    const initialGroups = [childGroup(1, 'same'), childGroup(2, 'same')];
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun(initialGroups)],
      loader,
    });
    const edges = [...session.snapshot.childrenByGroupKey.values()];
    session.observeEdges(edges.map((edge) => edge.key));
    await vi.waitFor(() => expect(session.requestCount).toBe(0));

    session.evict(edges[0].key);
    const nextGroups = [...initialGroups, childGroup(3, 'same')];
    session.syncRoot({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun(nextGroups)],
    });
    const nextEdge = [...session.snapshot.childrenByGroupKey.values()][2];
    session.observeEdges([nextEdge.key]);

    expect(nextEdge.load.state).toBe('loaded');
    expect(loader).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('drops stale Continue-As-New aliases outside run retention', async () => {
    const successorByRun = new Map([
      ['chain-1', 'chain-2'],
      ['chain-2', 'chain-3'],
      ['chain-3', 'chain-4'],
    ]);
    const loader = vi.fn(
      ({ reference }: Parameters<typeof loadChildWorkflow>[0]) => {
        const result = loaded('chain');
        result.workflow.runId = reference.runId;
        result.workflow.firstExecutionRunId = 'chain-1';
        result.run.runId = reference.runId;
        result.run.startTimeMs = Number(reference.runId.at(-1));
        result.run.endTimeMs = result.run.startTimeMs + 1;
        result.run.successorRunId = successorByRun.get(reference.runId);
        return Promise.resolve(result);
      },
    );
    const initial = childGroupWithRun(1, 'chain', 'chain-1');
    const session = new RecursiveWorkflowSession({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([initial])],
      limits: { ...DEFAULT_RECURSIVE_TIMELINE_LIMITS, maximumRunsPerNode: 2 },
      loader,
    });
    const firstEdge = [...session.snapshot.childrenByGroupKey.values()][0];
    session.observeEdges([firstEdge.key]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(session.requestCount).toBe(0));

    const staleAlias = childGroupWithRun(2, 'chain', 'chain-2');
    session.syncRoot({
      namespace: 'default',
      workflow: workflow('root', 'root-run'),
      runs: [rootRun([initial, staleAlias])],
    });
    const staleEdge = [...session.snapshot.childrenByGroupKey.values()][1];
    session.observeEdges([staleEdge.key]);

    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(5));
    session.dispose();
  });
});
