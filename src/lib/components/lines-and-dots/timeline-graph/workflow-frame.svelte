<script lang="ts">
  import { translate } from '$lib/i18n/translate';

  import type { DotColors } from '../colors';
  import { DOT_STROKE, GUTTER, RADIUS } from './constants';
  import { alignedDotBox } from './primitives';
  import type { WorkflowFrameGeometry } from './workflow-frame-geometry';

  interface Props {
    geometry: WorkflowFrameGeometry;
    label: string;
    workflowType?: string;
    accessibleName: string;
    color: string;
    colors: DotColors;
    live: boolean;
    kind: 'chain' | 'run';
    headerKind?: 'synthetic' | 'relationship';
    depth?: number;
    paint: 'background' | 'foreground';
    bandTop: number;
    bandHeight: number;
    entryOffsetPx?: number;
    entryKey?: string;
    bottomEntryOffsetPx?: number;
    entryPending?: boolean;
  }

  let {
    geometry,
    label,
    workflowType,
    accessibleName,
    color,
    colors,
    live,
    kind,
    headerKind = 'synthetic',
    depth = 0,
    paint,
    bandTop,
    bandHeight,
    entryOffsetPx = 0,
    entryKey,
    bottomEntryOffsetPx = 0,
    entryPending = false,
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
  const showLabel = $derived(
    geometry.horizontal !== null && (live || geometry.labelMaxWidthPx >= 48),
  );
  const horizontalWidth = $derived(
    geometry.horizontal
      ? Math.max(0, geometry.horizontal.endPx - geometry.horizontal.startPx)
      : 0,
  );
  const sidePaintHeight = $derived(
    paintHeight + (kind === 'chain' && drawBottom ? 2 : 0),
  );
  const visibleDots = $derived(
    [
      geometry.startDotPx === null
        ? null
        : { point: geometry.startDotPx, alignment: 'start' as const },
      geometry.endDotPx === null || geometry.endDotPx === geometry.startDotPx
        ? null
        : { point: geometry.endDotPx, alignment: 'end' as const },
    ].filter(
      (
        dot,
      ): dot is {
        point: number;
        alignment: 'start' | 'end';
      } => dot !== null,
    ),
  );
  let labelWidth = $state(0);
  const measureLabel = (element: HTMLElement) => {
    const observer = new ResizeObserver(([entry]) => {
      const width =
        entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
      labelWidth = Math.round(width);
    });
    observer.observe(element);
    return { destroy: () => observer.disconnect() };
  };
  const labelSafeInset = GUTTER + 1.5 * RADIUS;
  const labelIconGap = $derived(kind === 'chain' ? 12 : 0);
  const labelAttachedLeft = $derived(geometry.labelStartPx + labelIconGap);
  const labelEndAttachedLeft = $derived(
    geometry.horizontal
      ? geometry.horizontal.endPx -
          labelWidth -
          2 * (RADIUS + DOT_STROKE / 2) -
          labelIconGap
      : labelAttachedLeft,
  );
  const labelPinnedLeft =
    'max(var(--workflow-label-attached-left), calc(var(--workflow-label-safe-inset) + var(--timeline-frame-offset, 0px)))';
  const labelLeft = $derived(
    geometry.drawStartSide
      ? labelPinnedLeft
      : `min(${labelPinnedLeft}, var(--workflow-label-end-attached-left))`,
  );
  const labelWidthAdjustment = $derived(
    kind === 'chain' ? 2 * labelIconGap + DOT_STROKE : 0,
  );
  const labelMaxWidth = $derived(
    live
      ? 'none'
      : `${Math.max(0, geometry.labelMaxWidthPx - labelWidthAdjustment)}px`,
  );
  const displayLabel = $derived(
    `${translate(kind === 'chain' ? 'common.workflow-id' : 'common.run-id')}: ${label}${kind === 'chain' && workflowType ? ` · ${workflowType}` : ''}`,
  );
  const drawHeader = $derived(
    drawTop && (kind === 'run' || headerKind === 'synthetic'),
  );
  const frameBackground = $derived(
    kind === 'run'
      ? 'transparent'
      : `color-mix(in srgb, ${color} 3%, transparent)`,
  );
</script>

<div
  class="pointer-events-none absolute inset-0"
  class:timeline-frame-entering={entryOffsetPx !== 0}
  class:timeline-frame-entry-pending={entryPending}
  data-timeline-entry-offset={entryOffsetPx || undefined}
  data-timeline-entry-key={entryKey}
  data-timeline-frame-entry
  data-timeline-bottom-entry-offset={bottomEntryOffsetPx || undefined}
  style:--timeline-row-entry-offset={`${entryOffsetPx}px`}
  style:--workflow-header-radius={`${RADIUS}px`}
>
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
      data-frame-depth={kind === 'chain' ? depth : undefined}
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
          style:background={frameBackground}
          style:--frame-committed-width="{horizontalWidth}px"
        ></div>
      {:else}
        {#if drawHeader}
          <div
            class:frame-edge-chain-header={kind === 'chain'}
            class:frame-dashed={live && kind === 'run'}
            class:tl-line--animate={live && kind === 'run'}
            class:tl-line--dashed={live && kind === 'run'}
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
            class:timeline-frame-boundary-entering={bottomEntryOffsetPx !== 0}
            class:frame-edge-chain={kind === 'chain'}
            class:frame-dashed={live && kind === 'run'}
            class:tl-line--animate={live && kind === 'run'}
            class:tl-line--dashed={live && kind === 'run'}
            class:tl-line--live={live}
            class="frame-edge pointer-events-none absolute"
            data-timeline-entry-offset={bottomEntryOffsetPx || undefined}
            data-timeline-entry-key={entryKey
              ? `${entryKey}:bottom`
              : undefined}
            style:left="{geometry.horizontal.startPx}px"
            style:top="{geometry.bottomPx}px"
            style:right={live
              ? '0'
              : `calc(100% - ${geometry.horizontal.endPx}px)`}
            style:--frame-color={color}
            style:--tl-line-color={color}
            style:--tl-live-committed-width="{horizontalWidth}px"
            style:--timeline-frame-boundary-offset={`${bottomEntryOffsetPx}px`}
          ></div>
        {/if}
        {#if geometry.drawStartSide}
          <div
            class:frame-side-chain={kind === 'chain'}
            class:frame-side-dashed={live && kind === 'run'}
            class="frame-side frame-side-start pointer-events-none absolute"
            style:left="{geometry.horizontal.startPx}px"
            style:top="{paintTop}px"
            style:height="{sidePaintHeight}px"
            style:--frame-color={color}
          ></div>
        {/if}
        {#if geometry.drawEndSide}
          <div
            class:frame-side-chain={kind === 'chain'}
            class:frame-side-dashed={live && kind === 'run'}
            class="frame-side frame-side-end pointer-events-none absolute"
            style:left="{geometry.horizontal.endPx}px"
            style:top="{paintTop}px"
            style:height="{sidePaintHeight}px"
            style:--frame-color={color}
          ></div>
        {/if}
        {#if showLabel && drawHeader}
          <span
            class:frame-label-chain={kind === 'chain'}
            class:workflow-run-label={kind === 'run'}
            class="pointer-events-none absolute z-10 inline-flex min-h-[var(--dot)] items-center truncate whitespace-nowrap rounded-full bg-[rgb(var(--color-surface-primary))] px-1.5 text-[13px] leading-none text-current"
            style:left={labelLeft}
            style:top="{geometry.topPx - RADIUS}px"
            style:max-width={labelMaxWidth}
            style:visibility={labelWidth > 0 ? 'visible' : 'hidden'}
            style:--workflow-label-attached-left="{labelAttachedLeft}px"
            style:--workflow-label-safe-inset="{labelSafeInset}px"
            style:--workflow-label-end-attached-left="{labelEndAttachedLeft}px"
            style:--frame-color={color}
            title={displayLabel}
            use:measureLabel
          >
            <span class="truncate">{displayLabel}</span>
          </span>
        {/if}
        {#if drawHeader && kind === 'chain'}
          {#each visibleDots as dot (dot.point)}
            {@const bounds = alignedDotBox(
              dot.point,
              geometry.topPx,
              dot.alignment,
            )}
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
</div>

<style lang="postcss">
  .timeline-frame-entering {
    translate: 0 var(--timeline-row-entry-offset);
  }

  .timeline-frame-entry-pending {
    visibility: hidden;
  }

  .timeline-frame-boundary-entering {
    translate: 0 var(--timeline-frame-boundary-offset);
  }

  @media (prefers-reduced-motion: reduce) {
    .timeline-frame-entering {
      translate: none;
    }

    .timeline-frame-boundary-entering {
      translate: none;
    }
  }

  .frame-edge {
    height: 2px;
    background: var(--frame-color);
    transform: translateY(-1px);
  }

  .frame-side {
    width: 2px;
    background: var(--frame-color);
  }

  .frame-side-start {
    transform: none;
  }

  .frame-side-end {
    transform: translateX(-100%);
  }

  .frame-edge-chain {
    height: 4px;
    background: var(--frame-color);
    transform: translateY(-2px);
  }

  .frame-edge-chain-header {
    height: calc(2 * var(--workflow-header-radius));
    background: var(--frame-color);
    transform: translateY(calc(-1 * var(--workflow-header-radius)));
  }

  .frame-side-chain {
    width: 4px;
    background: var(--frame-color);
  }

  .frame-label-chain {
    font-weight: 400;
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
