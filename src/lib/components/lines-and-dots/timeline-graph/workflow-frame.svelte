<script lang="ts">
  import type { DotColors } from '../colors';
  import { GUTTER, RADIUS } from './constants';
  import { dotBox } from './primitives';
  import type { WorkflowFrameGeometry } from './workflow-frame-geometry';

  interface Props {
    geometry: WorkflowFrameGeometry;
    label: string;
    accessibleName: string;
    color: string;
    colors: DotColors;
    live: boolean;
    kind: 'chain' | 'run';
    paint: 'background' | 'foreground';
    bandTop: number;
    bandHeight: number;
  }

  let {
    geometry,
    label,
    accessibleName,
    color,
    colors,
    live,
    kind,
    paint,
    bandTop,
    bandHeight,
  }: Props = $props();

  const bandBottom = $derived(bandTop + bandHeight);
  const paintTop = $derived(Math.max(geometry.topPx, bandTop));
  const paintBottom = $derived(Math.min(geometry.bottomPx, bandBottom));
  const paintHeight = $derived(Math.max(0, paintBottom - paintTop));
  const drawTop = $derived(
    geometry.topPx >= bandTop && geometry.topPx <= bandBottom,
  );
  const drawBottom = $derived(
    geometry.bottomPx >= bandTop && geometry.bottomPx <= bandBottom,
  );
  const showLabel = $derived(geometry.labelMaxWidthPx >= 48);
  const horizontalWidth = $derived(
    geometry.horizontal
      ? Math.max(0, geometry.horizontal.endPx - geometry.horizontal.startPx)
      : 0,
  );
  const visibleDotPoints = $derived(
    [
      geometry.startDotPx,
      geometry.endDotPx === geometry.startDotPx ? null : geometry.endDotPx,
    ].filter((point): point is number => point !== null),
  );
  let labelWidth = $state(0);
  const labelSafeInset = GUTTER + 1.5 * RADIUS;
  const labelLeft =
    'clamp(var(--workflow-label-attached-left), calc(var(--workflow-label-safe-inset) + var(--timeline-frame-offset, 0px)), var(--workflow-label-end-attached-left))';
  const labelEndAttachedLeft = $derived(
    geometry.horizontal
      ? geometry.horizontal.endPx - labelWidth - 2 * RADIUS
      : 0,
  );
</script>

{#if paint === 'foreground'}
  <div
    role="img"
    aria-label={accessibleName}
    data-frame-kind={kind}
    data-frame-identity
    class="pointer-events-none absolute inset-0"
  ></div>
{/if}

{#if geometry.horizontal && paintHeight > 0}
  <div
    aria-hidden="true"
    data-frame-kind={kind}
    data-frame-paint={paint}
    class="pointer-events-none absolute inset-0"
  >
    {#if paint === 'background'}
      <div
        class:frame-live-reveal={live}
        class="pointer-events-none absolute rounded"
        style:left="{geometry.horizontal.startPx}px"
        style:top="{paintTop}px"
        style:right={live ? '0' : undefined}
        style:width={live ? undefined : `${horizontalWidth}px`}
        style:height="{paintHeight}px"
        style:background={`color-mix(in srgb, ${color} 3%, transparent)`}
        style:--frame-committed-width="{horizontalWidth}px"
      ></div>
    {:else}
      {#if drawTop}
        <div
          class:frame-dashed={live}
          class:tl-line--animate={live}
          class:tl-line--dashed={live}
          class:tl-line--live={live}
          class:tl-line--viewport-clipped-start={live &&
            !geometry.drawStartSide}
          class="frame-edge pointer-events-none absolute"
          style:left="{geometry.horizontal.startPx}px"
          style:top="{geometry.topPx}px"
          style:right={live ? '0' : undefined}
          style:width={live ? undefined : `${horizontalWidth}px`}
          style:--frame-color={color}
          style:--tl-line-color={color}
          style:--tl-live-committed-width="{horizontalWidth}px"
        ></div>
      {/if}
      {#if drawBottom}
        <div
          class:frame-dashed={live}
          class:tl-line--animate={live}
          class:tl-line--dashed={live}
          class:tl-line--live={live}
          class="frame-edge pointer-events-none absolute"
          style:left="{geometry.horizontal.startPx}px"
          style:top="{geometry.bottomPx}px"
          style:right={live ? '0' : undefined}
          style:width={live ? undefined : `${horizontalWidth}px`}
          style:--frame-color={color}
          style:--tl-line-color={color}
          style:--tl-live-committed-width="{horizontalWidth}px"
        ></div>
      {/if}
      {#if geometry.drawStartSide}
        <div
          class:frame-side-dashed={live}
          class="frame-side pointer-events-none absolute"
          style:left="{geometry.horizontal.startPx}px"
          style:top="{paintTop}px"
          style:height="{paintHeight}px"
          style:--frame-color={color}
        ></div>
      {/if}
      {#if geometry.drawEndSide}
        <div
          class:frame-side-dashed={live}
          class="frame-side pointer-events-none absolute"
          style:left="{geometry.horizontal.endPx}px"
          style:top="{paintTop}px"
          style:height="{paintHeight}px"
          style:--frame-color={color}
        ></div>
      {/if}
      {#if showLabel && (kind === 'chain' ? drawBottom : drawTop)}
        <span
          class:workflow-run-label={kind === 'run'}
          class="pointer-events-none absolute z-10 inline-flex min-h-[var(--dot)] items-center truncate whitespace-nowrap rounded-full bg-[rgb(var(--color-surface-primary))] px-1.5 text-[13px] leading-none text-current"
          style:left={labelLeft}
          style:top="{kind === 'chain'
            ? geometry.bottomPx - RADIUS
            : geometry.topPx - RADIUS}px"
          style:max-width="{geometry.labelMaxWidthPx}px"
          style:--workflow-label-attached-left="{geometry.labelStartPx}px"
          style:--workflow-label-safe-inset="{labelSafeInset}px"
          style:--workflow-label-end-attached-left="{labelEndAttachedLeft}px"
          bind:clientWidth={labelWidth}>{label}</span
        >
      {/if}
      {#if drawTop}
        {#each visibleDotPoints as point (point)}
          {@const bounds = dotBox(point, geometry.topPx)}
          <div
            class="pointer-events-none absolute h-[var(--dot)] w-[var(--dot)] rounded-[var(--dot-r)] border-2 border-solid"
            style:left="{bounds.left}px"
            style:top="{bounds.top}px"
            style:border-color={colors.stroke}
            style:background={colors.fill}
          >
            <svg
              aria-hidden="true"
              class="absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 text-black"
              viewBox="0 0 24 24"><use href="#ti-workflow" /></svg
            >
          </div>
        {/each}
      {/if}
    {/if}
  </div>
{/if}

<style lang="postcss">
  .frame-edge {
    height: 1px;
    background: var(--frame-color);
  }

  .frame-side {
    width: 1px;
    background: var(--frame-color);
  }

  .frame-dashed {
    background: repeating-linear-gradient(
      to right,
      var(--frame-color) 0 4px,
      transparent 4px 8px
    );
  }

  .frame-side-dashed {
    background: repeating-linear-gradient(
      to bottom,
      var(--frame-color) 0 4px,
      transparent 4px 8px
    );
  }

  .frame-live-reveal {
    clip-path: inset(
      0
        calc(
          100% - var(--frame-committed-width) -
            var(--timeline-live-edge-extension, 0px)
        )
        0 0
    );
    will-change: clip-path;
  }
</style>
