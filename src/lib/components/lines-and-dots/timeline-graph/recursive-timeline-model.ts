import type { EventGroup } from '$lib/models/event-groups/event-groups';
import {
  DEFAULT_CHAIN_RETENTION_LIMITS,
  type TimelineRun,
} from '$lib/services/chain-workflow-session';
import type { LazyGroup } from '$lib/services/grouped-event-buffer';
import type { WorkflowExecution } from '$lib/types/workflows';

export type ChildWorkflowReference = {
  namespace: string;
  workflowId: string;
  runId: string;
};

export type TimelineTruncation = {
  reason:
    | 'cycle'
    | 'depth-limit'
    | 'node-limit'
    | 'event-limit'
    | 'group-limit'
    | 'run-limit';
};

export type TimelineChildErrorKind =
  | 'unavailable'
  | 'unauthorized'
  | 'network'
  | 'malformed';

export type TimelineChildLoadState =
  | { state: 'idle' }
  | { state: 'loading'; requestKey: string }
  | {
      state: 'loaded';
      node: TimelineWorkflowNode;
      truncation?: TimelineTruncation;
    }
  | {
      state: 'error';
      kind: TimelineChildErrorKind;
      reason: string;
      retryable: boolean;
    }
  | { state: 'truncated'; truncation: TimelineTruncation }
  | { state: 'evicted' };

export type TimelineChildEdge = {
  key: string;
  parentGroupKey: string;
  reference: ChildWorkflowReference;
  expansion: 'expanded' | 'collapsed';
  load: TimelineChildLoadState;
  depth: number;
  lastVisibleAt: number;
};

export type TimelineWorkflowNode = {
  key: string;
  namespace: string;
  workflowId: string;
  firstRunId: string;
  workflow: WorkflowExecution;
  runs: TimelineRun[];
  childrenByGroupKey: Map<string, TimelineChildEdge>;
  depth: number;
};

export type RecursiveTimelineLimits = {
  maximumDepth: number;
  maximumNodes: number;
  maximumConcurrentRequests: number;
  maximumDescendantRuns: number;
  maximumDescendantGroups: number;
  maximumDescendantEvents: number;
  maximumRunsPerNode: number;
  maximumGroupsPerNode: number;
  maximumEventsPerNode: number;
};

export const DEFAULT_RECURSIVE_TIMELINE_LIMITS: RecursiveTimelineLimits = {
  maximumDepth: 10,
  maximumNodes: 100,
  maximumConcurrentRequests: 4,
  maximumDescendantRuns: 200,
  maximumDescendantGroups: 10_000,
  maximumDescendantEvents: 50_000,
  maximumRunsPerNode: DEFAULT_CHAIN_RETENTION_LIMITS.completedRuns,
  maximumGroupsPerNode: DEFAULT_CHAIN_RETENTION_LIMITS.completedGroups,
  maximumEventsPerNode: DEFAULT_CHAIN_RETENTION_LIMITS.completedEvents,
};

const keyPart = (value: string): string =>
  `${new TextEncoder().encode(value).length}:${value}`;

export const executionKey = ({
  namespace,
  workflowId,
  firstRunId,
}: {
  namespace: string;
  workflowId: string;
  firstRunId: string;
}): string =>
  `execution:${keyPart(namespace)}:${keyPart(workflowId)}:${keyPart(firstRunId)}`;

export const childExecutionKey = (reference: ChildWorkflowReference): string =>
  executionKey({
    namespace: reference.namespace,
    workflowId: reference.workflowId,
    firstRunId: reference.runId,
  });

export const workflowGroupKey = ({
  executionKey: ownerKey,
  runId,
  timelineKey,
}: {
  executionKey: string;
  runId: string;
  timelineKey: string;
}): string =>
  `group:${keyPart(ownerKey)}:${keyPart(runId)}:${keyPart(timelineKey)}`;

export const childEdgeKey = ({
  parentExecutionKey,
  parentGroupKey,
  childExecutionKey: childKey,
}: {
  parentExecutionKey: string;
  parentGroupKey: string;
  childExecutionKey: string;
}): string =>
  `edge:${keyPart(parentExecutionKey)}:${keyPart(parentGroupKey)}:${keyPart(childKey)}`;

export const workflowFrameKey = ({
  executionKey: ownerKey,
  kind,
  runId,
}: {
  executionKey: string;
  kind: 'chain' | 'run';
  runId?: string;
}): string =>
  `frame:${keyPart(ownerKey)}:${kind}${runId ? `:${keyPart(runId)}` : ''}`;

export const timelineRunKey = (workflowKey: string, runId: string): string =>
  `${workflowKey}:run:${runId}`;

export const countNodeData = (
  node: TimelineWorkflowNode,
): { runs: number; groups: number; events: number } => ({
  runs: node.runs.length,
  groups: node.runs.reduce((count, run) => count + run.groups.length, 0),
  events: node.runs.reduce(
    (count, run) =>
      count +
      run.groups.reduce(
        (runCount, entry) => runCount + entry.group.eventCount,
        0,
      ),
    0,
  ),
});

export const getGroupForEdge = (
  node: TimelineWorkflowNode,
  edge: TimelineChildEdge,
): EventGroup | LazyGroup | undefined =>
  node.runs
    .flatMap((run) => run.groups)
    .find((entry) => entry.timelineKey === edge.parentGroupKey)?.group;

export const setEdgeExpansion = (
  edge: TimelineChildEdge,
  expansion: TimelineChildEdge['expansion'],
): void => {
  edge.expansion = expansion;
};

export const evictEdge = (
  edge: TimelineChildEdge,
): TimelineWorkflowNode | null => {
  if (edge.load.state !== 'loaded') return null;
  const node = edge.load.node;
  edge.load = { state: 'evicted' };
  return node;
};

export const canRetryEdge = (edge: TimelineChildEdge): boolean =>
  edge.load.state === 'evicted' ||
  (edge.load.state === 'error' && edge.load.retryable);

export const flattenWorkflowNodes = (
  root: TimelineWorkflowNode,
): TimelineWorkflowNode[] => {
  const nodes: TimelineWorkflowNode[] = [];
  const visited = new Set<string>();
  const visit = (node: TimelineWorkflowNode): void => {
    if (visited.has(node.key)) return;
    visited.add(node.key);
    nodes.push(node);
    for (const edge of node.childrenByGroupKey.values()) {
      if (edge.expansion === 'expanded' && edge.load.state === 'loaded') {
        visit(edge.load.node);
      }
    }
  };
  visit(root);
  return nodes;
};
