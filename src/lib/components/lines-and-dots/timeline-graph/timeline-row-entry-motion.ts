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
