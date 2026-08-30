import { describe, expect, it } from 'vitest';

import type { TimelineRun } from '$lib/services/chain-workflow-session';

import {
  getChainFrameCandidate,
  getParticipatingRunFrames,
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

  it('suppresses a truncated chain start and projects it from the viewport edge', () => {
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
      visibleRange: { startPx: 50, endPx: 100 },
      project: (timeMs) => timeMs,
      liveEndTimeMs: 90,
    });

    expect(chain).toMatchObject({
      label: 'workflow',
      startWorldPx: 50,
      startBoundaryKnown: false,
      endWorldPx: 90,
      live: true,
    });
  });
});
