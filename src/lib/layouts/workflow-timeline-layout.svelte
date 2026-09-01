<script lang="ts">
  import { getContext, onMount } from 'svelte';

  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';

  import EventHistoryLegend from '$lib/components/lines-and-dots/event-history-legend.svelte';
  import EventTypeFilter from '$lib/components/lines-and-dots/event-type-filter.svelte';
  import { getTimelineGroups } from '$lib/components/lines-and-dots/timeline-graph/classic/sort-timeline-groups';
  import ClassicTimelineGraph from '$lib/components/lines-and-dots/timeline-graph/classic/timeline-graph.svelte';
  import { Timeline as ClassicTimeline } from '$lib/components/lines-and-dots/timeline-graph/classic/timeline.svelte';
  import TimelineGraph from '$lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte';
  import type { Timeline } from '$lib/components/lines-and-dots/timeline-graph/timeline.svelte';
  import type { TimelineViewMode } from '$lib/components/lines-and-dots/timeline-graph/types';
  import WorkflowError from '$lib/components/lines-and-dots/workflow-error.svelte';
  import DownloadEventHistoryModal from '$lib/components/workflow/download-event-history-modal.svelte';
  import InputAndResults from '$lib/components/workflow/input-and-results.svelte';
  import WorkflowCallbacks from '$lib/components/workflow/workflow-callbacks.svelte';
  import {
    HISTORY_CTX,
    type HistoryContext,
  } from '$lib/contexts/history-context';
  import {
    WORKFLOW_RUN_CTX,
    type WorkflowRunContext,
  } from '$lib/contexts/workflow-run-context';
  import ToggleButton from '$lib/holocene/toggle-button/toggle-button.svelte';
  import ToggleButtons from '$lib/holocene/toggle-button/toggle-buttons.svelte';
  import { translate } from '$lib/i18n/translate';
  import {
    IconArrowAscending,
    IconArrowDescending,
    IconCollapse,
    IconDownload,
  } from '$lib/io/icon';
  import {
    getRenderableTimelineRuns,
    type TimelineRun,
    toTimelineGroups,
  } from '$lib/services/chain-workflow-session';
  import { eventBuffer } from '$lib/services/grouped-event-buffer.svelte';
  import { clearActives } from '$lib/stores/active-events';
  import { collapseIdleTime, eventFilterSort } from '$lib/stores/event-view';
  import { pauseLiveUpdates } from '$lib/stores/events';
  import { eventTypeFilter } from '$lib/stores/filters';
  import { workflowRun } from '$lib/stores/workflow-run';
  import type {
    WorkflowTaskFailedEvent,
    WorkflowTaskTimedOutEvent,
  } from '$lib/types/events';
  import {
    parseEventFilterParams,
    updateEventFilterParams,
  } from '$lib/utilities/event-filter-params';

  const historyCtx = getContext<HistoryContext>(HISTORY_CTX);
  const workflowRunCtx = getContext<WorkflowRunContext>(WORKFLOW_RUN_CTX);

  const namespace = $derived(page.params.namespace);
  const workflow = $derived($workflowRun.workflow);

  const urlParams = $derived(parseEventFilterParams(page.url));
  $effect(() => {
    $eventFilterSort = urlParams.sort;
    $pauseLiveUpdates = urlParams.refresh_off;
  });

  const onAutoRefreshToggle = () => {
    updateEventFilterParams(
      page.url,
      { refresh_off: !$pauseLiveUpdates },
      goto,
    );
  };

  const reverseSort = $derived($eventFilterSort === 'descending');
  const displayMode = $derived(urlParams.timelineDisplayMode);

  const bufferGroups = $derived.by(() => {
    // The buffer owns its run identity. Never infer that identity from the
    // independently refreshed workflow model: a stale Describe response must
    // not be able to relabel one run's groups as another run.
    if (workflowRunCtx.activeBufferRunId !== workflow?.runId) return [];
    return eventBuffer.groupsWithoutWorkflowTasks;
  });

  const timelineRuns = $derived.by<TimelineRun[]>(() => {
    const retained = workflowRunCtx.retainedRuns.map((run) => ({
      ...run,
      active: false,
    }));
    if (!workflow) return retained;
    const active: TimelineRun = {
      runId: workflow.runId,
      status: workflow.status,
      startTimeMs: Date.parse(workflow.startTime),
      endTimeMs: workflow.endTime ? Date.parse(workflow.endTime) : Date.now(),
      groups: toTimelineGroups(workflow.runId, bufferGroups),
      active: true,
    };
    return getRenderableTimelineRuns({
      retainedRuns: retained,
      activeRun: active,
      activeHistoryReady: historyCtx.fetchComplete,
    });
  });

  const classicGroups = $derived(
    getTimelineGroups(
      bufferGroups.filter((group) => $eventTypeFilter.includes(group.category)),
      reverseSort,
      historyCtx.fetchComplete,
      historyCtx.descMinId,
    ),
  );

  const workflowTaskFailedError = $derived.by(() => {
    if (!historyCtx.fetchComplete) return undefined;
    return eventBuffer.workflowTaskFailedEvent as
      | WorkflowTaskFailedEvent
      | WorkflowTaskTimedOutEvent
      | undefined;
  });

  const isNotPending = $derived(
    Boolean(workflow && !workflow?.isRunning && !workflow?.isPaused),
  );

  beforeNavigate(() => {
    clearActives();
  });

  let showDownloadPrompt = $state(false);

  const onSort = () => {
    const newSort = reverseSort ? 'ascending' : 'descending';
    updateEventFilterParams(page.url, { sort: newSort }, goto);
  };

  const onDisplayMode = (timelineDisplayMode: TimelineViewMode) => {
    updateEventFilterParams(page.url, { timelineDisplayMode }, goto);
  };

  // The timeline renders in normal page flow: the page (#content-wrapper)
  // scrolls it and the controls bar sticks to the top-nav. TimelineGraph
  // virtualizes internally from the visible page band, so there's no bounded
  // scroll container, no scroll-offset bridge, and no height plumbing here.
  const estimatedTotalGroups = $derived.by(() => {
    if (historyCtx.fetchComplete) return bufferGroups.length;
    const totalEvents = historyCtx.totalExpectedEvents ?? 0;
    return Math.max(bufferGroups.length, Math.ceil(totalEvents * 0.5));
  });

  onMount(() => {
    historyCtx.resume();
  });

  let timeline = $state<Timeline | ClassicTimeline>();

  const handleTimelineInit = (t: Timeline | ClassicTimeline) => {
    timeline = t;
  };

  const onToggleIdleTime = () => {
    if (!timeline) return;
    if (timeline.allCollapsibleSegmentsCollapsed) {
      timeline.expandAllSegments();
      $collapseIdleTime = 'off';
    } else {
      timeline.collapseAllSegments();
      $collapseIdleTime = 'on';
    }
  };
