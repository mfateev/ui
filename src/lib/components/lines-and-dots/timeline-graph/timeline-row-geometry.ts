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

interface TimelineRowGeometryOptions {
  points: number[];
  viewportStartPx: number;
  viewportEndPx: number;
  isPending: boolean;
  hasPauseTime: boolean;
  haloPx: number;
}

export function getTimelineRowGeometry({
  points,
  viewportStartPx,
  viewportEndPx,
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
      { startPx: points[points.length - 1], endPx: viewportEndPx },
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

  return {
    connectors,
    dots,
    hitRange: {
      startPx: Math.max(viewportStartPx, Math.min(...geometryPoints) - haloPx),
      endPx: Math.min(viewportEndPx, Math.max(...geometryPoints) + haloPx),
    },
  };
}

export function isTimelineLabelVisible(
  xPx: number,
  viewportStartPx: number,
  viewportEndPx: number,
  hasVisiblePendingConnector = false,
): boolean {
  return (
    hasVisiblePendingConnector ||
    (xPx >= viewportStartPx && xPx <= viewportEndPx)
  );
}
