import { ROW_HEIGHT } from './constants';
import { clipConnectorToViewport } from './viewport-geometry';

export type WorkflowFrameGeometry = {
  horizontal: { startPx: number; endPx: number } | null;
  topPx: number;
  bottomPx: number;
  drawStartSide: boolean;
  drawEndSide: boolean;
  startDotPx: number | null;
  endDotPx: number | null;
  labelStartPx: number;
  labelMaxWidthPx: number;
};

export function getWorkflowFrameGeometry({
  startWorldPx,
  endWorldPx,
  viewportOffsetPx,
  viewportWidthPx,
  gutterPx,
  topPx,
  bottomPx,
  startBoundaryKnown,
  endBoundaryKnown,
  labelInsetPx,
}: {
  startWorldPx: number;
  endWorldPx: number;
  viewportOffsetPx: number;
  viewportWidthPx: number;
  gutterPx: number;
  topPx: number;
  bottomPx: number;
  startBoundaryKnown: boolean;
  endBoundaryKnown: boolean;
  labelInsetPx: number;
}): WorkflowFrameGeometry {
  const viewport = { offsetPx: viewportOffsetPx, widthPx: viewportWidthPx };
  const clipped = clipConnectorToViewport(
    { startPx: startWorldPx, endPx: endWorldPx },
    viewport,
  );
  const normalizedTop = Math.min(topPx, bottomPx);
  const normalizedBottom = Math.max(
    topPx,
    bottomPx,
    normalizedTop + ROW_HEIGHT,
  );
  if (!clipped) {
    return {
      horizontal: null,
      topPx: normalizedTop,
      bottomPx: normalizedBottom,
      drawStartSide: false,
      drawEndSide: false,
      startDotPx: null,
      endDotPx: null,
      labelStartPx: gutterPx,
      labelMaxWidthPx: 0,
    };
  }

  const viewportEndPx = viewportOffsetPx + viewportWidthPx;
  const startVisible =
    startWorldPx >= viewportOffsetPx && startWorldPx <= viewportEndPx;
  const endVisible =
    endWorldPx >= viewportOffsetPx && endWorldPx <= viewportEndPx;
  const startPx = clipped.startPx + gutterPx;
  const endPx = clipped.endPx + gutterPx;
  const drawStartSide = startBoundaryKnown && startVisible;
  const drawEndSide = endBoundaryKnown && endVisible;

  return {
    horizontal: { startPx, endPx },
    topPx: normalizedTop,
    bottomPx: normalizedBottom,
    drawStartSide,
    drawEndSide,
    startDotPx: drawStartSide
      ? startWorldPx - viewportOffsetPx + gutterPx
      : null,
    endDotPx:
      drawEndSide && endWorldPx !== startWorldPx
        ? endWorldPx - viewportOffsetPx + gutterPx
        : null,
    labelStartPx: startPx + labelInsetPx,
    labelMaxWidthPx: Math.max(0, endPx - startPx - 2 * labelInsetPx),
  };
}
