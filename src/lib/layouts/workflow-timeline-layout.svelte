<script lang="ts">
  import { getContext, onDestroy, onMount, untrack } from 'svelte';

  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';

  import EventHistoryLegend from '$lib/components/lines-and-dots/event-history-legend.svelte';
  import EventTypeFilter from '$lib/components/lines-and-dots/event-type-filter.svelte';
  import { getTimelineGroups } from '$lib/components/lines-and-dots/timeline-graph/classic/sort-timeline-groups';
  import ClassicTimelineGraph from '$lib/components/lines-and-dots/timeline-graph/classic/timeline-graph.svelte';
  import { Timeline as ClassicTimeline } from '$lib/components/lines-and-dots/timeline-graph/classic/timeline.svelte';
  import TimelineChainOverview from '$lib/components/lines-and-dots/timeline-graph/timeline-chain-overview.svelte';
  import TimelineGraph from '$lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte';
  import {
    clampTimelineWindowDuration,
    formatTimelineWindowDuration,
    type TimelineWindowControls,
  } from '$lib/components/lines-and-dots/timeline-graph/timeline-window-controls';
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
    IconAdd,
    IconArrowAscending,
    IconArrowDescending,
    IconArrowLeft,
    IconArrowRight,
    IconCollapse,
    IconDownload,
    IconHyphen,
    IconPause,
    IconPlay,
  } from '$lib/io/icon';
  import {
    getRenderableTimelineRuns,
    type TimelineRun,
    toTimelineGroups,
  } from '$lib/services/chain-workflow-session';
  import { eventBuffer } from '$lib/services/grouped-event-buffer.svelte';
  import { TimelineIntervalLoader } from '$lib/services/timeline-interval-loader';
  import {
    BufferTimelineRunModel,
    type TimelineRunModel,
  } from '$lib/services/timeline-run-model';
  import {
    loadWorkflowChainOverview,
    mergeWorkflowChainOverviewRuns,
    reconcileWorkflowChainOverviewProgress,
    type WorkflowChainOverviewRun,
  } from '$lib/services/workflow-chain-overview';
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
  import { validTimeToDate } from '$lib/utilities/format-time';

  const historyCtx = getContext<HistoryContext>(HISTORY_CTX);
  const workflowRunCtx = getContext<WorkflowRunContext>(WORKFLOW_RUN_CTX);

  const namespace = $derived(page.params.namespace);
  const workflow = $derived($workflowRun.workflow);
  const firstEventTime = $derived(
    eventBuffer.firstEvent?.eventTime
      ? validTimeToDate(eventBuffer.firstEvent.eventTime).toISOString()
      : undefined,
  );
  const workflowId = $derived(workflow?.id);
  const firstRunId = $derived(
    workflow?.firstExecutionRunId || workflowRunCtx.chainRunId,
  );

  const urlParams = $derived(parseEventFilterParams(page.url));
  $effect(() => {
    $eventFilterSort = urlParams.sort;
    $pauseLiveUpdates = urlParams.refresh_off;
  });

  const onAutoRefreshToggle = () => {
    setAutoRefreshPaused(!$pauseLiveUpdates);
  };

  const setAutoRefreshPaused = (paused: boolean) => {
    updateEventFilterParams(page.url, { refresh_off: paused }, goto);
  };

  const reverseSort = $derived($eventFilterSort === 'descending');
  const requestedDisplayMode = $derived(urlParams.timelineDisplayMode);
  const displayMode = $derived(
    requestedDisplayMode === 'full-duration'
      ? 'fixed-window'
      : requestedDisplayMode,
  );
  let intervalTimelineRuns = $state<TimelineRun[]>([]);

  const bufferGroups = $derived.by(() => {
    // The buffer owns its run identity. Never infer that identity from the
    // independently refreshed workflow model: a stale Describe response must
    // not be able to relabel one run's groups as another run.
    if (workflowRunCtx.activeBufferRunId !== workflow?.runId) return [];
    return eventBuffer.lazyGroupsWithoutWorkflowTasks;
  });

  const classicBufferGroups = $derived.by(() => {
    if (displayMode !== 'classic') return [];
    if (workflowRunCtx.activeBufferRunId !== workflow?.runId) return [];
    return eventBuffer.groupsWithoutWorkflowTasks;
  });

  const timelineRuns = $derived.by<TimelineRun[]>(() => {
    const retained = workflowRunCtx.retainedRuns.map((run) => ({
      ...run,
      active: false,
    }));
    if (!workflow) return [...intervalTimelineRuns, ...retained];
    const active: TimelineRun = {
      runId: workflow.runId,
      status: workflow.status,
      startTimeMs: Date.parse(workflow.startTime),
      endTimeMs: workflow.endTime ? Date.parse(workflow.endTime) : Date.now(),
      groups: toTimelineGroups(workflow.runId, bufferGroups),
      active: true,
    };
    const renderable = getRenderableTimelineRuns({
      retainedRuns: retained,
      activeRun: active,
      activeHistoryReady: historyCtx.fetchComplete,
    });
    return [
      ...intervalTimelineRuns.filter(
        (run) => !renderable.some(({ runId }) => runId === run.runId),
      ),
      ...renderable,
    ].sort((a, b) => a.startTimeMs - b.startTimeMs);
  });

  const classicGroups = $derived(
    getTimelineGroups(
      classicBufferGroups.filter((group) =>
        $eventTypeFilter.includes(group.category),
      ),
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
  let timelineWindowControls = $state<TimelineWindowControls>();
  let chainOverviewRuns = $state<WorkflowChainOverviewRun[]>([]);
  let chainOverviewLoading = $state(false);
  let legacyFullDurationFitKey = '';
  let chainLoadGeneration = 0;
  const intervalLoader = new TimelineIntervalLoader();
  let intervalLoadGeneration = 0;
  let intervalModelReleases: (() => void)[] = [];
  let intervalTruncated = $state(false);

  $effect(() => {
    if (requestedDisplayMode !== 'full-duration') {
      legacyFullDurationFitKey = '';
      return;
    }
    const fitKey = `${workflowId}:${firstRunId}`;
    if (
      !timelineWindowControls ||
      chainOverviewLoading ||
      chainOverviewRuns.length === 0 ||
      legacyFullDurationFitKey === fitKey
    ) {
      return;
    }
    timelineWindowControls.fitToFullDuration();
    legacyFullDurationFitKey = fitKey;
  });

  const releaseIntervalModels = () => {
    for (const release of intervalModelReleases) release();
    intervalModelReleases = [];
  };

  onDestroy(() => {
    releaseIntervalModels();
    intervalLoader.dispose();
  });

  $effect(() => {
    if (!workflowId || !firstRunId) {
      intervalLoadGeneration += 1;
      intervalLoader.abort();
      releaseIntervalModels();
      chainOverviewRuns = [];
      intervalTimelineRuns = [];
      intervalTruncated = false;
      chainOverviewLoading = false;
      return;
    }

    const controller = new AbortController();
    const generation = ++chainLoadGeneration;
    intervalLoadGeneration += 1;
    intervalLoader.abort();
    chainOverviewRuns = [];
    intervalTimelineRuns = [];
    releaseIntervalModels();
    chainOverviewLoading = true;

    const loadChain = async () => {
      try {
        const runs = await loadWorkflowChainOverview({
          namespace,
          workflowId,
          firstRunId,
          signal: controller.signal,
          generation,
          onRun: (progress) => {
            if (
              controller.signal.aborted ||
              progress.generation !== chainLoadGeneration ||
              progress.firstRunId !== firstRunId
            ) {
              return;
            }
            reconcileWorkflowChainOverviewProgress(chainOverviewRuns, progress);
          },
        });
        if (controller.signal.aborted || generation !== chainLoadGeneration) {
          return;
        }
        if (chainOverviewRuns.length === 0 && runs.length > 0) {
          chainOverviewRuns = runs;
        }
      } catch (error: unknown) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Unable to load the workflow chain overview.', error);
        }
      } finally {
        if (!controller.signal.aborted) chainOverviewLoading = false;
      }
    };

    void loadChain();

    return () => controller.abort();
  });

  $effect(() => {
    const currentWorkflow = workflow;
    const retainedRuns = workflowRunCtx.retainedRuns;
    if (!currentWorkflow) return;
    const existingRuns = untrack(() => chainOverviewRuns);

    const updates: WorkflowChainOverviewRun[] = retainedRuns.map((run) => ({
      runId: run.runId,
      status: run.status,
      startTimeMs: run.startTimeMs,
      endTimeMs: run.endTimeMs,
      nextRunId: run.successorRunId,
      transitionToNext: run.transitionFromPrevious,
    }));
    updates.push({
      runId: currentWorkflow.runId,
      status: currentWorkflow.status,
      startTimeMs: Date.parse(currentWorkflow.startTime),
      endTimeMs:
        Date.parse(currentWorkflow.endTime) ||
        existingRuns.find(({ runId }) => runId === currentWorkflow.runId)
          ?.endTimeMs ||
        Date.now(),
    });
    chainOverviewRuns = mergeWorkflowChainOverviewRuns(existingRuns, updates);
  });

  const handleTimelineInit = (t: Timeline | ClassicTimeline) => {
    timeline = t;
  };

  const loadTimelineInterval = async (
    startTimeMs: number,
    durationMs = timelineWindowControls?.windowDurationMs,
  ) => {
    if (!workflowId || !timelineWindowControls) return;
    const generation = ++intervalLoadGeneration;
    intervalLoader.abort();
    releaseIntervalModels();
    intervalTimelineRuns = [];
    intervalTruncated = false;

    const endTimeMs = startTimeMs + (durationMs ?? 0);
    const firstIndex = chainOverviewRuns.findIndex(
      (run) => run.endTimeMs >= startTimeMs,
    );
    if (firstIndex < 0) return;
    const lastIndex = chainOverviewRuns.findLastIndex(
      (run) => run.startTimeMs <= endTimeMs,
    );
    const requestedRuns = chainOverviewRuns.slice(
      Math.max(0, firstIndex - 1),
      Math.min(chainOverviewRuns.length, Math.max(firstIndex, lastIndex) + 2),
    );

    const appendModel = (model: TimelineRunModel) => {
      if (generation !== intervalLoadGeneration) return;
      if (!(model instanceof BufferTimelineRunModel)) return;
      intervalModelReleases.push(model.retain());
      const run = model.run;
      const timelineRun = {
        runId: run.runId,
        status: run.status,
        startTimeMs: run.startTimeMs,
        endTimeMs: run.endTimeMs,
        groups: toTimelineGroups(run.runId, [...model.sourceGroups], (group) =>
          model.materializeSource(group),
        ),
        active: false,
        successorRunId: run.nextRunId,
      };
      intervalTimelineRuns = [
        ...intervalTimelineRuns.filter(({ runId }) => runId !== run.runId),
        timelineRun,
      ];
    };

    const result = await intervalLoader.load({
      namespace,
      workflowId,
      runs: requestedRuns,
      startTimeMs,
      endTimeMs,
      onModel: appendModel,
    });
    if (generation !== intervalLoadGeneration) return;
    intervalTruncated = result.truncation.some(
      ({ affectsSelectedWindow }) => affectsSelectedWindow,
    );
  };

  const moveTimelineWindow = (startTimeMs: number) => {
    timelineWindowControls?.moveToTime(startTimeMs);
    void loadTimelineInterval(startTimeMs).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Unable to load the selected timeline interval.', error);
      }
    });
  };

  const resizeTimelineWindow = ({
    startTimeMs,
    endTimeMs,
    anchor,
  }: {
    startTimeMs: number;
    endTimeMs: number;
    anchor: 'start' | 'end';
  }) => {
    const durationMs = clampTimelineWindowDuration(endTimeMs - startTimeMs);
    const resizedStartTimeMs =
      anchor === 'end' ? endTimeMs - durationMs : startTimeMs;
    timelineWindowControls?.resize(
      resizedStartTimeMs,
      resizedStartTimeMs + durationMs,
      anchor,
    );
    void loadTimelineInterval(resizedStartTimeMs, durationMs).catch(
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Unable to load the resized timeline interval.', error);
        }
      },
    );
  };

  const jumpTimelineToBeginning = () => {
    timelineWindowControls?.jumpToBeginning();
    const chainStartTimeMs = chainOverviewRuns[0]?.startTimeMs;
    if (chainStartTimeMs === undefined) return;
    void loadTimelineInterval(chainStartTimeMs).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Unable to load the beginning of the timeline.', error);
      }
    });
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
          active={displayMode === 'classic'}
          data-testid="timeline-classic"
          onclick={() => onDisplayMode('classic')}
          size="sm"
        >
          {translate('workflows.timeline-classic')}
        </ToggleButton>
      </ToggleButtons>
      {#if displayMode === 'fixed-window' && timelineWindowControls}
        <ToggleButtons
          role="group"
          aria-label={translate('workflows.timeline-zoom-controls')}
          data-testid="timeline-zoom-controls"
        >
          <ToggleButton
            active={timelineWindowControls.atFullDuration}
            disabled={chainOverviewLoading}
            data-testid="timeline-full-duration"
            onclick={timelineWindowControls.fitToFullDuration}
            size="sm"
          >
            {translate('workflows.timeline-full-duration')}
          </ToggleButton>
          <ToggleButton
            LeadingIcon={IconHyphen}
            aria-label={translate('workflows.timeline-zoom-out')}
            title={translate('workflows.timeline-zoom-out')}
            disabled={!timelineWindowControls.canZoomOut}
            data-testid="timeline-zoom-out"
            onclick={timelineWindowControls.zoomOut}
            size="sm"
          >
            <span class="sr-only"
              >{translate('workflows.timeline-zoom-out')}</span
            >
          </ToggleButton>
          <span
            class="border-default flex min-w-12 items-center justify-center border-y px-2 text-xs font-medium tabular-nums text-secondary"
            aria-live="polite"
            aria-label={translate('workflows.timeline-window-duration')}
          >
            {formatTimelineWindowDuration(
              timelineWindowControls.windowDurationMs,
            )}
          </span>
          <ToggleButton
            LeadingIcon={IconAdd}
            aria-label={translate('workflows.timeline-zoom-in')}
            title={translate('workflows.timeline-zoom-in')}
            disabled={!timelineWindowControls.canZoomIn}
            data-testid="timeline-zoom-in"
            onclick={timelineWindowControls.zoomIn}
            size="sm"
          >
            <span class="sr-only"
              >{translate('workflows.timeline-zoom-in')}</span
            >
          </ToggleButton>
        </ToggleButtons>
        <ToggleButtons
          role="group"
          aria-label={translate('workflows.timeline-window-controls')}
          data-testid="sliding-window-controls"
        >
          <ToggleButton
            LeadingIcon={IconArrowLeft}
            disabled={chainOverviewLoading ||
              timelineWindowControls.atBeginning}
            data-testid="timeline-window-beginning"
            onclick={jumpTimelineToBeginning}
            size="sm"
          >
            {translate('workflows.timeline-jump-beginning')}
          </ToggleButton>
          <ToggleButton
            LeadingIcon={timelineWindowControls.mode === 'paused'
              ? IconPlay
              : IconPause}
            active={timelineWindowControls.mode === 'paused' &&
              !timelineWindowControls.atCurrent}
            disabled={timelineWindowControls.mode === 'paused' &&
              timelineWindowControls.atCurrent}
            data-testid="timeline-window-playback"
            onclick={timelineWindowControls.mode === 'paused'
              ? timelineWindowControls.resume
              : timelineWindowControls.pause}
            size="sm"
          >
            {timelineWindowControls.mode === 'paused'
              ? translate('workflows.timeline-resume')
              : translate('workflows.timeline-pause')}
          </ToggleButton>
          <ToggleButton
            LeadingIcon={IconArrowRight}
            disabled={timelineWindowControls.atCurrent}
            data-testid="timeline-window-current"
            onclick={timelineWindowControls.jumpToCurrent}
            size="sm"
          >
            {translate(
              isNotPending
                ? 'workflows.timeline-jump-end'
                : 'workflows.timeline-jump-current',
            )}
          </ToggleButton>
        </ToggleButtons>
      {/if}
      <ToggleButtons>
        <ToggleButton
          LeadingIcon={reverseSort ? IconArrowDescending : IconArrowAscending}
          data-testid="timeline-sort"
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
    {#if displayMode === 'fixed-window'}
      <TimelineChainOverview
        runs={chainOverviewRuns}
        loading={chainOverviewLoading}
        windowStartTimeMs={timelineWindowControls?.windowStartTimeMs}
        windowEndTimeMs={timelineWindowControls?.windowEndTimeMs}
        windowDurationMs={timelineWindowControls?.windowDurationMs}
        windowMode={timelineWindowControls?.mode}
        onWindowMove={moveTimelineWindow}
        onWindowResize={resizeTimelineWindow}
      />
    {/if}
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
        {firstEventTime}
        error={Boolean(workflowTaskFailedError)}
        onTimelineInit={handleTimelineInit}
        onRetentionWindow={workflowRunCtx.pruneRetainedRuns}
        rowHeightRetentionScopeId={workflowRunCtx.following
          ? workflowRunCtx.chainRunId
          : workflow.runId}
        knownChainStartRunId={workflowRunCtx.chainRunId}
        chainStartTimeMs={chainOverviewRuns[0]?.startTimeMs}
        bind:windowControls={timelineWindowControls}
        {timelineRuns}
      />
    {/if}
    {#if workflowRunCtx.truncation?.affectsVisibleInterval || intervalTruncated}
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
