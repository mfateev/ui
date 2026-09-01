<script lang="ts">
  import type { TimelineWindowMode } from '$lib/components/lines-and-dots/timeline-graph/timeline-window-controls';
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowChainOverviewRun } from '$lib/services/workflow-chain-overview';

  interface Props {
    runs: WorkflowChainOverviewRun[];
    windowStartTimeMs?: number;
    windowEndTimeMs?: number;
    windowDurationMs?: number;
    windowMode?: TimelineWindowMode;
    loading?: boolean;
    onWindowMove?: (startTimeMs: number) => void;
  }

  let {
    runs,
    windowStartTimeMs,
    windowEndTimeMs,
    windowDurationMs,
    windowMode,
    loading = false,
    onWindowMove,
  }: Props = $props();

  let trackElement = $state<HTMLDivElement>();
  let overviewElement = $state<HTMLDivElement>();
  let dragLeft = $state<number | null>(null);
  let dragOffset = 0;
  let visualDurationMs = 1;
  let visualWindowWidth = 0.4;

  const chainEndIsLive = $derived(
    runs.at(-1)?.status === 'Running' ||
      runs.at(-1)?.status === 'Paused' ||
      runs.at(-1)?.status === 'ContinuedAsNew',
  );

  const startTimeMs = $derived(runs[0]?.startTimeMs);
  const endTimeMs = $derived(Math.max(...runs.map((run) => run.endTimeMs)));
  const durationMs = $derived(
    startTimeMs === undefined ? 0 : Math.max(1, endTimeMs - startTimeMs),
  );
  const position = (timeMs: number): number =>
    startTimeMs === undefined
      ? 0
      : Math.min(100, Math.max(0, ((timeMs - startTimeMs) / durationMs) * 100));
  const windowLeft = $derived(position(windowStartTimeMs ?? startTimeMs ?? 0));
  const visualWindowEndTimeMs = $derived(
    windowStartTimeMs !== undefined && windowDurationMs !== undefined
      ? windowStartTimeMs + windowDurationMs
      : (windowEndTimeMs ?? endTimeMs),
  );
  const windowRight = $derived(position(visualWindowEndTimeMs));
  const windowWidth = $derived(Math.max(0.4, windowRight - windowLeft));
  const displayedWindowLeft = $derived(dragLeft ?? windowLeft);
  const continuationTicks = $derived(
    runs.filter((run) => run.transitionToNext === 'continue-as-new'),
  );

  $effect(() => {
    const chainStartTimeMs = startTimeMs;
    const geometryEndTimeMs = endTimeMs;
    const isLive = chainEndIsLive;
    const currentWindowStartTimeMs = windowStartTimeMs;
    const currentWindowEndTimeMs = visualWindowEndTimeMs;
    const currentWindowDurationMs = windowDurationMs;
    const currentWindowMode = windowMode;
    if (chainStartTimeMs === undefined || !trackElement) return;

    const geometryDurationMs = Math.max(
      1,
      geometryEndTimeMs - chainStartTimeMs,
    );
    let animationFrame = 0;
    const animationStartedAtMs = performance.now();

    const updateVisualGeometry = () => {
      const visualEndTimeMs = isLive
        ? Math.max(geometryEndTimeMs, Date.now())
        : geometryEndTimeMs;
      visualDurationMs = Math.max(1, visualEndTimeMs - chainStartTimeMs);
      const scale = geometryDurationMs / visualDurationMs;
      trackElement?.style.setProperty('--overview-live-scale', `${scale}`);

      if (currentWindowStartTimeMs !== undefined) {
        const elapsedMs = performance.now() - animationStartedAtMs;
        const movingWindowStartTimeMs =
          currentWindowMode === 'following' &&
          currentWindowDurationMs !== undefined
            ? visualEndTimeMs - currentWindowDurationMs
            : currentWindowMode === 'playing'
              ? Math.min(
                  currentWindowStartTimeMs + elapsedMs,
                  visualEndTimeMs - (currentWindowDurationMs ?? 0),
                )
              : currentWindowStartTimeMs;
        const movingWindowEndTimeMs =
          currentWindowDurationMs === undefined
            ? currentWindowEndTimeMs
            : movingWindowStartTimeMs + currentWindowDurationMs;
        const left = Math.min(
          100,
          Math.max(
            0,
            ((movingWindowStartTimeMs - chainStartTimeMs) / visualDurationMs) *
              100,
          ),
        );
        const right = Math.min(
          100,
          Math.max(
            0,
            ((movingWindowEndTimeMs - chainStartTimeMs) / visualDurationMs) *
              100,
          ),
        );
        visualWindowWidth = Math.max(0.4, right - left);
        trackElement?.style.setProperty('--overview-window-left', `${left}%`);
        trackElement?.style.setProperty(
          '--overview-window-width',
          `${visualWindowWidth}%`,
        );
      }
      if (overviewElement) {
        overviewElement.dataset.chainEndTimeMs = `${visualEndTimeMs}`;
      }
      if (isLive) animationFrame = requestAnimationFrame(updateVisualGeometry);
    };

    updateVisualGeometry();
    return () => cancelAnimationFrame(animationFrame);
  });

  const pointerPosition = (event: PointerEvent): number => {
    const bounds = trackElement?.getBoundingClientRect();
    if (!bounds?.width) return 0;
    return ((event.clientX - bounds.left) / bounds.width) * 100;
  };

  const clampDragLeft = (left: number): number =>
    Math.min(Math.max(0, left), Math.max(0, 100 - visualWindowWidth));

  const startDragging = (event: PointerEvent) => {
    if (!trackElement || !onWindowMove) return;
    event.preventDefault();
    dragOffset = pointerPosition(event) - displayedWindowLeft;
    dragLeft = displayedWindowLeft;
    trackElement.style.removeProperty('--overview-window-left');
    trackElement.setPointerCapture(event.pointerId);
  };

  const dragWindow = (event: PointerEvent) => {
    if (dragLeft === null) return;
    dragLeft = clampDragLeft(pointerPosition(event) - dragOffset);
  };

  const finishDragging = (event: PointerEvent) => {
    if (dragLeft === null || startTimeMs === undefined) return;
    const selectedStartTimeMs =
      startTimeMs + (dragLeft / 100) * visualDurationMs;
    trackElement?.releasePointerCapture(event.pointerId);
    onWindowMove?.(selectedStartTimeMs);
    dragLeft = null;
  };

  const cancelDragging = (event: PointerEvent) => {
    if (dragLeft === null) return;
    trackElement?.releasePointerCapture(event.pointerId);
    dragLeft = null;
  };
