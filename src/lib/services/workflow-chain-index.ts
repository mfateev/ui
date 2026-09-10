import type { WorkflowStatus } from '$lib/types/workflows';

import type { ChainTransition } from './chain-workflow-session';

export type ChainRunEnd =
  | Readonly<{ kind: 'closed'; timeMs: number }>
  | Readonly<{ kind: 'live' }>;

export type ChainRunSummary = Readonly<{
  runId: string;
  status: WorkflowStatus;
  startTimeMs: number;
  end: ChainRunEnd;
  predecessorRunId?: string;
  successorRunId?: string;
  transitionToSuccessor?: ChainTransition;
}>;

export type ChainBoundary =
  | Readonly<{ kind: 'known-chain-start' }>
  | Readonly<{ kind: 'known-chain-end' }>
  | Readonly<{ kind: 'live-edge' }>
  | Readonly<{ kind: 'not-scanned'; resumeRunId?: string }>
  | Readonly<{ kind: 'scan-limit'; resumeRunId: string }>
  | Readonly<{ kind: 'retention'; missingRunId?: string }>
  | Readonly<{
      kind: 'invalid-chain';
      reason: 'cycle' | 'mismatch';
    }>;

export type ChainSegment = Readonly<{
  runs: readonly ChainRunSummary[];
  before: ChainBoundary;
  after: ChainBoundary;
}>;

export type ChainIndexSnapshot = Readonly<{
  id: object;
  revision: number;
  chain: Readonly<{
    namespace: string;
    workflowId: string;
    firstExecutionRunId: string;
  }>;
  segments: readonly ChainSegment[];
  currentRunId: string;
  scannedAtMs: number;
}>;

export type ChainIntervalSelection = Readonly<{
  indexId: object;
  segments: readonly ChainSegment[];
  boundaries: readonly ChainBoundary[];
}>;

const freezeBoundary = (boundary: ChainBoundary): ChainBoundary =>
  Object.freeze({ ...boundary });

export const createChainIndexSnapshot = ({
  namespace,
  workflowId,
  firstExecutionRunId,
  currentRunId,
  revision,
  segments,
  scannedAtMs = Date.now(),
}: {
  namespace: string;
  workflowId: string;
  firstExecutionRunId: string;
  currentRunId: string;
  revision: number;
  segments: readonly ChainSegment[];
  scannedAtMs?: number;
}): ChainIndexSnapshot => {
  const frozenSegments = segments.map((segment) =>
    Object.freeze({
      runs: Object.freeze(
        segment.runs.map((run) =>
          Object.freeze({
            ...run,
            end: Object.freeze({ ...run.end }),
          }),
        ),
      ),
      before: freezeBoundary(segment.before),
      after: freezeBoundary(segment.after),
    }),
  );
  return Object.freeze({
    id: Object.freeze({}),
    revision,
    chain: Object.freeze({
      namespace,
      workflowId,
      firstExecutionRunId,
    }),
    segments: Object.freeze(frozenSegments),
    currentRunId,
    scannedAtMs,
  });
};

export const chainRunEndTimeMs = (
  run: ChainRunSummary,
  liveTimeMs: number,
): number => (run.end.kind === 'closed' ? run.end.timeMs : liveTimeMs);

const runIntersects = (
  run: ChainRunSummary,
  startTimeMs: number,
  endTimeMs: number,
  liveTimeMs: number,
): boolean =>
  chainRunEndTimeMs(run, liveTimeMs) >= startTimeMs &&
  run.startTimeMs <= endTimeMs;

