import type { TimelineDisplayMode } from './types';

import type { Viewport } from './viewport.svelte';

interface TimelineViewportLifecycleOptions {
  viewport: Viewport;
  displayMode: TimelineDisplayMode;
  paused: boolean;
  workflowIsLive: boolean;
  totalWorldWidthPx: number;
}

export function syncTimelineViewport({
  viewport,
  displayMode,
  paused,
  workflowIsLive,
  totalWorldWidthPx,
}: TimelineViewportLifecycleOptions): void {
  if (displayMode === 'full-duration') {
    viewport.freeze();
    viewport.setGeometry({
      widthPx: viewport.widthPx,
      totalWorldWidthPx,
      anchoredOffsetPx: 0,
    });
    return;
  }

  if (displayMode === 'fixed-window' && paused && workflowIsLive) {
    viewport.freeze();
    return;
  }

  viewport.resume(totalWorldWidthPx);
}
