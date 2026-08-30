import { SvelteMap, SvelteSet } from 'svelte/reactivity';

import {
  childEdgeKey,
  childExecutionKey,
  countNodeData,
  DEFAULT_RECURSIVE_TIMELINE_LIMITS,
  executionKey,
  type RecursiveTimelineLimits,
  type TimelineChildEdge,
  type TimelineWorkflowNode,
} from '$lib/components/lines-and-dots/timeline-graph/recursive-timeline-model';
import { getChildWorkflowReference } from '$lib/components/lines-and-dots/timeline-graph/timeline-child-reference';
import {
  getSuccessorFromEvents,
  type TimelineRun,
} from '$lib/services/chain-workflow-session';
import type { WorkflowExecution } from '$lib/types/workflows';
import { routeForApi } from '$lib/utilities/route-for-api';

import {
  ChildWorkflowLoadError,
  loadChildWorkflow,
  type LoadedChildWorkflow,
} from './child-workflow-loader';
import { runLivePoll } from './live-poll';

type Loader = typeof loadChildWorkflow;
type LivePoller = typeof runLivePoll;

type Reservation = {
  nodes: number;
  runs: number;
  groups: number;
  events: number;
};

type QueueTask = {
  key: string;
  reference: TimelineChildEdge['reference'];
  edges: Set<TimelineChildEdge>;
  reservation: Reservation;
  controller: AbortController;
  loadLimits: { maximumEvents: number; maximumGroups: number };
  refresh: boolean;
  previousNode?: TimelineWorkflowNode;
  mergePreviousRuns?: boolean;
  awaitingReservation?: boolean;
};

const emptyReservation = (): Reservation => ({
  nodes: 0,
  runs: 0,
  groups: 0,
  events: 0,
});

export class RecursiveWorkflowSession {
  private revision = $state(0);
  private rootNode: TimelineWorkflowNode;
  private readonly limits: RecursiveTimelineLimits;
  private readonly loader: Loader;
  private readonly queued: QueueTask[] = [];
  private readonly tasksByExecutionKey = new SvelteMap<string, QueueTask>();
  private readonly loadedByExecutionKey = new SvelteMap<
    string,
    TimelineWorkflowNode
  >();
  private retained: Reservation = emptyReservation();
  private reserved: Reservation = emptyReservation();
  private activeRequests = 0;
  private disposed = false;
  private paused = false;
  private readonly livePoller: LivePoller;
  private readonly livePollsByExecutionKey = new SvelteMap<
    string,
    { controller: AbortController; edges: Set<TimelineChildEdge> }
  >();

  constructor({
    namespace,
    workflow,
    runs,
    limits = DEFAULT_RECURSIVE_TIMELINE_LIMITS,
    loader = loadChildWorkflow,
    livePoller = runLivePoll,
  }: {
    namespace: string;
    workflow: WorkflowExecution;
    runs: TimelineRun[];
    limits?: RecursiveTimelineLimits;
    loader?: Loader;
    livePoller?: LivePoller;
  }) {
    this.limits = limits;
    this.loader = loader;
    this.livePoller = livePoller;
    this.rootNode = this.createNode({ namespace, workflow, runs, depth: 0 });
  }

  get snapshot(): TimelineWorkflowNode {
    void this.revision;
    return { ...this.rootNode };
  }

  get requestCount(): number {
    void this.revision;
    return this.activeRequests;
  }

  syncRoot({
    namespace,
    workflow,
    runs,
  }: {
    namespace: string;
    workflow: WorkflowExecution;
    runs: TimelineRun[];
  }): void {
    if (this.disposed) return;
    const nextKey = executionKey({
      namespace,
      workflowId: workflow.id,
      firstRunId: workflow.firstExecutionRunId ?? workflow.runId,
    });
    if (nextKey !== this.rootNode.key) {
      this.dispose();
      return;
    }
    this.rootNode.workflow = workflow;
    this.rootNode.runs = runs;
    this.discoverEdges(this.rootNode);
    this.changed();
  }

