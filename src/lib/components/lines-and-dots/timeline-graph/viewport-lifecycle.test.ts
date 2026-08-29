import { describe, expect, it } from 'vitest';

import { syncTimelineViewport } from './viewport-lifecycle';

import { Viewport } from './viewport.svelte';

const sync = (
  viewport: Viewport,
  options: {
    paused: boolean;
    workflowIsLive?: boolean;
    total: number;
    displayMode?: 'fixed-window' | 'full-duration';
  },
) =>
  syncTimelineViewport({
    viewport,
    displayMode: options.displayMode ?? 'fixed-window',
    paused: options.paused,
    workflowIsLive: options.workflowIsLive ?? true,
    totalWorldWidthPx: options.total,
  });

describe('syncTimelineViewport', () => {
  it('follows a running workflow at the right edge', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });

    sync(viewport, { paused: false, total: 260 });

    expect(viewport.offsetPx).toBe(160);
    expect(viewport.isFollowing).toBe(true);
  });

  it('freezes a live workflow while auto-refresh is paused', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });

    sync(viewport, { paused: true, total: 200 });
    viewport.setTotalWorldWidth(260);

    expect(viewport.offsetPx).toBe(100);
    expect(viewport.isFollowing).toBe(false);
  });

  it('resumes at the latest right edge', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });
    sync(viewport, { paused: true, total: 200 });
    viewport.setTotalWorldWidth(260);

    sync(viewport, { paused: false, total: 260 });

    expect(viewport.offsetPx).toBe(160);
    expect(viewport.isFollowing).toBe(true);
  });

  it('anchors a completed workflow at its final edge even if paused', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });
    sync(viewport, { paused: true, total: 200 });

    sync(viewport, { paused: true, workflowIsLive: false, total: 280 });

    expect(viewport.offsetPx).toBe(180);
    expect(viewport.isFollowing).toBe(true);
  });

  it('anchors full-duration timelines at zero when content exceeds the viewport', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });

    sync(viewport, {
      paused: false,
      total: 280,
      displayMode: 'full-duration',
    });

    expect(viewport.offsetPx).toBe(0);
    expect(viewport.totalWorldWidthPx).toBe(280);
    expect(viewport.isFollowing).toBe(false);
  });

  it('resumes right-edge following when switching back to fixed-window mode', () => {
    const viewport = new Viewport({ widthPx: 100, totalWorldWidthPx: 200 });
    sync(viewport, {
      paused: false,
      total: 280,
      displayMode: 'full-duration',
    });

    sync(viewport, { paused: false, total: 320 });

    expect(viewport.offsetPx).toBe(220);
    expect(viewport.isFollowing).toBe(true);
  });
});
