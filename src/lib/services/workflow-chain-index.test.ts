import { describe, expect, it } from 'vitest';

import {
  appendTrustedChainTransition,
  assertChainIndex,
  type ChainRunSummary,
  createChainIndexSnapshot,
  selectChainIndexInterval,
} from './workflow-chain-index';

const run = (
  runId: string,
  startTimeMs: number,
  predecessorRunId?: string,
  successorRunId?: string,
): ChainRunSummary => ({
  runId,
  status: successorRunId ? 'ContinuedAsNew' : 'Completed',
  startTimeMs,
  end: { kind: 'closed', timeMs: startTimeMs + 10 },
  predecessorRunId,
  successorRunId,
  transitionToSuccessor: successorRunId ? 'continue-as-new' : undefined,
});

const index = createChainIndexSnapshot({
  namespace: 'default',
  workflowId: 'workflow',
  firstExecutionRunId: 'run-1',
  currentRunId: 'run-4',
  revision: 1,
  scannedAtMs: 100,
  segments: [
    {
      runs: [run('run-1', 0, undefined, 'run-2'), run('run-2', 10, 'run-1')],
      before: { kind: 'known-chain-start' },
      after: { kind: 'scan-limit', resumeRunId: 'run-3' },
    },
    {
      runs: [run('run-4', 30)],
      before: { kind: 'scan-limit', resumeRunId: 'run-3' },
      after: { kind: 'known-chain-end' },
    },
  ],
});

describe('selectChainIndexInterval', () => {
  it('preserves separate segments and explicit boundaries across a gap', () => {
    const selected = selectChainIndexInterval({
      index,
      startTimeMs: 0,
      endTimeMs: 40,
      contextRuns: 0,
    });

    expect(
      selected.segments.map((segment) =>
        segment.runs.map((item) => item.runId),
      ),
    ).toEqual([['run-1', 'run-2'], ['run-4']]);
    expect(selected.boundaries.map((boundary) => boundary.kind)).toEqual([
      'scan-limit',
      'scan-limit',
    ]);
  });

  it('never selects context by slicing across segment boundaries', () => {
    const selected = selectChainIndexInterval({
      index,
      startTimeMs: 30,
      endTimeMs: 40,
      contextRuns: 3,
    });

    expect(selected.segments).toHaveLength(1);
    expect(selected.segments[0].runs.map((item) => item.runId)).toEqual([
      'run-4',
    ]);
  });
});

describe('chain index invariants', () => {
  it('rejects timestamp-ordered but link-invalid adjacency', () => {
    const invalid = createChainIndexSnapshot({
      namespace: 'default',
      workflowId: 'workflow',
      firstExecutionRunId: 'run-1',
      currentRunId: 'run-2',
      revision: 1,
      segments: [
        {
          runs: [run('run-1', 0, undefined, 'another-run'), run('run-2', 0)],
          before: { kind: 'known-chain-start' },
          after: { kind: 'known-chain-end' },
        },
      ],
    });

    expect(() => assertChainIndex(invalid)).toThrow(
      'Unverified chain adjacency',
    );
  });

  it('appends a trusted Continue-As-New handoff without rescanning', () => {
    const source = createChainIndexSnapshot({
      namespace: 'default',
      workflowId: 'workflow',
      firstExecutionRunId: 'run-1',
      currentRunId: 'run-1',
      revision: 4,
      segments: [
        {
          runs: [
            {
              ...run('run-1', 0),
              status: 'Running',
              end: { kind: 'live' },
            },
          ],
          before: { kind: 'known-chain-start' },
          after: { kind: 'live-edge' },
        },
      ],
    });

    const appended = appendTrustedChainTransition({
      index: source,
      predecessorRunId: 'run-1',
      successor: {
        ...run('run-2', 10),
        status: 'Running',
        end: { kind: 'live' },
      },
      transition: 'continue-as-new',
    });

    expect(appended.revision).toBe(5);
    expect(appended.currentRunId).toBe('run-2');
    expect(appended.segments[0].runs.map((item) => item.runId)).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(appended.segments[0].runs[0]).toMatchObject({
      successorRunId: 'run-2',
      end: { kind: 'closed', timeMs: 10 },
    });
    expect(appended.segments[0].after.kind).toBe('live-edge');
    assertChainIndex(appended);
  });
});
