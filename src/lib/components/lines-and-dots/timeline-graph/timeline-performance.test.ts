import { describe, expect, it } from 'vitest';

import { TimelinePerformanceTracker } from './timeline-performance';

describe('TimelinePerformanceTracker', () => {
  it('reports update latency for the current rendered density', () => {
    const tracker = new TimelinePerformanceTracker();
    const base = {
      logicalRows: 100,
      mountedRows: 50,
      renderedLines: 25,
      renderedElements: 500,
    };

    tracker.record({ ...base, updateMs: 1 });
    tracker.record({ ...base, updateMs: 2 });
    tracker.record({ ...base, updateMs: 3 });
    const stats = tracker.record({ ...base, updateMs: 20 });

    expect(stats).toMatchObject({
      maximumUpdateMs: 20,
      p95UpdateMs: 20,
      sampleCount: 4,
      sequence: 4,
      updateMs: 20,
    });
  });

  it('keeps density histories separate and bounded', () => {
    const tracker = new TimelinePerformanceTracker(2);
    const sample = {
      logicalRows: 10,
      mountedRows: 10,
      renderedLines: 5,
      renderedElements: 100,
    };

    tracker.record({ ...sample, updateMs: 100 });
    tracker.record({ ...sample, updateMs: 2 });
    const bounded = tracker.record({ ...sample, updateMs: 3 });
    const otherDensity = tracker.record({
      ...sample,
      logicalRows: 11,
      updateMs: 4,
    });

    expect(bounded.maximumUpdateMs).toBe(3);
    expect(bounded.sampleCount).toBe(2);
    expect(otherDensity.maximumUpdateMs).toBe(4);
    expect(otherDensity.sampleCount).toBe(1);
    expect(otherDensity.sequence).toBe(4);
  });
});