export const selectChainIndexInterval = ({
  index,
  startTimeMs,
  endTimeMs,
  contextRuns = 1,
  liveTimeMs = index.scannedAtMs,
}: {
  index: ChainIndexSnapshot;
  startTimeMs: number;
  endTimeMs: number;
  contextRuns?: number;
  liveTimeMs?: number;
}): ChainIntervalSelection => {
  const selected: ChainSegment[] = [];
  const boundaries: ChainBoundary[] = [];
  for (const segment of index.segments) {
    let first = segment.runs.findIndex((run) =>
      runIntersects(run, startTimeMs, endTimeMs, liveTimeMs),
    );
    if (first < 0) continue;
    let last = segment.runs.findLastIndex((run) =>
      runIntersects(run, startTimeMs, endTimeMs, liveTimeMs),
    );
    first = Math.max(0, first - contextRuns);
    last = Math.min(segment.runs.length - 1, last + contextRuns);
    const before =
      first === 0
        ? segment.before
        : ({
            kind: 'not-scanned',
            resumeRunId: segment.runs[first - 1].runId,
          } as const);
    const after =
      last === segment.runs.length - 1
        ? segment.after
        : ({
            kind: 'not-scanned',
            resumeRunId: segment.runs[last + 1].runId,
          } as const);
    selected.push(
      Object.freeze({
        runs: Object.freeze(segment.runs.slice(first, last + 1)),
        before: freezeBoundary(before),
        after: freezeBoundary(after),
      }),
    );
  }
  for (let index = 0; index < selected.length - 1; index += 1) {
    boundaries.push(selected[index].after, selected[index + 1].before);
  }
  return Object.freeze({
    indexId: index.id,
    segments: Object.freeze(selected),
    boundaries: Object.freeze(boundaries),
  });
};

export const appendTrustedChainTransition = ({
  index,
  predecessorRunId,
  successor,
  transition,
  revision = index.revision + 1,
}: {
  index: ChainIndexSnapshot;
  predecessorRunId: string;
  successor: Omit<ChainRunSummary, 'predecessorRunId'>;
  transition: ChainTransition;
  revision?: number;
}): ChainIndexSnapshot => {
  const segmentIndex = index.segments.findIndex((segment) =>
    segment.runs.some((run) => run.runId === predecessorRunId),
  );
  if (segmentIndex < 0) return index;
  const segment = index.segments[segmentIndex];
  const predecessorIndex = segment.runs.findIndex(
    (run) => run.runId === predecessorRunId,
  );
  if (predecessorIndex !== segment.runs.length - 1) return index;
  const predecessor = segment.runs[predecessorIndex];
  if (
    predecessor.successorRunId &&
    predecessor.successorRunId !== successor.runId
  ) {
    return index;
  }
  const closedPredecessor: ChainRunSummary = Object.freeze({
    ...predecessor,
    end:
      predecessor.end.kind === 'live'
        ? Object.freeze({
            kind: 'closed' as const,
            timeMs: successor.startTimeMs,
          })
        : predecessor.end,
    successorRunId: successor.runId,
    transitionToSuccessor: transition,
  });
  const nextSegment: ChainSegment = Object.freeze({
    runs: Object.freeze([
      ...segment.runs.slice(0, predecessorIndex),
      closedPredecessor,
      Object.freeze({
        ...successor,
        predecessorRunId,
        end: Object.freeze({ ...successor.end }),
      }),
    ]),
    before: segment.before,
    after:
      successor.end.kind === 'live'
        ? Object.freeze({ kind: 'live-edge' as const })
        : Object.freeze({ kind: 'known-chain-end' as const }),
  });
  return createChainIndexSnapshot({
    ...index.chain,
    firstExecutionRunId: index.chain.firstExecutionRunId,
    currentRunId: successor.runId,
    revision,
    segments: index.segments.map((candidate, candidateIndex) =>
      candidateIndex === segmentIndex ? nextSegment : candidate,
    ),
  });
};

export const assertChainIndex = (index: ChainIndexSnapshot): void => {
  const seen = new Set<string>();
  for (const segment of index.segments) {
    for (const [runIndex, run] of segment.runs.entries()) {
      if (seen.has(run.runId))
        throw new Error(`Duplicate chain run ${run.runId}.`);
      seen.add(run.runId);
      const next = segment.runs[runIndex + 1];
      if (!next) continue;
      if (
        run.successorRunId !== next.runId ||
        next.predecessorRunId !== run.runId
      ) {
        throw new Error(
          `Unverified chain adjacency ${run.runId} -> ${next.runId}.`,
        );
      }
    }
  }
};
