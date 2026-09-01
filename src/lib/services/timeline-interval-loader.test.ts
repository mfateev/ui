import { describe, expect, it } from 'vitest';

import type { WorkflowExecution } from '$lib/types/workflows';

import { TimelineIntervalLoader } from './timeline-interval-loader';
import { DEFAULT_TIMELINE_PERFORMANCE_LIMITS } from './timeline-performance-limits';

const runs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    runId: `run-${index}`,
    status: 'Completed' as const,
    startTimeMs: index * 10,
    endTimeMs: index * 10 + 9,
  }));

const workflow = (runId: string): WorkflowExecution =>
  ({
    id: 'workflow',
    runId,
    status: 'Completed',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:00:01Z',
    historyEvents: '0',
  }) as WorkflowExecution;

describe('TimelineIntervalLoader', () => {
  it('bounds run jobs and HTTP requests while publishing progressively', async () => {
    const loader = new TimelineIntervalLoader({
      ...DEFAULT_TIMELINE_PERFORMANCE_LIMITS,
      intervalRunJobs: 2,
      intervalHttpRequests: 4,
    });
    let activeHttp = 0;
    let peakHttp = 0;
    const request = async <T>(value: T): Promise<T> => {
      activeHttp += 1;
      peakHttp = Math.max(peakHttp, activeHttp);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeHttp -= 1;
      return value;
    };
    const loading = new Set<string>();
    let peakJobs = 0;
    const published: string[] = [];

    const result = await loader.load({
      namespace: 'default',
      workflowId: 'workflow',
      runs: runs(12),
      startTimeMs: 0,
      endTimeMs: 120,
      describeRun: (runId) => request(workflow(runId)),
      fetchEdge: () => request([]),
      onState: ({ run, state }) => {
        if (state === 'loading') loading.add(run.runId);
        else loading.delete(run.runId);
        peakJobs = Math.max(peakJobs, loading.size);
      },
      onModel: ({ run }) => published.push(run.runId),
    });

    expect(peakJobs).toBeLessThanOrEqual(2);
    expect(peakHttp).toBeLessThanOrEqual(4);
    expect(result.models).toHaveLength(12);
    expect(published).toHaveLength(12);
    loader.dispose();
  });

  it('does not publish late completions from an obsolete generation', async () => {
    const loader = new TimelineIntervalLoader();
    let release = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const published: string[] = [];
    const first = loader.load({
      namespace: 'default',
      workflowId: 'workflow',
      runs: runs(1),
      startTimeMs: 0,
      endTimeMs: 10,
      describeRun: async (runId) => {
        await gate;
        return workflow(runId);
      },
      fetchEdge: async () => {
        await gate;
        return [];
      },
      onModel: ({ run }) => published.push(run.runId),
    });
    await Promise.resolve();
    const second = loader.load({
      namespace: 'default',
      workflowId: 'workflow',
      runs: [
        {
          runId: 'current',
          status: 'Completed',
          startTimeMs: 0,
          endTimeMs: 10,
        },
      ],
      startTimeMs: 0,
      endTimeMs: 10,
      describeRun: async (runId) => workflow(runId),
      fetchEdge: async () => [],
      onModel: ({ run }) => published.push(run.runId),
    });
    release();
    await Promise.all([first, second]);
    expect(published).toEqual(['current']);
    loader.dispose();
  });
});
