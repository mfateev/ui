import type { ScaledSegment } from './timeline-scale.svelte';

export type TimelineDomain = Readonly<{
  startTimeMs: number;
  endTimeMs: number;
}>;

export type TimelineViewIntent = Readonly<{
  mode: 'full-duration' | 'fixed-window';
  windowState?: 'following' | 'paused' | 'playing';
  windowDurationMs?: number;
  anchorTimeMs?: number;
  reverseSort: boolean;
  filters: Readonly<{
    eventTypes: readonly string[];
    failedOrPending: boolean;
  }>;
  expandedEdges: ReadonlySet<string>;
}>;

export type TimelineSceneSnapshot<Layout, Frames> = Readonly<{
  generationId: object;
  publicationRevision: number;
  chainIndexId?: object;
  layout: Layout;
  frames: Frames;
  orderedRunSources?: readonly Readonly<{
    runId: string;
    version: object;
    state: 'sealed' | 'mutable' | 'closing-unsealed';
  }>[];
  readiness: 'initial-blocks' | 'complete';
}>;

export type TimelineViewSnapshot<Rows> = Readonly<{
  id: object;
  sceneGenerationId: object;
  scenePublicationRevision: number;
  intent: TimelineViewIntent;
  domain: TimelineDomain;
  rows: readonly Rows[];
}>;

export type TimelineProjectionSnapshot = Readonly<{
  id: object;
  revision: number;
  viewId: object;
  widthPx: number;
  domain: TimelineDomain;
  segments: readonly ScaledSegment[];
  expandedPxPerMs: number;
  liveEdgePxPerMs: number;
  totalWorldWidthPx: number;
  project: (timeMs: number) => number;
  unproject: (worldPx: number) => number;
}>;

export type PresentedTimelineBlock<Row, RunFrame, ChainFrame> = Readonly<{
  id: object;
  sourceBlockIds: readonly object[];
  viewId: object;
  projectionId: object;
  rowStart: number;
  rowEnd: number;
  rows: readonly Row[];
  runFrames: readonly RunFrame[];
  chainFrames: readonly ChainFrame[];
}>;

export type TimelinePresentationSnapshot<Row, RunFrame, ChainFrame> = Readonly<{
  revision: number;
  sceneGenerationId: object;
  viewId: object;
  projectionId: object;
  activeBlocks: readonly PresentedTimelineBlock<Row, RunFrame, ChainFrame>[];
  parkedBlockIds: readonly object[];
  focusedRowId?: string;
  selectedRowId?: string;
}>;

export type TimelineRenderSnapshot<
  Layout,
  Frames,
  Rows,
  RunFrame,
  ChainFrame,
  Axis,
> = Readonly<{
  id: object;
  requestEpoch: number;
  scene: TimelineSceneSnapshot<Layout, Frames>;
  view: TimelineViewSnapshot<Rows>;
  projection: TimelineProjectionSnapshot;
  presentation: TimelinePresentationSnapshot<Rows, RunFrame, ChainFrame>;
  axis: Axis;
  transition: 'snap' | 'structural';
}>;

