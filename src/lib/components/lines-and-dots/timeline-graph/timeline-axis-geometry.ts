import type { PixelRange } from './viewport-geometry';

export interface TimelineAxisTick {
  screenPx: number;
  worldPx: number;
}

interface TimelineAxisTickOptions {
  screenStartPx: number;
  screenEndPx: number;
  gutterPx: number;
  viewportOffsetPx: number;
  collapsedWorldRanges: PixelRange[];
  targetTickPx?: number;
  minTicks?: number;
  maxTicks?: number;
}

export function screenToTimelineWorld(
  screenPx: number,
  gutterPx: number,
  viewportOffsetPx: number,
): number {
  return screenPx - gutterPx + viewportOffsetPx;
}

export function getTimelineAxisTicks({
  screenStartPx,
  screenEndPx,
  gutterPx,
  viewportOffsetPx,
  collapsedWorldRanges,
  targetTickPx = 60,
  minTicks = 2,
  maxTicks = 40,
}: TimelineAxisTickOptions): TimelineAxisTick[] {
  const screenDistancePx = Math.max(0, screenEndPx - screenStartPx);
  const tickCount = Math.min(
    maxTicks,
    Math.max(minTicks, Math.round(screenDistancePx / targetTickPx)),
  );
  const worldStartPx = screenToTimelineWorld(
    screenStartPx,
    gutterPx,
    viewportOffsetPx,
  );
  const worldDistancePx = screenDistancePx;
  const tickDistancePx = worldDistancePx / tickCount;

  return Array.from({ length: tickCount }, (_, index) => {
    const worldPx = worldStartPx + index * tickDistancePx;
    return {
      worldPx,
      screenPx: screenStartPx + index * tickDistancePx,
    };
  }).filter(
    ({ worldPx }, index) =>
      index !== 0 &&
      !collapsedWorldRanges.some(
        ({ startPx, endPx }) => worldPx >= startPx && worldPx <= endPx,
      ),
  );
}
