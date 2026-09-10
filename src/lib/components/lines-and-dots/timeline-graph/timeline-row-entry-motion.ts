export const MAX_ANIMATED_TIMELINE_GROUPS = 1_000;

/**
 * Row-entry motion is presentation-only. Once a history is large, continually
 * rebuilding its complete key list is unnecessary work and the settle delay can
 * starve a busy live window: new rows remain hidden while events keep arriving.
 * Large histories therefore update the virtual row pool without entry motion.
 * Multi-run scenes also commit without per-row motion so activities cannot
 * temporarily escape the run and chain frames that group them.
 */
export const shouldAnimateTimelineRowEntries = ({
  totalGroupCount,
  layoutRowCount,
  runCount = 1,
}: {
  totalGroupCount: number;
  layoutRowCount: number;
  runCount?: number;
}): boolean =>
  runCount <= 1 &&
  totalGroupCount <= MAX_ANIMATED_TIMELINE_GROUPS &&
  layoutRowCount <= MAX_ANIMATED_TIMELINE_GROUPS;

/**
 * Only entries arriving from the live edge slide in from the right border.
 * The translated element spans the complete clipped graph, including the
 * gutters outside the time rails. Moving it by only the distance between the
 * rails leaves the leading gutter visible inside the graph on the first frame.
 * Move it by the full graph width so its outer left edge starts exactly at the
 * clipping border and every painted descendant enters through that border.
 * Recursive history loading can add completed predecessor runs after the first
 * paint; those are backfill, not live activity, and must render in place.
 */
export const getTimelineHorizontalEntryOffset = ({
  isNew,
  active,
  viewportWidthPx,
}: {
  isNew: boolean;
  active: boolean;
  viewportWidthPx: number;
}): number => {
  if (!isNew || !active) return 0;
  return Math.max(0, viewportWidthPx);
};

/**
 * Existing activity rows only move vertically when the layout admits new
 * history; newly inserted live entries can also carry horizontal motion.
 *
 * Reading `getComputedStyle().translate` while an interrupted Web Animation is
 * still contributing to the element can include that animation's old x value.
 * Carrying the complete value into a vertical-only replacement animation makes
 * a completed activity sweep across the timeline. Entries intentionally moving
 * in from the right rail retain both axes; vertical-only rows discard x while
 * preserving their current visual y.
 */
export const getTimelineEntryAnimationStartTranslate = ({
  computedTranslate,
  preserveHorizontal,
}: {
  computedTranslate: string;
  preserveHorizontal: boolean;
}): string | undefined => {
  const normalized = computedTranslate.trim();
  if (!normalized || normalized === 'none') return undefined;
  if (preserveHorizontal) return normalized;

  const components = normalized.split(/\s+/);
  const y = components.length > 1 ? Number.parseFloat(components.at(-1)!) : 0;
  if (!Number.isFinite(y)) return undefined;
  return `0px ${y}px`;
};

/**
 * Return only the visual Y displacement contributed by an in-flight entry
 * animation. The computed `translate` property serializes an X-only translate
 * as a single value. Treating that value as Y feeds the right-entry distance
 * back into the next FLIP layout pass and makes a later run enter diagonally
 * from the bottom-right.
 */
export const getTimelineEntryVisualYOffset = (
  computedTranslate: string,
): number => {
  const normalized = computedTranslate.trim();
  if (!normalized || normalized === 'none') return 0;
  const components = normalized.split(/\s+/);
  if (components.length < 2) return 0;
  const y = Number.parseFloat(components.at(-1)!);
  return Number.isFinite(y) ? y : 0;
};

export type TimelineFrameGrowthMotion = {
  bottomOffsetPx: number;
  clipInsetPx: number;
};

/**
 * Describe the compositor-only motion needed to grow an existing frame from
 * its currently painted bottom to its next layout bottom. The new geometry is
 * committed immediately, then clipped and offset back to the old visual edge;
 * both values animate to zero on the same clock as the entering row.
 */
export const getTimelineFrameGrowthMotion = ({
  previousBottomPx,
  currentBottomPx,
}: {
  previousBottomPx: number;
  currentBottomPx: number;
}): TimelineFrameGrowthMotion | null => {
  const growthPx = currentBottomPx - previousBottomPx;
  if (!Number.isFinite(growthPx) || growthPx <= 0) return null;
  return {
    bottomOffsetPx: -growthPx,
    clipInsetPx: growthPx,
  };
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
