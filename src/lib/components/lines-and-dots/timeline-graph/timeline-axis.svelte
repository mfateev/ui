<script lang="ts">
  import type { Timestamp } from '$lib/types';
  import { formatDistanceAbbreviated } from '$lib/utilities/format-time';

  import { RADIUS } from './constants';
  import {
    getTimelineAxisTicks,
    screenToTimelineWorld,
  } from './timeline-axis-geometry';

  import type { TimelineScale } from './timeline-scale.svelte';

  type Props = {
    x1: number;
    x2: number;
    gutter: number;
    timelineHeight: number;
    startTime: string | Timestamp;
    scale: TimelineScale;
    viewportOffsetPx: number;
  };
  let {
    x1 = 0,
    x2 = 1000,
    gutter = 0,
    timelineHeight = 1000,
    startTime,
    scale,
    viewportOffsetPx = 0,
  }: Props = $props();

  const TARGET_TICK_PX = 60;
  const MIN_TICKS = 2;
  const MAX_TICKS = 40;

  const distance = $derived(x2 - x1);
  const tickCount = $derived(
    Math.min(
      MAX_TICKS,
      Math.max(MIN_TICKS, Math.round(distance / TARGET_TICK_PX)),
    ),
  );
  const startWorldPx = $derived(
    screenToTimelineWorld(x1, gutter, viewportOffsetPx),
  );
  const endWorldPx = $derived(
    screenToTimelineWorld(x2, gutter, viewportOffsetPx),
  );
  const startMs = $derived(scale.unproject(startWorldPx));
  const endMs = $derived(scale.unproject(endWorldPx));
  const includeMilliseconds = $derived((endMs - startMs) / tickCount < 1000);

  const collapsedWorldRanges = $derived(
    scale.segments
      .filter((segment) => segment.isCollapsed)
      .map((segment) => ({
        startPx: segment.startPx,
        endPx: segment.endPx,
      })),
  );
  const ticks = $derived(
    getTimelineAxisTicks({
      screenStartPx: x1,
      screenEndPx: x2,
      gutterPx: gutter,
      viewportOffsetPx,
      collapsedWorldRanges,
      targetTickPx: TARGET_TICK_PX,
      minTicks: MIN_TICKS,
      maxTicks: MAX_TICKS,
    }),
  );

  const baselineWidth = RADIUS / 2;
</script>

<!-- baseline -->
<div
  class="baseline"
  style:left="{x1}px"
  style:top="{timelineHeight - baselineWidth / 2}px"
  style:width="{distance}px"
  style:height="{baselineWidth}px"
></div>

{#each ticks as tick (tick.worldPx)}
  <div
    class="grid-line top-0"
    style:left="{tick.screenPx}px"
    style:height="{timelineHeight}px"
  ></div>
  <div
    class="tick-label"
    style:left="{tick.screenPx}px"
    style:top="{timelineHeight + RADIUS}px"
  >
    {formatDistanceAbbreviated({
      start: startTime,
      end: new Date(scale.unproject(tick.worldPx)),
      includeMilliseconds,
    })}
  </div>
{/each}

<style lang="postcss">
  .baseline {
    position: absolute;
    background: currentColor;
  }

  .grid-line {
    position: absolute;
    width: 1px;
    opacity: 0.3;

    /* Solid fill, not a dashed border or gradient: the timeline can be tens of
       thousands of px tall. A dashed border makes Chromium rasterize thousands
       of dash segments (huge GPU textures → jank); a gradient fill exceeds
       WebKit's backing-store height and vanishes in Safari. A solid fill is
       cheap and renders at any height in both. */
    background: rgb(var(--color-text-primary));
  }

  .tick-label {
    position: absolute;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    transform: rotate(45deg);
    transform-origin: left center;
    pointer-events: none;
  }
</style>
