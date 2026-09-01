import { describe, expect, it } from 'vitest';

import { binTimelineContinuations } from './timeline-continuation-bins';

describe('binTimelineContinuations', () => {
  it('caps marks by physical pixels', () => {
    const runs = Array.from({ length: 10_000 }, (_, index) => ({
      runId: `run-${index}`,
      status: 'ContinuedAsNew' as const,
      startTimeMs: index,
      endTimeMs: index + 1,
      transitionToNext: 'continue-as-new' as const,
    }));
    const result = binTimelineContinuations({
      runs,
      startTimeMs: 0,
      durationMs: 10_000,
      widthPx: 500,
    });
    expect(result.totalCount).toBe(10_000);
    expect(result.binCount).toBeLessThanOrEqual(500);
    expect(result.path.match(/M/g)).toHaveLength(result.binCount);
  });
});
