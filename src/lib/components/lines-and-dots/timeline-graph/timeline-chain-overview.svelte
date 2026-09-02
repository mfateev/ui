<script lang="ts">
  import type { TimelineWindowMode } from '$lib/components/lines-and-dots/timeline-graph/timeline-window-controls';
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowChainOverviewRun } from '$lib/services/workflow-chain-overview';

  import { binTimelineContinuations } from './timeline-continuation-bins';

  interface Props {
    runs: WorkflowChainOverviewRun[];
    windowStartTimeMs?: number;
    windowEndTimeMs?: number;
    windowDurationMs?: number;
    windowMode?: TimelineWindowMode;
    loading?: boolean;
    onWindowMove?: (startTimeMs: number) => void;
    onWindowResize?: (range: {
      startTimeMs: number;
      endTimeMs: number;
      anchor: 'start' | 'end';
    }) => void;
  }

  let {
    runs,
    windowStartTimeMs,
    windowEndTimeMs,
    windowDurationMs,
    windowMode,
    loading = false,
    onWindowMove,
    onWindowResize,
  }: Props = $props();

  type DragMode = 'move' | 'resize-start' | 'resize-end';

  let trackElement = $state<HTMLDivElement>();
  let overviewElement = $state<HTMLDivElement>();
  let dragMode = $state<DragMode | null>(null);
  let dragLeft = $state<number | null>(null);
  let dragWidth = $state<number | null>(null);
  let dragPointerId: number | null = null;
  let dragOffset = 0;
  let dragFixedEdge = 0;
  let visualDurationMs = 1;
  let visualWindowLeft = 0;
  let visualWindowWidth = 0.4;
  let trackWidth = $state(1);

  const chainEndIsLive = $derived(
    runs.at(-1)?.status === 'Running' ||
      runs.at(-1)?.status === 'Paused' ||
      runs.at(-1)?.status === 'ContinuedAsNew',
  );

  const startTimeMs = $derived(runs[0]?.startTimeMs);
  const endTimeMs = $derived.by(() => {
    let maximum = 0;
    for (const run of runs) {
      if (run.endTimeMs > maximum) maximum = run.endTimeMs;
    }
    return maximum;
  });
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
  const displayedWindowWidth = $derived(dragWidth ?? windowWidth);
  const continuationBins = $derived(
    binTimelineContinuations({
      runs,
      startTimeMs: startTimeMs ?? 0,
      durationMs,
      widthPx: trackWidth,
    }),
  );

  $effect(() => {
    if (!trackElement) return;
    const observer = new ResizeObserver(([entry]) => {
      trackWidth = Math.max(1, Math.round(entry.contentRect.width));
    });
    observer.observe(trackElement);
    return () => observer.disconnect();
  });

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
        visualWindowLeft = left;
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
    return Math.min(
      100,
      Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100),
    );
  };

  const minimumWindowWidth = (): number =>
    Math.min(100, Math.max(0.4, (1_000 / visualDurationMs) * 100));

  const startDragging = (event: PointerEvent, mode: DragMode) => {
    if (!trackElement || (mode === 'move' ? !onWindowMove : !onWindowResize)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragMode = mode;
    dragLeft = visualWindowLeft;
    dragWidth = visualWindowWidth;
    dragPointerId = event.pointerId;
    dragOffset = pointerPosition(event) - visualWindowLeft;
    dragFixedEdge =
      mode === 'resize-start'
        ? visualWindowLeft + visualWindowWidth
        : visualWindowLeft;
    trackElement.style.removeProperty('--overview-window-left');
    trackElement.style.removeProperty('--overview-window-width');
    trackElement.setPointerCapture(event.pointerId);
  };

  const dragWindow = (event: PointerEvent) => {
    if (
      dragMode === null ||
      dragLeft === null ||
      dragWidth === null ||
      event.pointerId !== dragPointerId
    ) {
      return;
    }
    if (event.buttons === 0) {
      finishDragging(event);
      return;
    }
    const pointer = pointerPosition(event);
    const minimumWidth = minimumWindowWidth();

    if (dragMode === 'move') {
      dragLeft = Math.min(
        Math.max(0, pointer - dragOffset),
        Math.max(0, 100 - dragWidth),
      );
    } else if (dragMode === 'resize-start') {
      dragLeft = Math.min(
        Math.max(0, pointer),
        Math.max(0, dragFixedEdge - minimumWidth),
      );
      dragWidth = dragFixedEdge - dragLeft;
    } else {
      const right = Math.max(
        Math.min(100, pointer),
        Math.min(100, dragFixedEdge + minimumWidth),
      );
      dragLeft = dragFixedEdge;
      dragWidth = right - dragFixedEdge;
    }
  };

  const finishDragging = (event: PointerEvent) => {
    if (
      dragMode === null ||
      dragLeft === null ||
      dragWidth === null ||
      startTimeMs === undefined ||
      event.pointerId !== dragPointerId
    ) {
      return;
    }
    const completedMode = dragMode;
    const selectedStartTimeMs =
      startTimeMs + (dragLeft / 100) * visualDurationMs;
    const selectedEndTimeMs =
      selectedStartTimeMs + (dragWidth / 100) * visualDurationMs;
    dragMode = null;
    dragLeft = null;
    dragWidth = null;
    dragPointerId = null;
    if (trackElement?.hasPointerCapture(event.pointerId)) {
      trackElement.releasePointerCapture(event.pointerId);
    }
    if (completedMode === 'move') {
      onWindowMove?.(selectedStartTimeMs);
    } else {
      onWindowResize?.({
        startTimeMs: selectedStartTimeMs,
        endTimeMs: selectedEndTimeMs,
        anchor: completedMode === 'resize-start' ? 'end' : 'start',
      });
    }
  };

  const cancelDragging = (event: PointerEvent) => {
    if (dragMode === null || event.pointerId !== dragPointerId) return;
    dragMode = null;
    dragLeft = null;
    dragWidth = null;
    dragPointerId = null;
    if (trackElement?.hasPointerCapture(event.pointerId)) {
      trackElement.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent, edge: 'start' | 'end') => {
    if (
      !onWindowResize ||
      startTimeMs === undefined ||
      windowStartTimeMs === undefined ||
      visualWindowEndTimeMs === undefined ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    ) {
      return;
    }
    event.preventDefault();
    const stepMs = Math.max(1_000, (windowDurationMs ?? 10_000) / 10);
    const deltaMs = event.key === 'ArrowRight' ? stepMs : -stepMs;

    if (edge === 'start') {
      onWindowResize({
        startTimeMs: Math.min(
          visualWindowEndTimeMs - 1_000,
          Math.max(startTimeMs, windowStartTimeMs + deltaMs),
        ),
        endTimeMs: visualWindowEndTimeMs,
        anchor: 'end',
      });
    } else {
      onWindowResize({
        startTimeMs: windowStartTimeMs,
        endTimeMs: Math.max(
          windowStartTimeMs + 1_000,
          Math.min(
            startTimeMs + visualDurationMs,
            visualWindowEndTimeMs + deltaMs,
          ),
        ),
        anchor: 'start',
      });
    }
  };
</script>

<svelte:window onpointerup={finishDragging} onpointercancel={cancelDragging} />

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
    role="group"
    aria-label={`${translate('workflows.timeline-chain-overview-description')} ${continuationBins.totalCount} continuations, ${continuationBins.binCount} visible markers.`}
    onpointermove={dragWindow}
    onpointerup={finishDragging}
    onpointercancel={cancelDragging}
    onlostpointercapture={finishDragging}
  >
    {#if startTimeMs !== undefined}
      <div
        class="pointer-events-none absolute inset-0 origin-left"
        style:transform="scaleX(var(--overview-live-scale, 1))"
      >
        <svg
          class="text-interactive absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 {trackWidth} 20"
          preserveAspectRatio="none"
          aria-hidden="true"
          data-testid="timeline-continuation-bins"
          data-continuation-count={continuationBins.totalCount}
          data-continuation-bin-count={continuationBins.binCount}
        >
          <path
            d={continuationBins.path}
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div
        class="absolute -inset-y-1 z-10 box-border touch-none rounded border-[3px] border-interactive bg-transparent shadow-sm"
        style:left={dragMode === null
          ? `var(--overview-window-left, ${displayedWindowLeft}%)`
          : `${displayedWindowLeft}%`}
        style:width={dragMode === null
          ? `var(--overview-window-width, ${displayedWindowWidth}%)`
          : `${displayedWindowWidth}%`}
        data-testid="timeline-window-position"
        data-window-start-time-ms={windowStartTimeMs}
        data-window-end-time-ms={visualWindowEndTimeMs}
        title={translate('workflows.timeline-current-window')}
      >
        <button
          type="button"
          class="absolute inset-0 z-10 touch-none bg-transparent p-0 {onWindowMove
            ? 'cursor-grab active:cursor-grabbing'
            : 'pointer-events-none'}"
          aria-label={translate('workflows.timeline-move-window')}
          data-testid="timeline-window-move"
          onpointerdown={(event) => startDragging(event, 'move')}
        ></button>
        <button
          type="button"
          class="absolute -bottom-1.5 -left-2 -top-1.5 z-20 w-4 cursor-ew-resize touch-none bg-transparent p-0"
          aria-label={translate('workflows.timeline-resize-window-start')}
          data-testid="timeline-window-resize-start"
          onpointerdown={(event) => startDragging(event, 'resize-start')}
          onkeydown={(event) => resizeWithKeyboard(event, 'start')}
        >
          <span
            class="absolute bottom-1 left-1/2 top-1 w-0.5 -translate-x-1/2 rounded bg-interactive"
          ></span>
        </button>
        <button
          type="button"
          class="absolute -bottom-1.5 -right-2 -top-1.5 z-20 w-4 cursor-ew-resize touch-none bg-transparent p-0"
          aria-label={translate('workflows.timeline-resize-window-end')}
          data-testid="timeline-window-resize-end"
          onpointerdown={(event) => startDragging(event, 'resize-end')}
          onkeydown={(event) => resizeWithKeyboard(event, 'end')}
        >
          <span
            class="absolute bottom-1 left-1/2 top-1 w-0.5 -translate-x-1/2 rounded bg-interactive"
          ></span>
        </button>
      </div>
    {/if}
  </div>
</div>
