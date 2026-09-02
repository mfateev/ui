import { describe, expect, it, vi } from 'vitest';

import { createGroupedEventBuffer } from './grouped-event-buffer';
import {
  makeActivityGroup,
  makeWorkflowCompleted,
  makeWorkflowStarted,
} from './test-helpers/synthetic-events';
import {
  BufferTimelineRunModel,
  SealedTimelineRunModel,
  TimelineDetailCache,
  TimelineRunModelCache,
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

describe('SealedTimelineRunModel', () => {
  it('keeps immutable summaries and reconstructs details after releasing the buffer', async () => {
    const buffer = createGroupedEventBuffer();
    const events = [
      makeWorkflowStarted(1),
      ...makeActivityGroup(2, 'first'),
      ...makeActivityGroup(5, 'middle'),
      ...makeActivityGroup(8, 'last'),
      makeWorkflowCompleted(11),
    ];
    buffer.reset(events.length);
    for (const event of events) buffer.ingestHistoryEvent(event);
    const model = SealedTimelineRunModel.fromBuffer({
      identity: {
        namespace: 'default',
        workflowId: 'workflow',
        runId: 'run',
        closeTimeMs: Date.parse('2024-01-01T00:00:00Z'),
        historyLength: events.length,
      },
      run: {
        runId: 'run',
        status: 'Completed',
        startTimeMs: 0,
        endTimeMs: 1,
      },
      namespace: 'default',
      buffer,
      detailCache: new TimelineDetailCache(1024 * 1024),
    });

    expect(model.sealed).toBe(true);
    expect(model.revision).toBe(0);
    expect(buffer.getLazyGroups()).toHaveLength(0);
    const ordinals = [
      0,
      Math.floor(model.groupCount / 2),
      model.groupCount - 1,
    ];
    for (const ordinal of ordinals) {
      const summary = model.groupAt(ordinal)!;
      const detail = await model.loadDetails(summary.key, summary.version);
      expect(detail.id).toBe(summary.key);
      expect(detail.eventList).toHaveLength(summary.eventCount);
    }
    expect(model.revision).toBe(0);
  });

  it('rejects mutable models from the sealed cache', () => {
    const buffer = createGroupedEventBuffer();
    const mutable = new BufferTimelineRunModel(
      {
        runId: 'run',
        status: 'Running',
        startTimeMs: 0,
        endTimeMs: 1,
      },
      'default',
      'workflow',
      buffer,
      new TimelineDetailCache(1024),
    );
    const cache = new TimelineRunModelCache(1, 1024);
    expect(() =>
      cache.set(
        {
          namespace: 'default',
          workflowId: 'workflow',
          runId: 'run',
          closeTimeMs: 1,
          historyLength: 1,
        },
        mutable as unknown as SealedTimelineRunModel,
        1,
      ),
    ).toThrow(/Only sealed/);
    mutable.dispose();
  });
});
