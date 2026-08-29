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
  const worldEndPx = worldStartPx + screenDistancePx;
  const tickDistancePx = screenDistancePx / tickCount;
  if (tickDistancePx <= 0) return [];

  // Anchor ticks to the world origin. Deriving them from the viewport start
  // gives every tick a new world coordinate whenever following advances,
  // causing the entire grid to disappear and reappear on each coarse update.
  const firstTickIndex = Math.floor(worldStartPx / tickDistancePx) + 1;
  const endTickIndex = Math.ceil(worldEndPx / tickDistancePx);
  const visibleTickCount = Math.max(0, endTickIndex - firstTickIndex);

  return Array.from({ length: visibleTickCount }, (_, index) => {
    const worldPx = (firstTickIndex + index) * tickDistancePx;
    return {
      worldPx,
      screenPx: screenStartPx + worldPx - worldStartPx,
    };
  }).filter(
    ({ worldPx }) =>
      !collapsedWorldRanges.some(
        ({ startPx, endPx }) => worldPx >= startPx && worldPx <= endPx,
      ),
  );
}