</script>

<InputAndResults />
<div class="flex flex-col gap-2">
  {#if workflowTaskFailedError}
    <WorkflowError
      error={workflowTaskFailedError}
      pendingTask={workflow?.pendingWorkflowTask}
    />
  {/if}
  {#if workflow?.callbacks?.length}
    <WorkflowCallbacks callbacks={workflow.callbacks} />
  {/if}
</div>

<!--
  Wrapper: single flex child so the parent's gap-4 only applies once (above
  this block). The controls bar sticks below the top-nav while the page scrolls
  the timeline past it; the timeline virtualizes itself from the visible page band.
-->
<div>
  <div
    class="surface-background sticky top-0 z-[11] flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-2 md:top-[var(--top-nav-height)] md:pt-2 xl:gap-8"
  >
    <div class="flex items-center gap-2">
      <h2>{translate('workflows.timeline-tab')}</h2>
      <EventHistoryLegend />
    </div>
    <div class="flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto">
      <ToggleButtons
        role="group"
        aria-label={translate('workflows.timeline-view')}
      >
        <ToggleButton
          active={displayMode === 'fixed-window'}
          data-testid="timeline-fixed-window"
          onclick={() => onDisplayMode('fixed-window')}
          size="sm"
        >
          {translate('workflows.timeline-sliding-window')}
        </ToggleButton>
        <ToggleButton
          active={displayMode === 'full-duration'}
          data-testid="timeline-full-duration"
          onclick={() => onDisplayMode('full-duration')}
          size="sm"
        >
          {translate('workflows.timeline-full-duration')}
        </ToggleButton>
        <ToggleButton
          active={displayMode === 'classic'}
          data-testid="timeline-classic"
          onclick={() => onDisplayMode('classic')}
          size="sm"
        >
          {translate('workflows.timeline-classic')}
        </ToggleButton>
      </ToggleButtons>
      <ToggleButtons>
        <ToggleButton
          LeadingIcon={reverseSort ? IconArrowDescending : IconArrowAscending}
          data-testid="zoom-in"
          onclick={onSort}
          size="sm">{reverseSort ? 'Descending' : 'Ascending'}</ToggleButton
        >
        <ToggleButton
          LeadingIcon={IconCollapse}
          data-testid="toggle-idle-time"
          loading={!historyCtx.fetchComplete}
          disabled={!historyCtx.fetchComplete ||
            !timeline?.hasCollapsibleSegments}
          onclick={onToggleIdleTime}
          size="sm"
        >
          {timeline?.allCollapsibleSegmentsCollapsed
            ? translate('workflows.show-idle-time')
            : translate('workflows.hide-idle-time')}
        </ToggleButton>
        <EventTypeFilter compact={false} />
      </ToggleButtons>
      <ToggleButtons>
        <ToggleButton
          disabled={isNotPending}
          data-testid="pause"
          size="sm"
          onclick={onAutoRefreshToggle}
        >
          <span
            class="h-1.5 w-1.5 rounded-full {$pauseLiveUpdates || isNotPending
              ? 'bg-slate-300'
              : 'bg-green-600'}"
          ></span>
          {$pauseLiveUpdates || isNotPending
            ? translate('workflows.auto-refresh-off')
            : translate('workflows.auto-refresh-on')}
        </ToggleButton>
        <ToggleButton
          data-testid="download"
          LeadingIcon={IconDownload}
          size="sm"
          onclick={() => (showDownloadPrompt = true)}
        >
          {translate('common.download')}
        </ToggleButton>
      </ToggleButtons>
    </div>
  </div>

  <!--
  Timeline in page flow: it's a tall element the page scrolls, and it
  virtualizes itself from the visible page band (no bounded scroll container,
  no scroll-offset bridge).
