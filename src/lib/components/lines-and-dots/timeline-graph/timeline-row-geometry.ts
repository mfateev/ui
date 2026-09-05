import { intersectPixelRanges } from './viewport-geometry';

export interface TimelineRowConnector {
  startPx: number;
  endPx: number;
  index: number;
  pending: boolean;
}

export interface TimelineRowDot {
  xPx: number;
  index: number;
}

export interface TimelineRowGeometry {
  connectors: TimelineRowConnector[];
  dots: TimelineRowDot[];
  hitRange: { startPx: number; endPx: number } | null;
}

export function mergeTimelineRowConnectors(
  connectors: TimelineRowConnector[],
): TimelineRowConnector[] {
  if (connectors.length < 2) return connectors;
  const first = connectors[0];
  const last = connectors.at(-1)!;
  return [
    {
      startPx: Math.min(...connectors.map(({ startPx }) => startPx)),
      endPx: Math.max(...connectors.map(({ endPx }) => endPx)),
      index: first.index,
      pending: last.pending,
    },
  ];
}

export function getTimelineDotAlignment({
  index,
  eventCount,
  pending,
  boundarySpanPx,
  markerSizePx,
  boundaryEndIndex = eventCount - 1,
  fanOutShortBoundaryMarkers = false,
  centerSingleMarker = false,
}: {
  index: number;
  eventCount: number;
  pending: boolean;
  boundarySpanPx?: number;
  markerSizePx?: number;
  boundaryEndIndex?: number;
  fanOutShortBoundaryMarkers?: boolean;
  centerSingleMarker?: boolean;
}): 'start' | 'center' | 'end' {
  if (centerSingleMarker && eventCount === 1) return 'center';
  if (
    boundarySpanPx !== undefined &&
    markerSizePx !== undefined &&
    boundarySpanPx < markerSizePx
  ) {
    if (fanOutShortBoundaryMarkers) {
      if (index === 0) return 'end';
      if (index === boundaryEndIndex) return 'start';
    }
    return 'center';
  }
  if (index === 0) return 'start';
  if (!pending && index === boundaryEndIndex) return 'end';
  return 'center';
}

export type TimelineDotRole =
  | 'start'
  | 'completion'
  | 'pending'
  | 'pause'
  | 'retained-pending';

export function getTimelineDotRole({
  index,
  eventCount,
  pointCount,
  pending,
  livePending,
  hasPauseTime,
  active,
  resolvedTerminal = false,
}: {
  index: number;
  eventCount: number;
  pointCount: number;
  pending: boolean;
  livePending: boolean;
  hasPauseTime: boolean;
  active: boolean;
  resolvedTerminal?: boolean;
}): TimelineDotRole | null {
  if (hasPauseTime && index === pointCount - 1 && index >= eventCount) {
    return 'pause';
  }
  if (index === 0) return 'start';
  if (resolvedTerminal && pointCount > eventCount && index === pointCount - 1) {
    return 'completion';
  }
  if (livePending && !hasPauseTime && index === pointCount - 1) {
    return 'pending';
  }
  if (!pending && index === eventCount - 1) return 'completion';
  if (!resolvedTerminal && !active && pending && index === eventCount - 1) {
    return 'retained-pending';
  }
  return null;
}

interface TimelineRowGeometryOptions {
  points: number[];
  viewportStartPx: number;
  viewportEndPx: number;
  pendingEndPx?: number;
  isPending: boolean;
  hasPauseTime: boolean;
  haloPx: number;
}

export function getTimelineRowGeometry({
  points,
  viewportStartPx,
  viewportEndPx,
  pendingEndPx,
  isPending,
  hasPauseTime,
  haloPx,
}: TimelineRowGeometryOptions): TimelineRowGeometry {
  const visibleRange = {
    startPx: viewportStartPx,
    endPx: viewportEndPx,
  };
  const connectors: TimelineRowConnector[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const clipped = intersectPixelRanges(
      { startPx: points[index], endPx: points[index + 1] },
      visibleRange,
    );
    if (clipped) {
      connectors.push({ ...clipped, index, pending: false });
    }
  }

  if (isPending && !hasPauseTime && points.length > 0) {
    const clipped = intersectPixelRanges(
      {
        startPx: points[points.length - 1],
        endPx: Math.max(
          points[points.length - 1],
          pendingEndPx ?? viewportEndPx,
        ),
      },
      visibleRange,
    );
    if (clipped) {
      connectors.push({
        ...clipped,
        index: points.length - 1,
        pending: true,
      });
    }
  }

  const dots = points.flatMap((xPx, index) =>
    xPx >= viewportStartPx && xPx <= viewportEndPx ? [{ xPx, index }] : [],
  );
  const geometryPoints = [
    ...dots.map(({ xPx }) => xPx),
    ...connectors.flatMap(({ startPx, endPx }) => [startPx, endPx]),
  ];

  if (geometryPoints.length === 0) {
    return { connectors, dots, hitRange: null };
  }

  let minimumPoint = Number.POSITIVE_INFINITY;
  let maximumPoint = Number.NEGATIVE_INFINITY;
  for (const point of geometryPoints) {
    if (point < minimumPoint) minimumPoint = point;
    if (point > maximumPoint) maximumPoint = point;
  }

  return {
    connectors,
    dots,
    hitRange: {
      startPx: Math.max(viewportStartPx, minimumPoint - haloPx),
      endPx: Math.min(viewportEndPx, maximumPoint + haloPx),
    },
  };
}

export function isTimelineLabelVisible(
  xPx: number,
  viewportStartPx: number,
  viewportEndPx: number,
  hasVisibleConnector = false,
): boolean {
  return (
    hasVisibleConnector || (xPx >= viewportStartPx && xPx <= viewportEndPx)
  );
}