</script>

<div
  bind:this={overviewElement}
  class="surface-background border-b border-subtle px-3 py-2"
  data-testid="timeline-chain-overview"
  data-chain-end-time-ms={endTimeMs}
>
  <div class="mb-1 flex items-center justify-between gap-2 text-xs">
    <span class="font-medium"
      >{translate('workflows.timeline-chain-overview')}</span
    >
    {#if loading}
      <span class="text-muted" role="status">
        {translate('workflows.timeline-chain-loading')}
      </span>
    {/if}
  </div>
  <div
    bind:this={trackElement}
    class="relative h-5 rounded border border-subtle bg-subtle"
    role="img"
    aria-label={translate('workflows.timeline-chain-overview-description')}
    onpointermove={dragWindow}
    onpointerup={finishDragging}
    onpointercancel={cancelDragging}
  >
    {#if startTimeMs !== undefined}
      <div
        class="pointer-events-none absolute inset-0 origin-left"
        style:transform="scaleX(var(--overview-live-scale, 1))"
      >
        {#each continuationTicks as run (run.runId)}
          <span
            class="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-interactive"
            style:left="{position(run.endTimeMs)}%"
            title={translate('workflows.timeline-continued-as-new')}
            data-testid="timeline-continue-as-new-tick"
          ></span>
        {/each}
      </div>
      <button
        type="button"
        class="absolute -inset-y-1 z-10 box-border touch-none rounded border-[3px] border-interactive bg-transparent p-0 shadow-sm {onWindowMove
          ? 'cursor-grab active:cursor-grabbing'
          : 'pointer-events-none'}"
        style:left={dragLeft === null
          ? `var(--overview-window-left, ${displayedWindowLeft}%)`
          : `${displayedWindowLeft}%`}
        style:width={`var(--overview-window-width, ${windowWidth}%)`}
        data-testid="timeline-window-position"
        data-window-start-time-ms={windowStartTimeMs}
        data-window-end-time-ms={visualWindowEndTimeMs}
        aria-label={translate('workflows.timeline-current-window')}
        title={translate('workflows.timeline-current-window')}
        onpointerdown={startDragging}
      ></button>
    {/if}
  </div>
</div>
