import { clipConnectorToViewport } from './viewport-geometry';

export interface CollapsedSegmentWindow {
  hitRange: { startPx: number; endPx: number } | null;
  markerRange: { startPx: number; endPx: number } | null;
  zigzagRange: { startPx: number; endPx: number } | null;
  centerPx: number;
  centerVisible: boolean;
}

interface CollapsedSegmentWindowOptions {
  startWorldPx: number;
  endWorldPx: number;
  isCollapsed: boolean;
  viewportOffsetPx: number;
  viewportWidthPx: number;
  hitHalfWidthPx: number;
  zigzagHalfWidthPx: number;
}

export function getCollapsedSegmentWindow({
  startWorldPx,
  endWorldPx,
  isCollapsed,
  viewportOffsetPx,
  viewportWidthPx,
  hitHalfWidthPx,
  zigzagHalfWidthPx,
}: CollapsedSegmentWindowOptions): CollapsedSegmentWindow {
  const centerWorldPx = (startWorldPx + endWorldPx) / 2;
  const viewport = { offsetPx: viewportOffsetPx, widthPx: viewportWidthPx };
  const clip = (startPx: number, endPx: number) =>
    clipConnectorToViewport({ startPx, endPx }, viewport);

  return {
    hitRange: isCollapsed
      ? clip(centerWorldPx - hitHalfWidthPx, centerWorldPx + hitHalfWidthPx)
      : clip(startWorldPx, endWorldPx),
    markerRange: isCollapsed
      ? clip(centerWorldPx - hitHalfWidthPx, centerWorldPx + hitHalfWidthPx)
      : null,
    zigzagRange: isCollapsed
      ? clip(
          centerWorldPx - zigzagHalfWidthPx,
          centerWorldPx + zigzagHalfWidthPx,
        )
      : null,
    centerPx: centerWorldPx - viewportOffsetPx,
    centerVisible:
      centerWorldPx >= viewportOffsetPx &&
      centerWorldPx <= viewportOffsetPx + viewportWidthPx,
  };
}
