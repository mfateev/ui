<script lang="ts">
  import Button from '$lib/holocene/button.svelte';
  import { translate } from '$lib/i18n/translate';

  import type { DotColors } from '../colors';
  import { GUTTER, RADIUS } from './constants';
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
    paint: 'background' | 'foreground';
    bandTop: number;
    bandHeight: number;
    entryOffsetPx?: number;
    entryKey?: string;
    bottomEntryOffsetPx?: number;
    entryPending?: boolean;
    onToggle?: () => void;
    expanded?: boolean;
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
    paint,
    bandTop,
    bandHeight,
    entryOffsetPx = 0,
    entryKey,
    bottomEntryOffsetPx = 0,
    entryPending = false,
    onToggle,
    expanded = true,
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
  const labelSafeInset = GUTTER + 1.5 * RADIUS;
  const labelIconGap = $derived(kind === 'chain' ? 12 : 0);
  const labelRight = $derived(
    geometry.horizontal
      ? geometry.horizontal.endPx - 2 * RADIUS
      : labelSafeInset,
  );
  const labelLeft = $derived(
    live && geometry.drawStartSide
      ? 'var(--workflow-label-attached-left)'
      : geometry.drawStartSide
        ? 'clamp(var(--workflow-label-attached-left), calc(var(--workflow-label-safe-inset) + var(--timeline-frame-offset, 0px)), var(--workflow-label-right))'
        : 'calc(var(--workflow-label-safe-inset) + var(--timeline-frame-offset, 0px))',
  );
  const labelMaxWidth = $derived(
    live
      ? 'none'
      : `max(0px, calc(var(--workflow-label-right) - (${labelLeft})))`,
  );
  const compactLabel = $derived(
    kind === 'run' && label.length > 18
      ? `${label.slice(0, 8)}…${label.slice(-6)}`
      : kind === 'chain' && label.length > 30
        ? `${label.slice(0, 18)}…${label.slice(-8)}`
        : label,
  );
  const displayLabel = $derived(
    `${translate(kind === 'chain' ? 'common.workflow-id' : 'common.run-id')}: ${compactLabel}${kind === 'chain' && workflowType ? ` · ${workflowType}` : ''}`,
  );
</script>

<div
  class="pointer-events-none absolute inset-0"
  class:timeline-frame-entering={entryOffsetPx !== 0}
  class:timeline-frame-entry-pending={entryPending}
  data-timeline-entry-offset={entryOffsetPx || undefined}
  data-timeline-entry-key={entryKey}
  data-timeline-bottom-entry-offset={bottomEntryOffsetPx || undefined}
  style:--timeline-row-entry-offset={`${entryOffsetPx}px`}
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
      aria-hidden={onToggle ? undefined : 'true'}
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
            class:frame-edge-chain={kind === 'chain'}
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
            style:right={live ? '0' : undefined}
            style:width={live ? undefined : `${horizontalWidth}px`}
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
            class="frame-side pointer-events-none absolute"
            style:left="{geometry.horizontal.startPx}px"
            style:top="{paintTop}px"
            style:height="{paintHeight}px"
            style:--frame-color={color}
          ></div>
        {/if}
        {#if geometry.drawEndSide}
          <div
            class:frame-side-chain={kind === 'chain'}
            class:frame-side-dashed={live && kind === 'run'}
            class="frame-side pointer-events-none absolute"
            style:left="{geometry.horizontal.endPx}px"
            style:top="{paintTop}px"
            style:height="{paintHeight}px"
            style:--frame-color={color}
          ></div>
        {/if}
        {#if showLabel && drawTop}
          <span
            class:frame-label-chain={kind === 'chain'}
            class:workflow-run-label={kind === 'run'}
            class:pointer-events-none={!onToggle}
            class:pointer-events-auto={Boolean(onToggle)}
            class="absolute z-10 inline-flex min-h-[var(--dot)] items-center truncate whitespace-nowrap rounded-full bg-[rgb(var(--color-surface-primary))] px-1.5 text-[13px] leading-none text-current"
            style:left={labelLeft}
            style:top="{geometry.topPx - RADIUS}px"
            style:max-width={labelMaxWidth}
            style:--workflow-label-attached-left="{geometry.labelStartPx +
              labelIconGap}px"
            style:--workflow-label-safe-inset="{labelSafeInset}px"
            style:--workflow-label-right="{labelRight}px"
            style:--frame-color={color}
            title={displayLabel}
          >
            {#if onToggle}
              <Button
                variant="ghost"
                size="xs"
                class="mr-1 h-4 w-4 shrink-0 p-0"
                onclick={onToggle}
                aria-label={`${expanded ? translate('workflows.child-timeline-collapse') : translate('workflows.child-timeline-expand')}: ${label}`}
                aria-expanded={expanded}
                leadingIcon={expanded ? 'chevron-down' : 'chevron-right'}
                title={expanded
                  ? translate('workflows.child-timeline-collapse')
                  : translate('workflows.child-timeline-expand')}
              />
            {/if}
            <span class="truncate">{displayLabel}</span>
          </span>
        {/if}
        {#if drawTop && kind === 'chain'}
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
    transform: translateX(-1px);
  }

  .frame-edge-chain {
    height: 4px;
    background: linear-gradient(
      to bottom,
      var(--frame-color) 0 1px,
      transparent 1px 3px,
      var(--frame-color) 3px 4px
    );
    transform: translateY(-2px);
  }

  .frame-side-chain {
    width: 4px;
    background: linear-gradient(
      to right,
      var(--frame-color) 0 1px,
      transparent 1px 3px,
      var(--frame-color) 3px 4px
    );
    transform: translateX(-2px);
  }

  .frame-label-chain {
    font-weight: 600;
    box-shadow: inset 0 0 0 1px var(--frame-color);
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