-->
  {#if workflow}
    {#if displayMode === 'classic'}
      <ClassicTimelineGraph
        {workflow}
        groups={classicGroups}
        {reverseSort}
        loading={!historyCtx.fetchComplete}
        totalExpectedEvents={estimatedTotalGroups}
        descMinId={historyCtx.descMinId}
        error={Boolean(workflowTaskFailedError)}
        onTimelineInit={handleTimelineInit}
      />
    {:else}
      <TimelineGraph
        {namespace}
        {displayMode}
        {workflow}
        groups={bufferGroups}
        {reverseSort}
        loading={!historyCtx.fetchComplete}
        totalExpectedEvents={estimatedTotalGroups}
        descMinId={historyCtx.descMinId}
        error={Boolean(workflowTaskFailedError)}
        onTimelineInit={handleTimelineInit}
        onRetentionWindow={workflowRunCtx.pruneRetainedRuns}
        rowHeightRetentionScopeId={workflowRunCtx.following
          ? workflowRunCtx.chainRunId
          : workflow.runId}
        knownChainStartRunId={workflowRunCtx.chainRunId}
        {timelineRuns}
      />
    {/if}
    {#if workflowRunCtx.truncation?.affectsVisibleInterval}
      <p class="text-muted mt-2 text-sm" role="status">
        {translate('workflows.chained-timeline-truncated')}
      </p>
    {/if}
  {/if}
</div>
<!-- end wrapper -->

{#if workflow}
  <DownloadEventHistoryModal
    bind:open={showDownloadPrompt}
    {namespace}
    workflowId={workflow.id}
    runId={workflow.runId}
  />
{/if}
