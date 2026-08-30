import { describe, expect, it } from 'vitest';

import type { TimelineRun } from '$lib/services/chain-workflow-session';
import type { WorkflowExecution } from '$lib/types/workflows';

import type { TimelineWorkflowNode } from './recursive-timeline-model';
import {
  getChainFrameCandidate,
  getParticipatingRunFrames,
  getRecursiveFrameCandidates,
} from './timeline-frame-visibility';

const run = (
  runId: string,
  startTimeMs: number,
  endTimeMs: number,
  active = false,
): TimelineRun => ({
  runId,
  status: active ? 'Running' : 'Completed',
  startTimeMs,
  endTimeMs,
  active,
  groups: [],
});

describe('timeline frame visibility', () => {
  it('keeps only runs whose duration intersects the viewport', () => {
    const frames = getParticipatingRunFrames({
      runs: [run('left', 0, 10), run('visible', 20, 40), run('right', 50, 60)],
      visibleRange: { startPx: 15, endPx: 45 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 100,
    });

    expect(frames.map((frame) => frame.runId)).toEqual(['visible']);
  });

  it('uses the live edge for a running successor', () => {
    const frames = getParticipatingRunFrames({
      runs: [run('active', 20, 30, true)],
      visibleRange: { startPx: 80, endPx: 120 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 100,
    });

    expect(frames[0]).toMatchObject({
      runId: 'active',
      endWorldPx: 100,
      live: true,
      endBoundaryKnown: false,
    });
  });

  it('closes a truncated chain at the first participating run', () => {
    const runs = [run('retained', 20, 40), run('active', 40, 80, true)];
    const participatingRuns = getParticipatingRunFrames({
      runs,
      visibleRange: { startPx: 50, endPx: 100 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 90,
    });
    const chain = getChainFrameCandidate({
      workflowId: 'workflow',
      runs,
      participatingRuns,
      knownChainStartRunId: 'pruned-first-run',
    });

    expect(chain).toMatchObject({
      label: 'workflow',
      startWorldPx: 40,
      startBoundaryKnown: true,
      endWorldPx: 90,
      live: true,
    });
  });

  it('does not extend to the viewport edge when no run frame reaches it', () => {
    const runs = [run('offscreen', 0, 10), run('visible', 20, 40)];
    const participatingRuns = getParticipatingRunFrames({
      runs,
      visibleRange: { startPx: 15, endPx: 45 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 45,
    });
    const chain = getChainFrameCandidate({
      workflowId: 'workflow',
      runs,
      participatingRuns,
      knownChainStartRunId: 'offscreen',
    });

    expect(chain).toMatchObject({
      startWorldPx: 20,
      endWorldPx: 40,
      startBoundaryKnown: true,
      endBoundaryKnown: true,
    });
  });

  it('keeps single runs visible inside their outer workflow frames', () => {
    const node = (
      key: string,
      depth: number,
      runs: TimelineRun[],
    ): TimelineWorkflowNode => ({
      key,
      namespace: 'default',
      workflowId: key,
      firstRunId: runs[0].runId,
      workflow: { id: key } as WorkflowExecution,
      runs,
      childrenByGroupKey: new Map(),
      depth,
    });
    const candidates = getRecursiveFrameCandidates({
      nodes: [
        node('root', 0, [run('root-run', 0, 100)]),
        node('child', 1, [run('child-run', 10, 90)]),
      ],
      visibleRange: { startPx: 0, endPx: 100 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 100,
    });

    expect(candidates.runFrames.map((frame) => frame.runId)).toEqual([
      'root-run',
      'child-run',
    ]);
    expect(candidates.chainFrames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workflowKey: 'root', kind: 'chain' }),
        expect.objectContaining({ workflowKey: 'child', kind: 'chain' }),
      ]),
    );
    expect(candidates.chainFrames).toHaveLength(2);
    expect(candidates.participatingRunKeys).toEqual(
      new Set(['root:run:root-run', 'child:run:child-run']),
    );
  });

  it('keeps continued child runs inside their outer workflow frame', () => {
    const runs = [run('child-1', 10, 40), run('child-2', 40, 90)];
    const child = {
      key: 'child',
      namespace: 'default',
      workflowId: 'child',
      firstRunId: 'child-1',
      workflow: { id: 'child' } as WorkflowExecution,
      runs,
      childrenByGroupKey: new Map(),
      depth: 1,
    } as TimelineWorkflowNode;
    const candidates = getRecursiveFrameCandidates({
      nodes: [child],
      visibleRange: { startPx: 0, endPx: 100 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 100,
    });

    expect(candidates.chainFrames).toHaveLength(1);
    expect(candidates.runFrames.map((frame) => frame.runId)).toEqual([
      'child-1',
      'child-2',
    ]);
  });
});
