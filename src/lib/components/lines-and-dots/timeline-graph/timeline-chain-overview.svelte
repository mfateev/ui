<script lang="ts">
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowChainOverviewRun } from '$lib/services/workflow-chain-overview';

  interface Props {
    runs: WorkflowChainOverviewRun[];
    windowStartTimeMs?: number;
    windowEndTimeMs?: number;
    windowDurationMs?: number;
    loading?: boolean;
  }

  let {
    runs,
    windowStartTimeMs,
    windowEndTimeMs,
    windowDurationMs,
    loading = false,
  }: Props = $props();

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
  const continuationTicks = $derived(
    runs.filter((run) => run.transitionToNext === 'continue-as-new'),
  );
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
    class="relative h-5 rounded border border-subtle bg-subtle"
    role="img"
    aria-label={translate('workflows.timeline-chain-overview-description')}
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
      <div
        class="pointer-events-none absolute -inset-y-1 z-10 box-border rounded border-[3px] border-interactive bg-transparent shadow-sm transition-[left,width] duration-200 ease-linear"
        style:left="{windowLeft}%"
        style:width="{Math.max(0.4, windowRight - windowLeft)}%"
        data-testid="timeline-window-position"
        data-window-start-time-ms={windowStartTimeMs}
        data-window-end-time-ms={visualWindowEndTimeMs}
        title={translate('workflows.timeline-current-window')}
      ></div>
    {/if}
  </div>
</div>
