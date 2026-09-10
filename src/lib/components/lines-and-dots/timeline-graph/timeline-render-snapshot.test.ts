import { describe, expect, it, vi } from 'vitest';

import {
  assertTimelineRenderSnapshot,
  createTimelineProjectionSnapshot,
  TimelineCoordinator,
  type TimelineRenderSnapshot,
} from './timeline-render-snapshot';

const projection = (viewId: object) =>
  createTimelineProjectionSnapshot({
    revision: 1,
    viewId,
    widthPx: 100,
    domain: { startTimeMs: 0, endTimeMs: 10 },
    expandedPxPerMs: 10,
    segments: [
      {
        key: 'time',
        startTimeMs: 0,
        endTimeMs: 10,
        startPx: 0,
        endPx: 100,
        isCollapsed: false,
        isCollapsible: false,
      },
    ],
  });

const render = (
  requestEpoch: number,
): TimelineRenderSnapshot<null, null, string, string, string, null> => {
  const generationId = {};
  const viewId = {};
  const projected = projection(viewId);
  return Object.freeze({
    id: {},
    requestEpoch,
    scene: Object.freeze({
      generationId,
      publicationRevision: 1,
      layout: null,
      frames: null,
      readiness: 'complete',
    }),
    view: Object.freeze({
      id: viewId,
      sceneGenerationId: generationId,
      scenePublicationRevision: 1,
      intent: Object.freeze({
        mode: 'full-duration',
        reverseSort: false,
        filters: Object.freeze({ eventTypes: [], failedOrPending: false }),
        expandedEdges: new Set<string>(),
      }),
      domain: Object.freeze({ startTimeMs: 0, endTimeMs: 10 }),
      rows: Object.freeze(['row']),
    }),
    projection: projected,
    presentation: Object.freeze({
      revision: 1,
      sceneGenerationId: generationId,
      viewId,
      projectionId: projected.id,
      activeBlocks: Object.freeze([
        Object.freeze({
          id: {},
          sourceBlockIds: Object.freeze([]),
          viewId,
          projectionId: projected.id,
          rowStart: 0,
          rowEnd: 1,
          rows: Object.freeze(['row']),
          runFrames: Object.freeze(['run-frame']),
          chainFrames: Object.freeze(['chain-frame']),
        }),
      ]),
      parkedBlockIds: Object.freeze([]),
    }),
    axis: null,
    transition: 'snap',
  });
};

describe('TimelineRenderSnapshot', () => {
  it('closes projection functions over immutable concrete segments', () => {
    const viewId = {};
    const source = [
      {
        key: 'time',
        startTimeMs: 0,
        endTimeMs: 10,
        startPx: 0,
        endPx: 100,
        isCollapsed: false,
        isCollapsible: false,
      },
    ];
    const snapshot = createTimelineProjectionSnapshot({
      revision: 1,
      viewId,
      widthPx: 100,
      domain: { startTimeMs: 0, endTimeMs: 10 },
      segments: source,
      expandedPxPerMs: 10,
    });
    source[0].endPx = 1_000;

    expect(snapshot.project(5)).toBe(50);
    expect(snapshot.unproject(50)).toBe(5);
  });

  it('rejects independently mixed scene, view, projection, or block inputs', () => {
    const valid = render(1);
    expect(() => assertTimelineRenderSnapshot(valid)).not.toThrow();
    const invalid = {
      ...valid,
      presentation: { ...valid.presentation, projectionId: {} },
    };
    expect(() => assertTimelineRenderSnapshot(invalid)).toThrow(
      'Timeline presentation does not belong',
    );
  });
});

describe('TimelineCoordinator', () => {
  it('rejects stale commits and releases their provisional leases', () => {
    const publish = vi.fn();
    const staleRelease = vi.fn();
    const coordinator = new TimelineCoordinator<ReturnType<typeof render>>(
      publish,
    );
    const stale = coordinator.begin();
    const current = coordinator.begin();

    expect(coordinator.commit(stale, render(stale.epoch), [staleRelease])).toBe(
      false,
    );
    expect(staleRelease).toHaveBeenCalledOnce();
    expect(coordinator.commit(current, render(current.epoch))).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('retires the previous render lease only after the replacement publication', async () => {
    const order: string[] = [];
    const coordinator = new TimelineCoordinator<ReturnType<typeof render>>(() =>
      order.push('publish'),
    );
    const first = coordinator.begin();
    coordinator.commit(first, render(first.epoch), [
      () => order.push('release'),
    ]);
    await Promise.resolve();
    const second = coordinator.begin();
    coordinator.commit(second, render(second.epoch));

    expect(order).toEqual(['publish', 'publish']);
    await Promise.resolve();
    expect(order).toEqual(['publish', 'publish', 'release']);
  });
});
