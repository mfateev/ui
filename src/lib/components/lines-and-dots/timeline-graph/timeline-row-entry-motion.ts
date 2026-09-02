export const MAX_ANIMATED_TIMELINE_GROUPS = 1_000;

/**
 * Row-entry motion is presentation-only. Once a history is large, continually
 * rebuilding its complete key list is unnecessary work and the settle delay can
 * starve a busy live window: new rows remain hidden while events keep arriving.
 * Large histories therefore update the virtual row pool without entry motion.
 */
export const shouldAnimateTimelineRowEntries = ({
  totalGroupCount,
  layoutRowCount,
}: {
  totalGroupCount: number;
  layoutRowCount: number;
}): boolean =>
  totalGroupCount <= MAX_ANIMATED_TIMELINE_GROUPS &&
  layoutRowCount <= MAX_ANIMATED_TIMELINE_GROUPS;

export const getTimelineRowEntryOffsets = (
  previousKeys: string[],
  currentKeys: string[],
  rowHeightPx: number,
  previousVisualOffsetsPx: ReadonlyMap<string, number> = new Map(),
): Map<string, number> => {
  const previousIndex = new Map(
    previousKeys.map((key, index) => [key, index] as const),
  );
  const offsets = new Map<string, number>();
  let nextExistingOffsetPx = -rowHeightPx;

  for (let index = currentKeys.length - 1; index >= 0; index--) {
    const key = currentKeys[index];
    const oldIndex = previousIndex.get(key);
    if (oldIndex !== undefined) {
      const offsetPx =
        (oldIndex - index) * rowHeightPx +
        (previousVisualOffsetsPx.get(key) ?? 0);
      nextExistingOffsetPx = offsetPx;
      if (offsetPx) offsets.set(key, offsetPx);
    } else {
      offsets.set(key, nextExistingOffsetPx);
    }
  }

  return offsets;
};

export const getTimelineFrameBoundaryOffset = ({
  offsets,
  topKey,
  bottomKey,
}: {
  offsets: ReadonlyMap<string, number>;
  topKey: string;
  bottomKey: string | undefined;
}): number =>
  (bottomKey ? (offsets.get(bottomKey) ?? 0) : 0) - (offsets.get(topKey) ?? 0);
