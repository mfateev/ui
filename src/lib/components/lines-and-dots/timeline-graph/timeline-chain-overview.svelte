<script lang="ts">
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowChainOverviewRun } from '$lib/services/workflow-chain-overview';

  interface Props {
    runs: WorkflowChainOverviewRun[];
    windowStartTimeMs?: number;
    windowEndTimeMs?: number;
    windowDurationMs?: number;
    loading?: boolean;
    onWindowMove?: (startTimeMs: number) => void;
  }

  let {
    runs,
    windowStartTimeMs,
    windowEndTimeMs,
    windowDurationMs,
    loading = false,
    onWindowMove,
  }: Props = $props();

  let trackElement = $state<HTMLDivElement>();
  let dragLeft = $state<number | null>(null);
  let dragOffset = 0;

  const startTimeMs = $derived(runs[0]?.startTimeMs);
  const endTimeMs = $derived(
    Math.max(
      ...runs.map((run) => run.endTimeMs),
      windowEndTimeMs ?? Number.NEGATIVE_INFINITY,
    ),
  );
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

  const pointerPosition = (event: PointerEvent): number => {
    const bounds = trackElement?.getBoundingClientRect();
    if (!bounds?.width) return 0;
    return ((event.clientX - bounds.left) / bounds.width) * 100;
  };

  const clampDragLeft = (left: number): number =>
    Math.min(Math.max(0, left), Math.max(0, 100 - windowWidth));

  const startDragging = (event: PointerEvent) => {
    if (!trackElement || !onWindowMove) return;
    event.preventDefault();
    dragOffset = pointerPosition(event) - displayedWindowLeft;
    dragLeft = displayedWindowLeft;
    trackElement.setPointerCapture(event.pointerId);
  };

  const dragWindow = (event: PointerEvent) => {
    if (dragLeft === null) return;
    dragLeft = clampDragLeft(pointerPosition(event) - dragOffset);
  };

  const finishDragging = (event: PointerEvent) => {
    if (dragLeft === null || startTimeMs === undefined) return;
    const selectedStartTimeMs = startTimeMs + (dragLeft / 100) * durationMs;
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
      {#each continuationTicks as run (run.runId)}
        <span
          class="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-interactive"
          style:left="{position(run.endTimeMs)}%"
          title={translate('workflows.timeline-continued-as-new')}
          data-testid="timeline-continue-as-new-tick"
        ></span>
      {/each}
      <button
        type="button"
        class="absolute -inset-y-1 z-10 box-border touch-none rounded border-[3px] border-interactive bg-transparent p-0 shadow-sm {onWindowMove
          ? 'cursor-grab active:cursor-grabbing'
          : 'pointer-events-none'}"
        style:left="{displayedWindowLeft}%"
        style:width="{windowWidth}%"
        style:transition={dragLeft === null
          ? 'left 200ms linear, width 200ms linear'
          : 'none'}
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