  observeEdges(edgeKeys: Iterable<string>): void {
    if (this.disposed) return;
    const now = Date.now();
    let changed = false;
    for (const key of edgeKeys) {
      const found = this.findEdge(key);
      if (!found) continue;
      found.edge.lastVisibleAt = now;
      if (
        found.edge.expansion === 'expanded' &&
        (found.edge.load.state === 'idle' ||
          found.edge.load.state === 'evicted')
      ) {
        this.enqueue(found.edge, found.ancestry);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  toggle(edgeKey: string): void {
    const found = this.findEdge(edgeKey);
    if (!found) return;
    found.edge.expansion =
      found.edge.expansion === 'expanded' ? 'collapsed' : 'expanded';
    if (
      found.edge.expansion === 'expanded' &&
      (found.edge.load.state === 'idle' || found.edge.load.state === 'evicted')
    ) {
      this.enqueue(found.edge, found.ancestry);
    }
    this.changed();
  }

  retry(edgeKey: string): void {
    const found = this.findEdge(edgeKey);
    if (!found || found.edge.load.state === 'loading') return;
    found.edge.load = { state: 'idle' };
    found.edge.expansion = 'expanded';
    this.enqueue(found.edge, found.ancestry);
    this.changed();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      for (const task of this.tasksByExecutionKey.values()) {
        if (task.refresh) task.controller.abort();
      }
    }
    this.changed();
  }

  evict(edgeKey: string): void {
    const found = this.findEdge(edgeKey);
    if (!found || found.edge.load.state !== 'loaded') return;
    const data = countNodeData(found.edge.load.node);
    this.retained.nodes = Math.max(0, this.retained.nodes - 1);
    this.retained.runs = Math.max(0, this.retained.runs - data.runs);
    this.retained.groups = Math.max(0, this.retained.groups - data.groups);
    this.retained.events = Math.max(0, this.retained.events - data.events);
    this.loadedByExecutionKey.delete(childExecutionKey(found.edge.reference));
    found.edge.load = { state: 'evicted' };
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const poll of this.livePollsByExecutionKey.values()) {
      poll.controller.abort();
    }
    this.livePollsByExecutionKey.clear();
    for (const task of this.tasksByExecutionKey.values()) {
      task.controller.abort();
      for (const edge of task.edges) {
        if (edge.load.state === 'loading') edge.load = { state: 'idle' };
      }
    }
    this.queued.length = 0;
    this.tasksByExecutionKey.clear();
    this.reserved = emptyReservation();
    this.changed();
  }

  private createNode({
    namespace,
    workflow,
    runs,
    depth,
  }: {
    namespace: string;
    workflow: WorkflowExecution;
    runs: TimelineRun[];
    depth: number;
  }): TimelineWorkflowNode {
    const node: TimelineWorkflowNode = {
      key: executionKey({
        namespace,
        workflowId: workflow.id,
        firstRunId: workflow.firstExecutionRunId ?? workflow.runId,
      }),
      namespace,
      workflowId: workflow.id,
      firstRunId: workflow.firstExecutionRunId ?? workflow.runId,
      workflow,
      runs,
      childrenByGroupKey: new SvelteMap(),
      depth,
    };
    this.discoverEdges(node);
    return node;
  }

  private discoverEdges(node: TimelineWorkflowNode): void {
    const previous = node.childrenByGroupKey;
    const next = new SvelteMap<string, TimelineChildEdge>();
    for (const run of node.runs) {
      for (const entry of run.groups) {
        const reference = getChildWorkflowReference(
          entry.group,
          node.namespace,
        );
        if (!reference) continue;
        const prior = previous.get(entry.timelineKey);
        next.set(
          entry.timelineKey,
          prior ?? {
            key: childEdgeKey({
              parentExecutionKey: node.key,
              parentGroupKey: entry.timelineKey,
              childExecutionKey: childExecutionKey(reference),
            }),
            parentGroupKey: entry.timelineKey,
            reference,
            expansion: 'expanded',
            load: { state: 'idle' },
            depth: node.depth + 1,
            lastVisibleAt: 0,
          },
        );
      }
    }
    node.childrenByGroupKey = next;
  }

  private findEdge(
    key: string,
  ): { edge: TimelineChildEdge; ancestry: string[] } | null {
    const visit = (
      node: TimelineWorkflowNode,
      ancestry: string[],
    ): { edge: TimelineChildEdge; ancestry: string[] } | null => {
      for (const edge of node.childrenByGroupKey.values()) {
        if (edge.key === key)
          return { edge, ancestry: [...ancestry, node.key] };
        if (edge.load.state === 'loaded') {
          const found = visit(edge.load.node, [...ancestry, node.key]);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(this.rootNode, []);
  }

  private enqueue(edge: TimelineChildEdge, ancestry: string[]): void {
    const targetKey = childExecutionKey(edge.reference);
    if (ancestry.includes(targetKey)) {
      edge.load = { state: 'truncated', truncation: { reason: 'cycle' } };
      return;
    }
    if (edge.depth > this.limits.maximumDepth) {
      edge.load = {
        state: 'truncated',
        truncation: { reason: 'depth-limit' },
      };
      return;
    }
    const loaded = this.loadedByExecutionKey.get(targetKey);
    if (loaded) {
      edge.load = { state: 'loaded', node: loaded };
      return;
    }
    const existing = this.tasksByExecutionKey.get(targetKey);
    if (existing) {
      existing.edges.add(edge);
      edge.load = { state: 'loading', requestKey: targetKey };
      return;
    }

    let reservation = this.reserve();
    const canWaitForCapacity =
      !reservation &&
      this.activeRequests >= this.limits.maximumConcurrentRequests &&
      this.retained.nodes +
        this.reserved.nodes +
        this.queued.filter((task) => task.awaitingReservation).length <
        this.limits.maximumNodes - 1;
    if (!reservation && !canWaitForCapacity) {
      edge.load = {
        state: 'truncated',
        truncation: { reason: this.limitReason() },
      };
      return;
    }
    reservation ??= emptyReservation();
    const task: QueueTask = {
      key: targetKey,
      reference: edge.reference,
      edges: new SvelteSet([edge]),
      reservation,
      controller: new AbortController(),
      loadLimits: {
        maximumEvents: reservation.events,
        maximumGroups: reservation.groups,
      },
      refresh: false,
      awaitingReservation: canWaitForCapacity,
    };
    edge.load = { state: 'loading', requestKey: targetKey };
    this.tasksByExecutionKey.set(targetKey, task);
    this.queued.push(task);
    this.drain();
  }

  private reserve(): Reservation | null {
    const available = {
      nodes:
        this.limits.maximumNodes -
        1 -
        this.retained.nodes -
        this.reserved.nodes,
      runs:
        this.limits.maximumDescendantRuns -
        this.retained.runs -
        this.reserved.runs,
      groups:
        this.limits.maximumDescendantGroups -
        this.retained.groups -
        this.reserved.groups,
      events:
        this.limits.maximumDescendantEvents -
        this.retained.events -
        this.reserved.events,
    };
    if (
      available.nodes < 1 ||
      available.runs < 1 ||
      available.groups < 1 ||
      available.events < 1
    ) {
      return null;
    }
    const reservation = {
      nodes: 1,
      runs: Math.min(this.limits.maximumRunsPerNode, available.runs),
      groups: Math.min(this.limits.maximumGroupsPerNode, available.groups),
      events: Math.min(this.limits.maximumEventsPerNode, available.events),
    };
    this.add(this.reserved, reservation);
    return reservation;
  }

  private limitReason():
    | 'node-limit'
    | 'run-limit'
    | 'group-limit'
    | 'event-limit' {
    if (
      this.retained.nodes + this.reserved.nodes >=
      this.limits.maximumNodes - 1
    )
      return 'node-limit';
    if (
      this.retained.runs + this.reserved.runs >=
      this.limits.maximumDescendantRuns
    )
      return 'run-limit';
    if (
      this.retained.groups + this.reserved.groups >=
      this.limits.maximumDescendantGroups
    )
      return 'group-limit';
    return 'event-limit';
  }

  private drain(): void {
    while (
      !this.disposed &&
      this.activeRequests < this.limits.maximumConcurrentRequests &&
      this.queued.length
    ) {
      const task = this.queued[0];
      if (!task) return;
      if (task.awaitingReservation) {
        const reservation = this.reserve();
        if (!reservation) return;
        task.reservation = reservation;
        task.loadLimits = {
          maximumEvents: reservation.events,
          maximumGroups: reservation.groups,
        };
        task.awaitingReservation = false;
      }
      this.queued.shift();
      this.activeRequests += 1;
      void this.runTask(task);
    }
    this.changed();
  }

  private async runTask(task: QueueTask): Promise<void> {
    let committed = false;
    try {
      const result = await this.loader({
        reference: task.reference,
        signal: task.controller.signal,
        limits: {
          maximumEvents: task.loadLimits.maximumEvents,
          maximumGroups: task.loadLimits.maximumGroups,
        },
      });
      if (this.disposed || task.controller.signal.aborted) return;
      this.commitLoaded(task, result);
      committed = true;
    } catch (error) {
      if (this.disposed || task.controller.signal.aborted) return;
      const classified =
        error instanceof ChildWorkflowLoadError
          ? error
          : new ChildWorkflowLoadError(
              'network',
              error instanceof Error
                ? error.message
                : 'Unable to load child workflow',
            );
      if (!task.refresh) {
        for (const edge of task.edges) {
          edge.load = {
            state: 'error',
            kind: classified.kind,
            reason: classified.message,
            retryable: classified.retryable,
          };
        }
      }
    } finally {
      this.subtract(this.reserved, task.reservation);
      this.tasksByExecutionKey.delete(task.key);
      this.activeRequests -= 1;
      if (committed) this.enqueueKnownSuccessors(task);
      this.changed();
      this.drain();
    }
  }

  private commitLoaded(task: QueueTask, result: LoadedChildWorkflow): void {
    if (task.previousNode) {
      const previous = countNodeData(task.previousNode);
      this.retained.nodes = Math.max(0, this.retained.nodes - 1);
      this.retained.runs = Math.max(0, this.retained.runs - previous.runs);
      this.retained.groups = Math.max(
        0,
        this.retained.groups - previous.groups,
      );
      this.retained.events = Math.max(
        0,
        this.retained.events - previous.events,
      );
    }
    const mergedRuns = task.previousNode
      ? task.mergePreviousRuns
        ? [...task.previousNode.runs, result.run]
        : task.previousNode.runs.some((run) => run.runId === result.run.runId)
          ? task.previousNode.runs.map((run) =>
              run.runId === result.run.runId ? result.run : run,
            )
          : [...task.previousNode.runs, result.run]
      : [result.run];
    const runTruncated = mergedRuns.length > this.limits.maximumRunsPerNode;
    const node = this.createNode({
      namespace: task.reference.namespace,
      workflow: result.workflow,
      runs: mergedRuns.slice(-this.limits.maximumRunsPerNode),
      depth: Math.min(...[...task.edges].map((edge) => edge.depth)),
    });
    this.loadedByExecutionKey.set(task.key, node);
    for (const edge of task.edges) {
      this.loadedByExecutionKey.set(childExecutionKey(edge.reference), node);
    }
    const data = countNodeData(node);
    this.add(this.retained, { nodes: 1, ...data });
    for (const edge of task.edges) {
      edge.load = {
        state: 'loaded',
        node,
        truncation: runTruncated ? { reason: 'run-limit' } : result.truncation,
      };
    }
  }

  private enqueueKnownSuccessors(task: QueueTask): void {
    for (const edge of task.edges) {
      if (edge.expansion !== 'expanded' || edge.load.state !== 'loaded') {
        continue;
      }
      const child = edge.load.node;
      const finalRun = [...child.runs]
        .sort((a, b) => a.startTimeMs - b.startTimeMs)
        .at(-1);
      const successorRunId =
        finalRun?.successorRunId ??
        (finalRun
          ? getSuccessorFromEvents(
              finalRun.groups.flatMap((entry) => entry.group.eventList),
            )?.runId
          : undefined);
      if (
        successorRunId &&
        !child.runs.some((run) => run.runId === successorRunId)
      ) {
        this.enqueueRefresh(
          edge,
          child,
          { ...edge.reference, runId: successorRunId },
          true,
        );
      }
    }
  }

  private enqueueRefresh(
    edge: TimelineChildEdge,
    previousNode: TimelineWorkflowNode,
    reference: TimelineChildEdge['reference'],
    mergePreviousRuns = false,
  ): void {
    const key = childExecutionKey(reference);
    const existing = this.tasksByExecutionKey.get(key);
    if (existing) {
      existing.edges.add(edge);
      return;
    }
    const previous = countNodeData(previousNode);
    const maximumEvents = Math.min(
      this.limits.maximumEventsPerNode,
      this.limits.maximumDescendantEvents -
        this.retained.events -
        this.reserved.events +
        previous.events,
    );
    const maximumGroups = Math.min(
      this.limits.maximumGroupsPerNode,
      this.limits.maximumDescendantGroups -
        this.retained.groups -
        this.reserved.groups +
        previous.groups,
    );
    if (maximumEvents < 1 || maximumGroups < 1) return;
    const reservation: Reservation = {
      nodes: 0,
      runs: 0,
      groups: Math.max(0, maximumGroups - previous.groups),
      events: Math.max(0, maximumEvents - previous.events),
    };
    this.add(this.reserved, reservation);
    const task: QueueTask = {
      key,
      reference,
      edges: new SvelteSet([edge]),
      reservation,
      controller: new AbortController(),
      loadLimits: { maximumEvents, maximumGroups },
      refresh: true,
      previousNode,
      mergePreviousRuns,
    };
    this.tasksByExecutionKey.set(key, task);
    this.queued.push(task);
    this.drain();
  }

  private reconcileLivePolls(): void {
    if (this.disposed || this.paused) {
      for (const [key, poll] of this.livePollsByExecutionKey) {
        this.livePollsByExecutionKey.delete(key);
        poll.controller.abort();
      }
      return;
    }

    const desired = new SvelteMap<
      string,
      {
        reference: TimelineChildEdge['reference'];
        run: TimelineRun;
        edges: Set<TimelineChildEdge>;
      }
    >();
    const visit = (node: TimelineWorkflowNode): void => {
      for (const edge of node.childrenByGroupKey.values()) {
        if (edge.expansion !== 'expanded' || edge.load.state !== 'loaded') {
          continue;
        }
        const child = edge.load.node;
        const finalRun = [...child.runs]
          .sort((a, b) => a.startTimeMs - b.startTimeMs)
          .at(-1);
        if (
          finalRun?.active &&
          (finalRun.status === 'Running' || finalRun.status === 'Paused')
        ) {
          const reference = { ...edge.reference, runId: finalRun.runId };
          const key = childExecutionKey(reference);
          const existing = desired.get(key);
          if (existing) {
            existing.edges.add(edge);
          } else {
            desired.set(key, {
              reference,
              run: finalRun,
              edges: new SvelteSet([edge]),
            });
          }
        }
        visit(child);
      }
    };
    visit(this.rootNode);

    for (const [key, poll] of this.livePollsByExecutionKey) {
      const target = desired.get(key);
      if (target) {
        poll.edges.clear();
        for (const edge of target.edges) poll.edges.add(edge);
        continue;
      }
      this.livePollsByExecutionKey.delete(key);
      poll.controller.abort();
    }

    for (const [key, target] of desired) {
      if (this.livePollsByExecutionKey.has(key)) continue;
      this.startChildLivePoll(key, target);
    }
  }

  private startChildLivePoll(
    key: string,
    target: {
      reference: TimelineChildEdge['reference'];
      run: TimelineRun;
      edges: Set<TimelineChildEdge>;
    },
  ): void {
    const controller = new AbortController();
    const seenEventIds = new SvelteSet(
      target.run.groups.flatMap((entry) =>
        entry.group.eventList.map((event) => event.id),
      ),
    );
    this.livePollsByExecutionKey.set(key, {
      controller,
      edges: target.edges,
    });
    void this.livePoller({
      route: routeForApi('events.ascending', {
        namespace: target.reference.namespace,
        workflowId: target.reference.workflowId,
      }),
      runId: target.reference.runId,
      startToken: '',
      signal: controller.signal,
      onEvent: (event) => {
        if (seenEventIds.has(event.eventId)) return false;
        seenEventIds.add(event.eventId);
        return true;
      },
      onNewEvents: () => {
        for (const edge of target.edges) {
          if (edge.expansion !== 'expanded' || edge.load.state !== 'loaded') {
            continue;
          }
          const child = edge.load.node;
          if (!child.runs.some((run) => run.runId === target.run.runId)) {
            continue;
          }
          this.enqueueRefresh(edge, child, target.reference);
        }
      },
    })
      .catch(() => undefined)
      .finally(() => {
        const current = this.livePollsByExecutionKey.get(key);
        if (current?.controller !== controller) return;
        this.livePollsByExecutionKey.delete(key);
        this.reconcileLivePolls();
      });
  }

  private add(target: Reservation, value: Reservation): void {
    target.nodes += value.nodes;
    target.runs += value.runs;
    target.groups += value.groups;
    target.events += value.events;
  }

  private subtract(target: Reservation, value: Reservation): void {
    target.nodes = Math.max(0, target.nodes - value.nodes);
    target.runs = Math.max(0, target.runs - value.runs);
    target.groups = Math.max(0, target.groups - value.groups);
    target.events = Math.max(0, target.events - value.events);
  }

  private changed(): void {
    this.revision += 1;
    this.reconcileLivePolls();
  }
}
