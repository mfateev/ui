export const TIMELINE_NORMAL_SCROLL_LIMIT_PX = 4_000_000;
export const TIMELINE_SEGMENTED_SCROLL_HEIGHT_PX = 8_000_000;

export type TimelineSegmentedScrollModel = {
  segmented: boolean;
  totalRows: number;
  rowHeightPx: number;
  physicalRowCapacity: number;
  physicalHeightPx: number;
};

export type TimelineScrollPosition = {
  originRow: number;
  scrollTop: number;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const getTimelineSegmentedScrollModel = ({
  totalRows,
  rowHeightPx,
  forceSegmented = false,
}: {
  totalRows: number;
  rowHeightPx: number;
  forceSegmented?: boolean;
}): TimelineSegmentedScrollModel => {
  const logicalHeightPx = Math.max(0, totalRows * rowHeightPx);
  const segmented =
    forceSegmented || logicalHeightPx > TIMELINE_NORMAL_SCROLL_LIMIT_PX;
  const physicalHeightPx = segmented
    ? Math.min(TIMELINE_SEGMENTED_SCROLL_HEIGHT_PX, logicalHeightPx)
    : logicalHeightPx;
  return {
    segmented,
    totalRows,
    rowHeightPx,
    physicalRowCapacity: Math.max(
      1,
      Math.floor(physicalHeightPx / rowHeightPx),
    ),
    physicalHeightPx,
  };
};

const maximumOrigin = (model: TimelineSegmentedScrollModel): number =>
  Math.max(0, model.totalRows - model.physicalRowCapacity);

export const physicalYForLogicalRow = (
  model: TimelineSegmentedScrollModel,
  originRow: number,
  logicalRow: number,
): number =>
  (logicalRow - (model.segmented ? originRow : 0)) * model.rowHeightPx;

export const revealTimelineLogicalRow = ({
  model,
  originRow,
  logicalRow,
  viewportHeightPx,
}: {
  model: TimelineSegmentedScrollModel;
  originRow: number;
  logicalRow: number;
  viewportHeightPx: number;
}): TimelineScrollPosition => {
  if (!model.segmented) {
    return {
      originRow: 0,
      scrollTop: clamp(
        logicalRow * model.rowHeightPx - viewportHeightPx / 2,
        0,
        Math.max(0, model.physicalHeightPx - viewportHeightPx),
      ),
    };
  }
  const visibleStart = originRow;
  const visibleEnd = originRow + model.physicalRowCapacity;
  const nextOrigin =
    logicalRow >= visibleStart && logicalRow < visibleEnd
      ? originRow
      : clamp(
          Math.round(logicalRow - model.physicalRowCapacity / 2),
          0,
          maximumOrigin(model),
        );
  return {
    originRow: nextOrigin,
    scrollTop: clamp(
      (logicalRow - nextOrigin) * model.rowHeightPx - viewportHeightPx / 2,
      0,
      Math.max(0, model.physicalHeightPx - viewportHeightPx),
    ),
  };
};

/** Rebase around the viewport anchor without moving any visible logical row. */
export const rebaseTimelineScroll = ({
  model,
  originRow,
  scrollTop,
  viewportHeightPx,
}: {
  model: TimelineSegmentedScrollModel;
  originRow: number;
  scrollTop: number;
  viewportHeightPx: number;
}): TimelineScrollPosition => {
  if (!model.segmented) return { originRow: 0, scrollTop };
  const maximumScrollTop = Math.max(
    0,
    model.physicalHeightPx - viewportHeightPx,
  );
  if (scrollTop <= 1 && originRow > 0) {
    return revealTimelineLogicalRow({
      model,
      originRow,
      logicalRow: 0,
      viewportHeightPx,
    });
  }
  if (scrollTop >= maximumScrollTop - 1) {
    return revealTimelineLogicalRow({
      model,
      originRow,
      logicalRow: model.totalRows - 1,
      viewportHeightPx,
    });
  }
  const firstQuarter = model.physicalHeightPx / 4;
  const lastQuarter = (model.physicalHeightPx * 3) / 4;
  const canMoveBackward = originRow > 0;
  const canMoveForward = originRow < maximumOrigin(model);
  if (
    !(scrollTop < firstQuarter && canMoveBackward) &&
    !(scrollTop + viewportHeightPx > lastQuarter && canMoveForward)
  ) {
    return { originRow, scrollTop };
  }

  const viewportAnchorPx = scrollTop + viewportHeightPx / 2;
  const anchorLogicalRow = originRow + viewportAnchorPx / model.rowHeightPx;
  const nextOrigin = clamp(
    Math.round(anchorLogicalRow - model.physicalRowCapacity / 2),
    0,
    maximumOrigin(model),
  );
  return {
    originRow: nextOrigin,
    scrollTop:
      (anchorLogicalRow - nextOrigin) * model.rowHeightPx -
      viewportHeightPx / 2,
  };
};
