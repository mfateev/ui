import { clipConnectorToViewport } from './viewport-geometry';

export interface WorkflowRowGeometry {
  line: { startPx: number; endPx: number } | null;
  startDotPx: number | null;
  endDotPx: number | null;
}

interface WorkflowRowGeometryOptions {
  startWorldPx: number;
  endWorldPx: number;
  viewportOffsetPx: number;
  viewportWidthPx: number;
  gutterPx: number;
  live?: boolean;
}

export function getWorkflowRowGeometry({
  startWorldPx,
  endWorldPx,
  viewportOffsetPx,
  viewportWidthPx,
  gutterPx,
  live = false,
}: WorkflowRowGeometryOptions): WorkflowRowGeometry {
  const viewport = { offsetPx: viewportOffsetPx, widthPx: viewportWidthPx };
  const clipped = clipConnectorToViewport(
    { startPx: startWorldPx, endPx: endWorldPx },
    viewport,
  );
  const isVisible = (worldPx: number) =>
    worldPx >= viewportOffsetPx &&
    worldPx <= viewportOffsetPx + viewportWidthPx;
  const toScreen = (worldPx: number) => worldPx - viewportOffsetPx + gutterPx;

  return {
    line: clipped
      ? {
          startPx: clipped.startPx + gutterPx,
          endPx: clipped.endPx + gutterPx,
        }
      : null,
    startDotPx: isVisible(startWorldPx) ? toScreen(startWorldPx) : null,
    endDotPx: !live && isVisible(endWorldPx) ? toScreen(endWorldPx) : null,
  };
}
