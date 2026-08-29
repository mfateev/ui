import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Timespan } from './timespan';
import type { TimeSegment } from './types';

import { TimelineScale } from './timeline-scale.svelte';
import type { Timeline } from './timeline.svelte';

function makeScale({
  segments,
  collapsedKeys = [],
  widthPx = 200,
  expandedDurationPerViewportMs = 100,
}: {
  segments: TimeSegment[];
  collapsedKeys?: string[];
  widthPx?: number;
  expandedDurationPerViewportMs?: number;
}) {
  const collapsed = new Set(collapsedKeys);
  let viewportWidthPx = $state(widthPx);
  const timeline = {
    segments,
    isTimeSegmentCollapsed: (segment: TimeSegment) =>
      collapsed.has(segment.timespan.key),
    isTimeSegmentCollapsible: (segment: TimeSegment) =>
      segment.kind === 'inactive',
  } as unknown as Timeline;
  const scale = new TimelineScale({
    timeline,
    getViewportWidthPx: () => viewportWidthPx,
    getExpandedDurationPerViewportMs: () => expandedDurationPerViewportMs,
  });

  return {
    scale,
    setViewportWidthPx: (value: number) => {
      viewportWidthPx = value;
    },
  };
}

function segment(
  startTimeMs: number,
  endTimeMs: number,
  kind: TimeSegment['kind'] = 'active',
): TimeSegment {
  return { kind, timespan: new Timespan(startTimeMs, endTimeMs) };
}

describe('TimelineScale', () => {
  it('projects and unprojects across the drawable width', () => {
    const cleanup = $effect.root(() => {
      const { scale } = makeScale({ segments: [segment(0, 100)] });

      expect(scale.project(25)).toBe(50);
      expect(scale.project(75)).toBe(150);
      expect(scale.unproject(50)).toBe(25);
      expect(scale.unproject(150)).toBe(75);
    });
    cleanup();
  });

  it('reserves a fixed width for collapsed idle gaps', () => {
    const cleanup = $effect.root(() => {
      const idle = segment(20, 80, 'inactive');
      const { scale } = makeScale({
        segments: [segment(0, 20), idle, segment(80, 100)],
        collapsedKeys: [idle.timespan.key],
      });

      expect(scale.project(20)).toBe(40);
      expect(scale.project(50)).toBe(64);
      expect(scale.project(80)).toBe(88);
      expect(scale.unproject(64)).toBe(50);
      expect(scale.segments[1].endPx - scale.segments[1].startPx).toBe(48);
    });
    cleanup();
  });

  it('handles a zero-duration workflow', () => {
    const cleanup = $effect.root(() => {
      const { scale } = makeScale({ segments: [segment(50, 50)] });

      expect(scale.project(0)).toBe(0);
      expect(scale.project(50)).toBe(0);
      expect(scale.project(100)).toBe(0);
      expect(scale.unproject(-100)).toBe(50);
      expect(scale.unproject(100)).toBe(50);
    });
    cleanup();
  });

  it('clamps times and pixels outside the scale', () => {
    const cleanup = $effect.root(() => {
      const { scale } = makeScale({ segments: [segment(10, 110)] });

      expect(scale.project(-1_000)).toBe(0);
      expect(scale.project(1_000)).toBe(200);
      expect(scale.unproject(-1_000)).toBe(10);
      expect(scale.unproject(1_000)).toBe(110);
    });
    cleanup();
  });

  it('reprojects proportionally after a resize', () => {
    const cleanup = $effect.root(() => {
      const { scale, setViewportWidthPx } = makeScale({
        segments: [segment(0, 100)],
      });

      expect(scale.project(50)).toBe(100);

      setViewportWidthPx(400);
      flushSync();

      expect(scale.project(50)).toBe(200);
      expect(scale.unproject(200)).toBe(50);
    });
    cleanup();
  });

  it('maps one minute of expanded time to one viewport width', () => {
    const cleanup = $effect.root(() => {
      const { scale } = makeScale({
        segments: [segment(0, 120_000)],
        widthPx: 600,
        expandedDurationPerViewportMs: 60_000,
      });

      expect(scale.expandedPxPerMs).toBe(0.01);
      expect(scale.project(60_000)).toBe(600);
      expect(scale.totalWorldWidthPx).toBe(1_200);
    });
    cleanup();
  });

  it('adds collapsed widths independently of expanded duration', () => {
    const cleanup = $effect.root(() => {
      const idle = segment(60_000, 120_000, 'inactive');
      const { scale } = makeScale({
        segments: [segment(0, 60_000), idle, segment(120_000, 180_000)],
        collapsedKeys: [idle.timespan.key],
        widthPx: 600,
        expandedDurationPerViewportMs: 60_000,
      });

      expect(scale.segments[0].endPx).toBe(600);
      expect(scale.segments[1].endPx - scale.segments[1].startPx).toBe(48);
      expect(scale.totalWorldWidthPx).toBe(1_248);
    });
    cleanup();
  });

  it('stops live-edge interpolation while the final segment is collapsed', () => {
    const cleanup = $effect.root(() => {
      const idle = segment(60_000, 120_000, 'inactive');
      const { scale } = makeScale({
        segments: [segment(0, 60_000), idle],
        collapsedKeys: [idle.timespan.key],
        widthPx: 600,
        expandedDurationPerViewportMs: 60_000,
      });

      expect(scale.liveEdgePxPerMs).toBe(0);
    });
    cleanup();
  });

  it('uses the expanded rate while the final segment is active', () => {
    const cleanup = $effect.root(() => {
      const { scale } = makeScale({
        segments: [segment(0, 60_000)],
        widthPx: 600,
        expandedDurationPerViewportMs: 60_000,
      });

      expect(scale.liveEdgePxPerMs).toBe(0.01);
    });
    cleanup();
  });

  it('recalculates world coordinates deterministically after resizing', () => {
    const cleanup = $effect.root(() => {
      const idle = segment(60_000, 120_000, 'inactive');
      const { scale, setViewportWidthPx } = makeScale({
        segments: [segment(0, 60_000), idle, segment(120_000, 180_000)],
        collapsedKeys: [idle.timespan.key],
        widthPx: 600,
        expandedDurationPerViewportMs: 60_000,
      });

      expect(scale.segments.map(({ endPx }) => endPx)).toEqual([
        600, 648, 1_248,
      ]);

      setViewportWidthPx(300);
      flushSync();

      expect(scale.segments.map(({ endPx }) => endPx)).toEqual([300, 348, 648]);
      expect(scale.project(60_000)).toBe(300);
      expect(scale.unproject(300)).toBe(60_000);
    });
    cleanup();
  });
});
