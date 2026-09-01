import type { TimelineRun } from '$lib/services/chain-workflow-session';
import type { WorkflowStatus } from '$lib/types/workflows';

import {
  timelineRunKey,
  type TimelineWorkflowNode,
  workflowFrameKey,
} from './recursive-timeline-model';
import type { PixelRange } from './viewport-geometry';
import { intersectPixelRanges } from './viewport-geometry';

export type TimelineRunFrameCandidate = {
  kind: 'run';
  key: string;
  runId: string;
  label: string;
  status: WorkflowStatus;
  live: boolean;
  startWorldPx: number;
  endWorldPx: number;
  startBoundaryKnown: boolean;
  endBoundaryKnown: boolean;
  workflowKey?: string;
  depth?: number;
  workflow?: TimelineWorkflowNode['workflow'];
};

export type TimelineChainFrameCandidate = Omit<
  TimelineRunFrameCandidate,
  'kind' | 'runId'
> & {
  kind: 'chain';
};

export function getParticipatingRunFrames({
  runs,
  visibleRange,
  project,
  liveEndTimeMs,
  visibleTimeRange,
}: {
  runs: TimelineRun[];
  visibleRange: PixelRange;
  project: (timeMs: number) => number;
  liveEndTimeMs: number;
  visibleTimeRange?: { startTimeMs: number; endTimeMs: number };
}): TimelineRunFrameCandidate[] {
  return runs.flatMap((run) => {
    const live =
      run.active && (run.status === 'Running' || run.status === 'Paused');
    const endTimeMs = live ? liveEndTimeMs : run.endTimeMs;
    if (
      visibleTimeRange &&
      (endTimeMs < visibleTimeRange.startTimeMs ||
        run.startTimeMs > visibleTimeRange.endTimeMs)
    ) {
      return [];
    }
    const startWorldPx = project(run.startTimeMs);
    const endWorldPx = project(endTimeMs);
    const intersects = intersectPixelRanges(
      { startPx: startWorldPx, endPx: endWorldPx },
      visibleRange,
    );
    if (!intersects) return [];
    return [
      {
        kind: 'run' as const,
        key: `run-frame:${run.runId}`,
        runId: run.runId,
        label: run.runId,
        status: run.status,
        live,
        startWorldPx,
        endWorldPx,
        startBoundaryKnown: true,
        endBoundaryKnown: !live,
      },
    ];
  });
}

export type RecursiveFrameCandidates = {
  runFrames: TimelineRunFrameCandidate[];
  chainFrames: TimelineChainFrameCandidate[];
  participatingRunKeys: Set<string>;
};

export function getRecursiveFrameCandidates({
  nodes,
  visibleRange,
  project,
  liveEndTimeMs,
  rootKnownChainStartRunId,
  visibleTimeRange,
}: {
  nodes: TimelineWorkflowNode[];
  visibleRange: PixelRange;
  project: (timeMs: number) => number;
  liveEndTimeMs: number;
  rootKnownChainStartRunId?: string;
  visibleTimeRange?: { startTimeMs: number; endTimeMs: number };
}): RecursiveFrameCandidates {
  const runFrames: TimelineRunFrameCandidate[] = [];
  const chainFrames: TimelineChainFrameCandidate[] = [];
  const participatingRunKeys = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const nodeRuns = getParticipatingRunFrames({
      runs: node.runs,
      visibleRange,
      project,
      liveEndTimeMs,
      visibleTimeRange,
    }).map((candidate) => ({
      ...candidate,
      key: workflowFrameKey({
        executionKey: node.key,
        kind: 'run',
        runId: candidate.runId,
      }),
      workflowKey: node.key,
      depth: node.depth,
      workflow: node.workflow,
    }));
    for (const candidate of nodeRuns) {
      participatingRunKeys.add(timelineRunKey(node.key, candidate.runId));
    }
    runFrames.push(...nodeRuns);
    const chain = getChainFrameCandidate({
      workflowId: node.workflowId,
      runs: node.runs,
      participatingRuns: nodeRuns,
      knownChainStartRunId:
        index === 0 && rootKnownChainStartRunId
          ? rootKnownChainStartRunId
          : node.firstRunId,
      allowSingleRun: true,
    });
    if (chain) {
      chainFrames.push({
        ...chain,
        key: workflowFrameKey({ executionKey: node.key, kind: 'chain' }),
        workflowKey: node.key,
        depth: node.depth,
        workflow: node.workflow,
      });
    }
  }
  return { runFrames, chainFrames, participatingRunKeys };
}

export function getChainFrameCandidate({
  workflowId,
  runs,
  participatingRuns,
  knownChainStartRunId,
  allowSingleRun = false,
}: {
  workflowId: string;
  runs: TimelineRun[];
  participatingRuns: TimelineRunFrameCandidate[];
  knownChainStartRunId: string;
  allowSingleRun?: boolean;
}): TimelineChainFrameCandidate | null {
  if (runs.length < (allowSingleRun ? 1 : 2) || participatingRuns.length === 0)
    return null;
  const orderedParticipatingRuns = [...participatingRuns].sort(
    (a, b) => a.startWorldPx - b.startWorldPx || a.runId.localeCompare(b.runId),
  );
  const firstParticipatingRun = orderedParticipatingRuns[0];
  const lastParticipatingRun = orderedParticipatingRuns.at(-1)!;
  const live = lastParticipatingRun.live;
  return {
    kind: 'chain',
    key: `chain-frame:${knownChainStartRunId}`,
    label: workflowId,
    status: lastParticipatingRun.status,
    live,
    startWorldPx: firstParticipatingRun.startWorldPx,
    endWorldPx: lastParticipatingRun.endWorldPx,
    startBoundaryKnown: true,
    endBoundaryKnown: !live,
  };
}
