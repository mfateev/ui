import type { TimelineDisplayMode } from './types';

import {
  DEFAULT_COLLAPSED_WIDTH_PX,
  DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS,
} from './timeline-scale.svelte';

export function expandedDurationPerViewportMs({
  displayMode,
  viewportWidthPx,
  expandedDurationMs,
  collapsedSegmentCount,
}: {
  displayMode: TimelineDisplayMode;
  viewportWidthPx: number;
  expandedDurationMs: number;
  collapsedSegmentCount: number;
}): number {
  if (displayMode === 'fixed-window') {
    return DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS;
  }

  const widthPx = Math.max(viewportWidthPx, 0);
  const availableExpandedPx = Math.max(
    widthPx - collapsedSegmentCount * DEFAULT_COLLAPSED_WIDTH_PX,
    0,
  );

  if (expandedDurationMs <= 0 || widthPx <= 0) {
    return DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS;
  }

  if (availableExpandedPx === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (expandedDurationMs * widthPx) / availableExpandedPx;
}
