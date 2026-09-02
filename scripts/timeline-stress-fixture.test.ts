import { describe, expect, it } from 'vitest';

import { createTimelineStressFixture } from '../tests/test-utilities/timeline-stress-fixture';

describe('timeline stress fixture', () => {
  it('generates tens of thousands of rows over multiple runs in bounded pages', () => {
    const fixture = createTimelineStressFixture({
      runCount: 24,
      rowsPerRun: 1_500,
    });

    expect(fixture.totalRows).toBe(36_000);
    expect(fixture.runs).toHaveLength(24);
    expect(new Set(fixture.runs.map(({ runId }) => runId)).size).toBe(24);

    let generatedEvents = 0;
    for (const run of fixture.runs) {
      let token: string | null = null;
      do {
        const page = fixture.historyPage(run.runId, 'ascending', 1_000, token);
        expect(page.events.length).toBeLessThanOrEqual(1_000);
        generatedEvents += page.events.length;
        token = page.nextPageToken;
      } while (token);
    }

    expect(generatedEvents).toBe(
      fixture.runs.reduce((total, run) => total + run.eventCount, 0),
    );
    expect(
      fixture.workflowResponse(fixture.currentRunId).workflowExecutionInfo
        ?.status,
    ).toBe('Completed');
  });

  it('exposes the next run from the final event of every closed run', () => {
    const fixture = createTimelineStressFixture({
      runCount: 3,
      rowsPerRun: 10,
    });

    for (const run of fixture.runs.slice(0, -1)) {
      const page = fixture.historyPage(run.runId, 'descending', 1);
      expect(page.events[0]).toMatchObject({
        eventType: 'WorkflowExecutionContinuedAsNew',
        workflowExecutionContinuedAsNewEventAttributes: {
          newExecutionRunId: run.nextRunId,
        },
      });
    }
  });
});
