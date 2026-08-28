export interface PixelRange {
  startPx: number;
  endPx: number;
}

export interface PixelViewport {
  offsetPx: number;
  widthPx: number;
}

export function worldToScreen(worldPx: number, offsetPx: number): number {
  return worldPx - offsetPx;
}

export function intersectPixelRanges(
  range: PixelRange,
  visibleRange: PixelRange,
): PixelRange | null {
  const startPx = Math.max(range.startPx, visibleRange.startPx);
  const endPx = Math.min(range.endPx, visibleRange.endPx);

  return startPx <= endPx ? { startPx, endPx } : null;
}

export function clipConnectorToViewport(
  connector: PixelRange,
  viewport: PixelViewport,
): PixelRange | null {
  const visibleWorldRange = {
    startPx: viewport.offsetPx,
    endPx: viewport.offsetPx + viewport.widthPx,
  };
  const clipped = intersectPixelRanges(connector, visibleWorldRange);

  if (!clipped) return null;

  return {
    startPx: worldToScreen(clipped.startPx, viewport.offsetPx),
    endPx: worldToScreen(clipped.endPx, viewport.offsetPx),
  };
}