const firstIndexReaching = <Value>(
  values: readonly Value[],
  end: (value: Value) => number,
  target: number,
): number => {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (end(values[middle]) < target) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const createTimelineProjectionSnapshot = ({
  revision,
  viewId,
  widthPx,
  domain,
  segments,
  expandedPxPerMs,
}: {
  revision: number;
  viewId: object;
  widthPx: number;
  domain: TimelineDomain;
  segments: readonly ScaledSegment[];
  expandedPxPerMs: number;
}): TimelineProjectionSnapshot => {
  const frozenSegments = Object.freeze(
    segments.map((segment) => Object.freeze({ ...segment })),
  );
  const project = (timeMs: number): number => {
    if (!frozenSegments.length) return 0;
    const first = frozenSegments[0];
    const last = frozenSegments.at(-1)!;
    if (timeMs <= first.startTimeMs) return first.startPx;
    if (timeMs >= last.endTimeMs) return last.endPx;
    const segment =
      frozenSegments[
        firstIndexReaching(frozenSegments, (value) => value.endTimeMs, timeMs)
      ];
    const durationMs = segment.endTimeMs - segment.startTimeMs || 1;
    return (
      segment.startPx +
      ((timeMs - segment.startTimeMs) / durationMs) *
        (segment.endPx - segment.startPx)
    );
  };
  const unproject = (worldPx: number): number => {
    if (!frozenSegments.length) return domain.startTimeMs;
    const first = frozenSegments[0];
    const last = frozenSegments.at(-1)!;
    if (worldPx <= first.startPx) return first.startTimeMs;
    if (worldPx >= last.endPx) return last.endTimeMs;
    const segment =
      frozenSegments[
        firstIndexReaching(frozenSegments, (value) => value.endPx, worldPx)
      ];
    const width = segment.endPx - segment.startPx || 1;
    return (
      segment.startTimeMs +
      ((worldPx - segment.startPx) / width) *
        (segment.endTimeMs - segment.startTimeMs)
    );
  };
  return Object.freeze({
    id: Object.freeze({}),
    revision,
    viewId,
    widthPx,
    domain: Object.freeze({ ...domain }),
    segments: frozenSegments,
    expandedPxPerMs,
    liveEdgePxPerMs: frozenSegments.at(-1)?.isCollapsed ? 0 : expandedPxPerMs,
    totalWorldWidthPx: frozenSegments.at(-1)?.endPx ?? 0,
    project,
    unproject,
  });
};

export const assertTimelineRenderSnapshot = <
  Layout,
  Frames,
  Rows,
  RunFrame,
  ChainFrame,
  Axis,
>(
  snapshot: TimelineRenderSnapshot<
    Layout,
    Frames,
    Rows,
    RunFrame,
    ChainFrame,
    Axis
  >,
): void => {
  if (snapshot.view.sceneGenerationId !== snapshot.scene.generationId) {
    throw new Error('Timeline view does not belong to the source scene.');
  }
  if (snapshot.projection.viewId !== snapshot.view.id) {
    throw new Error('Timeline projection does not belong to the view.');
  }
  if (
    snapshot.presentation.sceneGenerationId !== snapshot.scene.generationId ||
    snapshot.presentation.viewId !== snapshot.view.id ||
    snapshot.presentation.projectionId !== snapshot.projection.id
  ) {
    throw new Error(
      'Timeline presentation does not belong to the render inputs.',
    );
  }
  for (const block of snapshot.presentation.activeBlocks) {
    if (
      block.viewId !== snapshot.view.id ||
      block.projectionId !== snapshot.projection.id
    ) {
      throw new Error('Timeline block does not belong to the render inputs.');
    }
  }
};

export type TimelineCoordinatorStatus = Readonly<{
  epoch: number;
  state: 'idle' | 'preparing' | 'committed';
}>;

export class StableTimelineBlockIdentities {
  private readonly identities = new Map<string, object>();

  get(key: string): object {
    let identity = this.identities.get(key);
    if (!identity) {
      identity = Object.freeze({});
      this.identities.set(key, identity);
    }
    return identity;
  }
}

export class TimelineCoordinator<Render extends { requestEpoch: number }> {
  private epoch = 0;
  private controller: AbortController | null = null;
  private releases: readonly (() => void)[] = [];
  private render: Render | null = null;
  private status: TimelineCoordinatorStatus = Object.freeze({
    epoch: 0,
    state: 'idle',
  });

  constructor(
    private readonly publish: (render: Render) => void,
    private readonly publishStatus?: (
      status: TimelineCoordinatorStatus,
    ) => void,
    private readonly cancelAnimations?: () => void,
  ) {}

  get committedRender(): Render | null {
    return this.render;
  }

  get requestStatus(): TimelineCoordinatorStatus {
    return this.status;
  }

  begin(): Readonly<{ epoch: number; signal: AbortSignal }> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const epoch = ++this.epoch;
    this.setStatus(epoch, 'preparing');
    return Object.freeze({ epoch, signal: controller.signal });
  }

  isCurrent(request: { epoch: number; signal: AbortSignal }): boolean {
    return request.epoch === this.epoch && !request.signal.aborted;
  }

  commit(
    request: { epoch: number; signal: AbortSignal },
    render: Render,
    releases: readonly (() => void)[] = [],
  ): boolean {
    if (!this.isCurrent(request) || render.requestEpoch !== request.epoch) {
      for (const release of releases) release();
      return false;
    }
    const previousReleases = this.releases;
    this.cancelAnimations?.();
    this.render = render;
    this.releases = Object.freeze([...releases]);
    this.publish(render);
    this.setStatus(request.epoch, 'committed');
    queueMicrotask(() => {
      if (this.render === render) {
        for (const release of previousReleases) release();
      }
    });
    return true;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.epoch += 1;
    this.setStatus(this.epoch, 'idle');
  }

  dispose(): void {
    this.cancel();
    for (const release of this.releases) release();
    this.releases = [];
    this.render = null;
  }

  private setStatus(
    epoch: number,
    state: TimelineCoordinatorStatus['state'],
  ): void {
    this.status = Object.freeze({ epoch, state });
    this.publishStatus?.(this.status);
  }
}
