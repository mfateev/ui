import type { TimelineRun } from '$lib/services/chain-workflow-session';
import type { WorkflowStatus } from '$lib/types/workflows';

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
}: {
  runs: TimelineRun[];
  visibleRange: PixelRange;
  project: (timeMs: number) => number;
  liveEndTimeMs: number;
}): TimelineRunFrameCandidate[] {
  return runs.flatMap((run) => {
    const live =
      run.active && (run.status === 'Running' || run.status === 'Paused');
    const startWorldPx = project(run.startTimeMs);
    const endWorldPx = project(live ? liveEndTimeMs : run.endTimeMs);
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

export function getChainFrameCandidate({
  workflowId,
  runs,
  participatingRuns,
  knownChainStartRunId,
  visibleRange,
  project,
  liveEndTimeMs,
}: {
  workflowId: string;
  runs: TimelineRun[];
  participatingRuns: TimelineRunFrameCandidate[];
  knownChainStartRunId: string;
  visibleRange: PixelRange;
  project: (timeMs: number) => number;
  liveEndTimeMs: number;
}): TimelineChainFrameCandidate | null {
  if (runs.length < 2 || participatingRuns.length === 0) return null;
  const orderedRuns = [...runs].sort(
    (a, b) => a.startTimeMs - b.startTimeMs || a.runId.localeCompare(b.runId),
  );
  const finalRun = orderedRuns[orderedRuns.length - 1];
  const activeRun = orderedRuns.find((run) => run.active) ?? finalRun;
  const live =
    activeRun.active &&
    (activeRun.status === 'Running' || activeRun.status === 'Paused');
  const startBoundaryKnown = orderedRuns[0]?.runId === knownChainStartRunId;
  return {
    kind: 'chain',
    key: `chain-frame:${knownChainStartRunId}`,
    label: workflowId,
    status: activeRun.status,
    live,
    startWorldPx: startBoundaryKnown
      ? project(orderedRuns[0].startTimeMs)
      : visibleRange.startPx,
    endWorldPx: project(live ? liveEndTimeMs : finalRun.endTimeMs),
    startBoundaryKnown,
    endBoundaryKnown: !live,
  };
}
