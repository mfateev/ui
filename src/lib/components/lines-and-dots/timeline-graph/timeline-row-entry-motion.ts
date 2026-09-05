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

/**
 * Only entries arriving from the live edge slide in from the right rail.
 * Recursive history loading can add completed predecessor runs after the first
 * paint; those are backfill, not live activity, and must render in place.
 */
export const getTimelineHorizontalEntryOffset = ({
  isNew,
  active,
  entryStartPx,
  rightRailPx,
}: {
  isNew: boolean;
  active: boolean;
  entryStartPx: number | undefined;
  rightRailPx: number;
}): number => {
  if (!isNew || !active || entryStartPx === undefined) return 0;
  return Math.max(0, rightRailPx - entryStartPx);
};

/**
 * Activity rows only move vertically when the layout admits new history.
 *
 * Reading `getComputedStyle().translate` while an interrupted Web Animation is
 * still contributing to the element can include that animation's old x value.
 * Carrying the complete value into the replacement animation makes a completed
 * activity sweep across the timeline. Frames intentionally retain both axes;
 * plain rows explicitly discard x while preserving their current visual y.
 */
export const getTimelineEntryAnimationStartTranslate = ({
  computedTranslate,
  frame,
}: {
  computedTranslate: string;
  frame: boolean;
}): string | undefined => {
  const normalized = computedTranslate.trim();
  if (!normalized || normalized === 'none') return undefined;
  if (frame) return normalized;

  const components = normalized.split(/\s+/);
  const y = components.length > 1 ? Number.parseFloat(components.at(-1)!) : 0;
  if (!Number.isFinite(y)) return undefined;
  return `0px ${y}px`;
};

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

  for (let index = currentKeys.length - 1; index >= 0; index--) {
    const key = currentKeys[index];
    const oldIndex = previousIndex.get(key);
    if (oldIndex !== undefined) {
      const offsetPx =
        (oldIndex - index) * rowHeightPx +
        (previousVisualOffsetsPx.get(key) ?? 0);
      if (offsetPx) offsets.set(key, offsetPx);
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
