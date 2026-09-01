import { describe, expect, it, vi } from 'vitest';

import { createGroupedEventBuffer } from './grouped-event-buffer';
import { makeActivityGroup } from './test-helpers/synthetic-events';
import {
  BufferTimelineRunModel,
  TimelineDetailCache,
} from './timeline-run-model';

describe('BufferTimelineRunModel', () => {
  it('projects summaries without materializing groups', async () => {
    const buffer = createGroupedEventBuffer();
    buffer.reset(3);
    for (const event of makeActivityGroup(1)) buffer.ingestHistoryEvent(event);
    const materialize = vi.spyOn(buffer, 'materializeGroup');
    const model = new BufferTimelineRunModel(
      {
        runId: 'run',
        status: 'Completed',
        startTimeMs: 0,
        endTimeMs: 1,
      },
      'default',
      'workflow',
      buffer,
      new TimelineDetailCache(1024 * 1024),
    );

    const summary = model.groupAt(0);
    expect(summary).toMatchObject({ eventCount: 3, key: '1' });
    expect(summary?.points).toHaveLength(3);
    expect(materialize).not.toHaveBeenCalled();

    await model.loadDetails(summary!.key, summary!.version);
    expect(materialize).toHaveBeenCalledOnce();
  });

  it('keeps a visible lease alive after cache eviction', () => {
    const buffer = createGroupedEventBuffer();
    buffer.reset(3);
    for (const event of makeActivityGroup(1)) buffer.ingestHistoryEvent(event);
    const model = new BufferTimelineRunModel(
      {
        runId: 'run',
        status: 'Completed',
        startTimeMs: 0,
        endTimeMs: 1,
      },
      'default',
      'workflow',
      buffer,
      new TimelineDetailCache(1024),
    );
    const releaseVisible = model.retain();
    const releaseCache = model.retain();
    releaseCache();
    expect(model.groupCount).toBe(1);
    releaseVisible();
    expect(() => model.groupAt(0)).toThrow(/disposed/);
  });
});
