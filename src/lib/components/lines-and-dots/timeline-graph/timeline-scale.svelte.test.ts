import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Timespan } from './timespan';
import type { TimeSegment } from './types';

import { TimelineScale } from './timeline-scale.svelte';
import type { Timeline } from './timeline.svelte';
import { Viewport } from './viewport.svelte';

function makeScale({
  segments,
  collapsedKeys = [],
  widthPx = 200,
}: {
  segments: TimeSegment[];
  collapsedKeys?: string[];
  widthPx?: number;
}) {
  const collapsed = new Set(collapsedKeys);
  const timeline = {
    segments,
    isTimeSegmentCollapsed: (segment: TimeSegment) =>
      collapsed.has(segment.timespan.key),
    isTimeSegmentCollapsible: (segment: TimeSegment) =>
      segment.kind === 'inactive',
  } as unknown as Timeline;
  const viewport = new Viewport({ startTimeMs: 0, endTimeMs: 0, widthPx });
  const scale = new TimelineScale({ timeline, viewport });

  return { scale, viewport };
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

      expect(scale.project(20)).toBe(76);
      expect(scale.project(50)).toBe(100);
      expect(scale.project(80)).toBe(124);
      expect(scale.unproject(100)).toBe(50);
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
      const { scale, viewport } = makeScale({
        segments: [segment(0, 100)],
      });

      expect(scale.project(50)).toBe(100);

      viewport.setSize(400, 0);
      flushSync();

      expect(scale.project(50)).toBe(200);
      expect(scale.unproject(200)).toBe(50);
    });
    cleanup();
  });
});
