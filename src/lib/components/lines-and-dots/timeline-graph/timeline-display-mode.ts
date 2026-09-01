import type { TimelineDisplayMode, TimeSegment } from './types';

import {
  DEFAULT_COLLAPSED_WIDTH_PX,
  DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS,
} from './timeline-scale.svelte';

export const DEFAULT_TIMELINE_DISPLAY_MODE: TimelineDisplayMode =
  'full-duration';

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

export function fixedWindowScaleDurationMs({
  viewportWidthPx,
  windowStartTimeMs,
  windowDurationMs,
  segments,
  isCollapsed,
}: {
  viewportWidthPx: number;
  windowStartTimeMs: number;
  windowDurationMs: number;
  segments: TimeSegment[];
  isCollapsed: (segment: TimeSegment) => boolean;
}): number {
  const windowEndTimeMs = windowStartTimeMs + windowDurationMs;
  let expandedDurationMs = 0;
  let coveredDurationMs = 0;
  let collapsedWidthPx = 0;

  for (const segment of segments) {
    const overlapMs = Math.max(
      0,
      Math.min(segment.timespan.endTimeMs, windowEndTimeMs) -
        Math.max(segment.timespan.startTimeMs, windowStartTimeMs),
    );
    if (overlapMs === 0) continue;
    coveredDurationMs += overlapMs;

    if (isCollapsed(segment)) {
      const segmentDurationMs = Math.max(segment.timespan.durationMs, 1);
      collapsedWidthPx +=
        DEFAULT_COLLAPSED_WIDTH_PX * (overlapMs / segmentDurationMs);
    } else {
      expandedDurationMs += overlapMs;
    }
  }

  expandedDurationMs += Math.max(0, windowDurationMs - coveredDurationMs);

  const widthPx = Math.max(viewportWidthPx, 0);
  const availableExpandedPx = Math.max(widthPx - collapsedWidthPx, 0);
  if (expandedDurationMs <= 0 || widthPx <= 0) return windowDurationMs;
  if (availableExpandedPx === 0) return Number.POSITIVE_INFINITY;
  return (expandedDurationMs * widthPx) / availableExpandedPx;
}
