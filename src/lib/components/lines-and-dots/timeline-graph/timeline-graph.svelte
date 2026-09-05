<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';

  import { flushSync, onDestroy, untrack } from 'svelte';
  import { twMerge } from 'tailwind-merge';

  import { timestamp } from '$lib/components/timestamp.svelte';
  import { translate } from '$lib/i18n/translate';
  import { allEventTypeOptions } from '$lib/models/event-history/get-event-categorization';
  import {
    type ChainRetentionWindow,
    getChainRetentionWindow,
    materializeTimelineGroup,
    type TimelineGroup,
    type TimelineRun,
    toTimelineGroups,
  } from '$lib/services/chain-workflow-session';
  import type { LazyGroup } from '$lib/services/grouped-event-buffer';
  import { RecursiveWorkflowSession } from '$lib/services/recursive-workflow-session.svelte';
  import { activeGroups, clearActiveGroups } from '$lib/stores/active-events';
  import { collapseIdleTime } from '$lib/stores/event-view';
  import { pauseLiveUpdates } from '$lib/stores/events';
  import { eventStatusFilter, eventTypeFilter } from '$lib/stores/filters';
  import type { WorkflowExecution } from '$lib/types/workflows';
  import { isWorkflowDelayed } from '$lib/utilities/delayed-workflows';
  import { type ValidTime, validTimeToDate } from '$lib/utilities/format-time';
  import { getWorkflowStatusLabel } from '$lib/utilities/get-status-label';

  import { dotColors, strokeColor } from '../colors';
  import EndTimeInterval from '../end-time-interval.svelte';
  import { DOT_STROKE, GUTTER, RADIUS, ROW_HEIGHT } from './constants';
  import {
    flattenWorkflowNodes,
    getTimelineChildExecution,
    type TimelineChildEdge,
    timelineRunKey,
  } from './recursive-timeline-model';
  import {
    getTimelineChildToggleExitOffset,
    getTimelineChildToggleRowTops,
    isTimelineChildToggleOriginRow,
  } from './timeline-child-toggle-motion';
  import {
    getRecursiveTimelineContainmentLayout,
    type TimelineContainmentLayout,
    type TimelineLayoutRow,
  } from './timeline-containment-layout';
  import {
    DEFAULT_TIMELINE_DISPLAY_MODE,
    expandedDurationPerViewportMs,
    fixedWindowScaleDurationMs,
  } from './timeline-display-mode';
  import { TimelineEntryWindowIndex } from './timeline-entry-window-index';
  import { shouldMoveFocusToTimeline } from './timeline-focus';
  import {
    getRecursiveFrameCandidates,
    type RecursiveFrameCandidates,
  } from './timeline-frame-visibility';
  import { timelineGroupIntersectsViewport } from './timeline-group-window';
  import {
    isTimelineCoordinateRebase,
    TimelineMotion,
  } from './timeline-motion';
  import {
    type TimelinePerformanceStats,
    TimelinePerformanceTracker,
  } from './timeline-performance';
  import { getRowY, getTotalForY } from './timeline-positioning';
  import {
    TimelinePresentationController,
    TimelineSceneBlockCache,
  } from './timeline-presentation-chunks';
  import {
    initialTimelinePaintRows,
    nextTimelinePaintRows,
    shouldBatchTimelineRows,
  } from './timeline-progressive-rows';
  import {
    getTimelineEntryAnimationStartTranslate,
    getTimelineFrameBoundaryOffset,
    getTimelineHorizontalEntryOffset,
    getTimelineRowEntryOffsets,
    shouldAnimateTimelineRowEntries,
  } from './timeline-row-entry-motion';
  import {
    TIMELINE_ROW_HEIGHT_GRACE_MS,
    TimelineRowHeightRetention,
  } from './timeline-row-height-retention';
  import {
    filterTimelineGroupEntries,
    filterTimelineGroupEntriesByStatus,
    getTimelineGroupEntry,
    type TimelineGroupEntry,
  } from './timeline-run-entries';
  import { TimelineSceneDoubleBuffer } from './timeline-scene-double-buffer';
  import {
    getTimelineSegmentedScrollModel,
    physicalYForLogicalRow,
    rebaseTimelineScroll,
    revealTimelineLogicalRow,
    TIMELINE_NORMAL_SCROLL_LIMIT_PX,
  } from './timeline-segmented-scroll';
  import type {
    TimelineWindowControls,
    TimelineWindowMode,
    TimelineWindowResizeAnchor,
  } from './timeline-window-controls';
  import {
    clampTimelineWindowDuration,
    getTimelineWindowModeAfterManualPosition,
    getTimelineWindowTimeRange,
    getTimelineWindowZoomDuration,
    TIMELINE_WINDOW_DURATIONS_MS,
    timelineWindowIsAtEnd,
  } from './timeline-window-controls';
  import type { TimelineDisplayMode } from './types';
  import { syncTimelineViewport } from './viewport-lifecycle';
  import {
    getTimelineFrameVerticalLayout,
    getWorkflowFrameGeometry,
  } from './workflow-frame-geometry';

  import GroupDetailsRow from './group-details-row.svelte';
  import TimelineAxis from './timeline-axis.svelte';
  import TimelineChildEdgeRow from './timeline-child-edge-row.svelte';
  import TimelineCollapsedLayer from './timeline-collapsed-layer.svelte';
  import TimelineGraphRow from './timeline-graph-row.svelte';
  import TimelineIconDefs from './timeline-icon-defs.svelte';
  import {
    DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS,
    TimelineScale,
  } from './timeline-scale.svelte';
  import TimelineStaticMarkerRow from './timeline-static-marker-row.svelte';
  import { Timeline } from './timeline.svelte';
  import { Viewport } from './viewport.svelte';
  import WorkflowFrame from './workflow-frame.svelte';

  interface Props {
    namespace: string;
    workflow: WorkflowExecution;
    groups: LazyGroup[];
    readOnly?: boolean;
    error?: boolean;
    reverseSort?: boolean;
    loading?: boolean;
    totalExpectedEvents?: number;
    descMinId?: number;
    firstEventTime?: string;
    panelHeight?: number;
    displayMode?: TimelineDisplayMode;
    onTimelineInit?: (timeline: Timeline) => void;
    timelineRuns?: TimelineRun[];
    onRetentionWindow?: (window: ChainRetentionWindow) => void;
    rowHeightRetentionScopeId?: string;
    knownChainStartRunId?: string;
    chainStartTimeMs?: number;
    windowControls?: TimelineWindowControls;
    performanceStats?: TimelinePerformanceStats;
    instrumentPerformance?: boolean;
    modelLoading?: boolean;
    sceneGeneration?: object;
    disableVirtualization?: boolean;
  }

  let {
    namespace,
    workflow,
    groups,
    readOnly = false,
    error = false,
    reverseSort = false,
    loading = false,
    totalExpectedEvents = 0,
    descMinId = 0,
    firstEventTime,
    panelHeight = $bindable(0),
    displayMode = DEFAULT_TIMELINE_DISPLAY_MODE,
    onTimelineInit,
    timelineRuns = [],
    onRetentionWindow,
    rowHeightRetentionScopeId,
    knownChainStartRunId = workflow.runId,
    chainStartTimeMs,
    windowControls = $bindable(),
    performanceStats = $bindable(),
    instrumentPerformance = false,
    modelLoading = false,
    sceneGeneration,
    disableVirtualization = false,
  }: Props = $props();

  let nowMs = $state(Date.now());

  const workflowRuns = $derived(
    timelineRuns.length
      ? timelineRuns
      : [
          {
            runId: workflow.runId,
            status: workflow.status,
            startTimeMs: Date.parse(workflow.startTime),
            endTimeMs: workflow.endTime ? Date.parse(workflow.endTime) : nowMs,
            groups: toTimelineGroups(workflow.runId, groups),
            active: true,
          },
        ],
  );

  const recursiveSession = new RecursiveWorkflowSession({
    namespace: untrack(() => namespace),
    workflow: untrack(() => workflow),
    runs: untrack(() => workflowRuns),
  });

  $effect(() => {
    const root = { namespace, workflow, runs: workflowRuns };
    untrack(() => recursiveSession.syncRoot(root));
  });

  $effect(() => {
    const paused = $pauseLiveUpdates;
    untrack(() => recursiveSession.setPaused(paused));
  });

  onDestroy(() => recursiveSession.dispose());

  const workflowTree = $derived(recursiveSession.snapshot);
  const workflowNodes = $derived(flattenWorkflowNodes(workflowTree));
  const incomingChildHeaderByWorkflowKey = $derived.by(() => {
    const incomingChildren = new SvelteMap<
      string,
      {
        edge: TimelineChildEdge;
        parentEntry: TimelineGroup;
        firstRunId: string;
      }
    >();
    for (const node of workflowNodes) {
      for (const edge of node.childrenByGroupKey.values()) {
        if (edge.load.state === 'loaded') {
          const parentEntry = node.runs
            .flatMap((run) => run.groups)
            .find((entry) => entry.timelineKey === edge.parentGroupKey);
          if (parentEntry) {
            incomingChildren.set(edge.load.node.key, {
              edge,
              parentEntry,
              firstRunId: edge.load.node.firstRunId,
            });
          }
        }
      }
    }
    return incomingChildren;
  });
  const allWorkflowRuns = $derived(workflowNodes.flatMap((node) => node.runs));
  const childExecutions = $derived.by(() =>
    workflowNodes.flatMap((node) =>
      [...node.childrenByGroupKey.values()].flatMap((edge) => {
        const execution = getTimelineChildExecution(edge);
        return execution ? [execution] : [];
      }),
    ),
  );
  const aggregateHasLive = $derived(
    allWorkflowRuns.some(
      (run) =>
        run.active && (run.status === 'Running' || run.status === 'Paused'),
    ) || childExecutions.some((execution) => execution.active),
  );
  const aggregateStartTimeMs = $derived.by(() => {
    let minimum = Number.POSITIVE_INFINITY;
    for (const run of allWorkflowRuns) {
      if (run.startTimeMs < minimum) minimum = run.startTimeMs;
    }
    return Number.isFinite(minimum) ? minimum : nowMs;
  });
  const aggregateEndTimeMs = $derived.by(() => {
    if (aggregateHasLive) return nowMs;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const run of allWorkflowRuns) {
      if (run.endTimeMs > maximum) maximum = run.endTimeMs;
    }
    for (const execution of childExecutions) {
      if (execution.endTimeMs !== undefined && execution.endTimeMs > maximum) {
        maximum = execution.endTimeMs;
      }
    }
    return Number.isFinite(maximum) ? maximum : nowMs;
  });

  const timelineGroupEntries = $derived(
    workflowNodes.flatMap((node) =>
      node.runs.flatMap((run) =>
        run.groups.map((entry) =>
          getTimelineGroupEntry(
            entry,
            run,
            getTimelineChildExecution(
              node.childrenByGroupKey.get(entry.timelineKey),
            ),
          ),
        ),
      ),
    ),
  );
  const allEventTypesSelected = $derived.by(() => {
    const selected = new Set($eventTypeFilter);
    return (
      selected.size === allEventTypeOptions.length &&
      allEventTypeOptions.every(({ value }) => selected.has(value))
    );
  });
  const filtersAreInactive = $derived(
    allEventTypesSelected && !$eventStatusFilter,
  );
  const eventTypeFilteredEntries = $derived.by(() =>
    allEventTypesSelected
      ? timelineGroupEntries
      : filterTimelineGroupEntries({
          entries: timelineGroupEntries,
          eventTypes: $eventTypeFilter,
          failedOrPending: false,
        }),
  );
  const renderedGroups = $derived.by<Iterable<LazyGroup>>(() => {
    const nodes = workflowNodes;
    return {
      *[Symbol.iterator]() {
        for (const node of nodes) {
          for (const run of node.runs) {
            for (const entry of run.groups) {
              yield entry.group as LazyGroup;
            }
          }
        }
      },
    };
  });
  const precompiledActiveTimeRanges = $derived.by(() => {
    // Loaded child workflows have their own time order. Until the scene
    // compiler merges those subscenes, retain the general group-based path.
    if (workflowNodes.length !== 1) return undefined;
    const ranges = [] as { startTimeMs: number; endTimeMs: number }[];
    for (const node of workflowNodes) {
      for (const run of node.runs) {
        if (!run.activeTimeRanges) return undefined;
        ranges.push(...run.activeTimeRanges);
      }
    }
    return ranges;
  });
  const retainedPendingEndTimeByGroup = $derived.by(() => {
    const endTimes = new WeakMap<LazyGroup, number>();
    for (const node of workflowNodes) {
      for (const run of node.runs) {
        for (const entry of run.groups) {
          if (!entry.group.isPending) continue;
          const edge = node.childrenByGroupKey.get(entry.timelineKey);
          const execution = getTimelineChildExecution(edge);
          if (execution) {
            if (!execution.active && execution.endTimeMs !== undefined) {
              endTimes.set(entry.group as LazyGroup, execution.endTimeMs);
            }
          } else if (!edge && !run.active) {
            endTimes.set(entry.group as LazyGroup, run.endTimeMs);
          }
        }
      }
    }
    return endTimes;
  });
  const getRetainedEndTimeMs = (group: LazyGroup): number | undefined => {
    return retainedPendingEndTimeByGroup.get(group);
  };
  const timelineLoading = $derived(loading);

  // Dot geometry, published as CSS vars on .canvas (consumed by every row's dot).
  const dotSize = 2 * RADIUS + DOT_STROKE;
  const dotRadius = RADIUS * 0.3 + DOT_STROKE / 2;

  let canvasWidth = $state(0);

  // Width via ResizeObserver, not bind:clientWidth: the latter reads clientWidth
  // in every reactive flush, forcing a full sync layout of the tall canvas.
  // contentRect.width is already computed; RAF-debounced to avoid width↔render loops.
  let containerEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!containerEl) return;
    let isFirst = true;
    let rafId: ReturnType<typeof requestAnimationFrame>;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (isFirst) {
        isFirst = false;
        canvasWidth = width;
      } else {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          canvasWidth = width;
        });
      }
    });
    observer.observe(containerEl);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  });

  const timelineWidth = $derived(canvasWidth - 2 * GUTTER);
  // Geometry is recomputed on the coarse clock while the painted world moves
  // every animation frame. Keep a narrow offscreen strip mounted on the right
  // so that transform motion cannot expose a gap against the stationary rail.
  const TIMELINE_MOTION_OVERSCAN_PX = 64;
  const renderedViewportWidthPx = $derived(
    timelineWidth +
      (displayMode === 'fixed-window' ? TIMELINE_MOTION_OVERSCAN_PX : 0),
  );
  const timeline = new Timeline({
    getFirstEventTime: () => firstEventTime,
    getWorkflow: () => workflow,
    getLazyGroups: () => renderedGroups,
    getPrecompiledActiveRanges: () => precompiledActiveTimeRanges,
    getLazyGroupEndMs: (group) => getRetainedEndTimeMs(group),
    getCurrentTimeMs: () => nowMs,
    getLoading: () => timelineLoading,
    getShouldCollapseByDefault: () => $collapseIdleTime === 'on',
    getStartTimeMs: () =>
      Math.min(chainStartTimeMs ?? aggregateStartTimeMs, aggregateStartTimeMs),
    getEndTimeMs: () => aggregateEndTimeMs,
    getEndUnbounded: () => aggregateHasLive,
  });

  const collapsedSegmentCount = $derived(
    timeline.segments.filter((segment) =>
      timeline.isTimeSegmentCollapsed(segment),
    ).length,
  );

  const viewport = new Viewport();
  let windowMode = $state<TimelineWindowMode>('following');
  let frozenAnchorTimeMs = $state<number | null>(null);
  let playbackOriginTimeMs = 0;
  let playbackStartedAtMs = 0;
  let windowLayoutRevision = $state(0);
  let fixedWindowDurationMs = $state(DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS);
  let windowDurationCustomized = $state(false);
  const durationPerViewportMs = $derived(
    displayMode === 'fixed-window'
      ? fixedWindowDurationMs
      : expandedDurationPerViewportMs({
          displayMode,
          viewportWidthPx: timelineWidth,
          expandedDurationMs: timeline.expandedDurationMs,
          collapsedSegmentCount,
        }),
  );

  const fixedWindowTimeRange = $derived.by(() => {
    if (displayMode !== 'fixed-window') return undefined;
    return getTimelineWindowTimeRange({
      following: viewport.isFollowing,
      frozenAnchorTimeMs,
      durationMs: durationPerViewportMs,
      availableStartTimeMs: timeline.workflowTimespan.startTimeMs,
      followingEndTimeMs: aggregateEndTimeMs,
    });
  });
  const fixedWindowStartTimeMs = $derived(
    fixedWindowTimeRange?.startTimeMs ??
      aggregateEndTimeMs - fixedWindowDurationMs,
  );
  const scaleDurationPerViewportMs = $derived(
    displayMode === 'fixed-window'
      ? fixedWindowScaleDurationMs({
          viewportWidthPx: timelineWidth,
          windowStartTimeMs: fixedWindowStartTimeMs,
          windowDurationMs: fixedWindowDurationMs,
          segments: timeline.segments,
          isCollapsed: (segment) => timeline.isTimeSegmentCollapsed(segment),
        })
      : durationPerViewportMs,
  );

  const scale = new TimelineScale({
    timeline,
    getViewportWidthPx: () => timelineWidth,
    getExpandedDurationPerViewportMs: () => scaleDurationPerViewportMs,
  });

  const renderedVisibleRange = $derived({
    startPx: viewport.visibleRange.startPx,
    endPx:
      viewport.visibleRange.endPx +
      (displayMode === 'fixed-window' ? TIMELINE_MOTION_OVERSCAN_PX : 0),
  });
  const viewportMotion = new TimelineMotion();
  const liveEdgeMotion = new TimelineMotion();
  const workflowIsLive = $derived(aggregateHasLive);
  const shouldAnimateTimeline = $derived(
    displayMode === 'fixed-window' &&
      ((viewport.isFollowing && workflowIsLive) || windowMode === 'playing') &&
      scale.liveEdgePxPerMs > 0,
  );

  const resetTimelineMotion = () => {
    viewportMotion.reset(viewport.offsetPx);
    liveEdgeMotion.reset(scale.totalWorldWidthPx);
    containerEl?.style.setProperty('--timeline-frame-offset', '0px');
    containerEl?.style.setProperty('--timeline-live-edge-extension', '0px');
  };

  $effect(() => {
    if (displayMode !== 'fixed-window' || workflowIsLive) return;

    let terminalWindowDurationMs = fixedWindowDurationMs;
    if (!windowDurationCustomized) {
      terminalWindowDurationMs = Math.min(
        DEFAULT_EXPANDED_DURATION_PER_VIEWPORT_MS,
        Math.max(1, timeline.workflowTimespan.durationMs),
      );
      if (fixedWindowDurationMs !== terminalWindowDurationMs) {
        fixedWindowDurationMs = terminalWindowDurationMs;
        windowLayoutRevision += 1;
      }
    }
    if (windowMode === 'following') {
      frozenAnchorTimeMs = aggregateEndTimeMs - terminalWindowDurationMs;
      viewport.moveTo(scale.project(frozenAnchorTimeMs));
      windowMode = 'paused';
      viewport.freeze();
    }
    resetTimelineMotion();
  });

  const pauseWindow = () => {
    frozenAnchorTimeMs = scale.unproject(viewport.offsetPx);
    windowMode = 'paused';
    viewport.freeze();
    resetTimelineMotion();
  };

  const resumeWindow = () => {
    frozenAnchorTimeMs ??= scale.unproject(viewport.offsetPx);
    playbackOriginTimeMs = frozenAnchorTimeMs;
    playbackStartedAtMs = Date.now();
    windowMode = 'playing';
    viewport.freeze();
    resetTimelineMotion();
  };

  const jumpToBeginning = () => {
    frozenAnchorTimeMs = timeline.workflowTimespan.startTimeMs;
    viewport.moveTo(viewport.minimumOffsetPx);
    if (windowMode !== 'paused') {
      playbackOriginTimeMs = frozenAnchorTimeMs;
      playbackStartedAtMs = Date.now();
      windowMode = 'playing';
    }
    resetTimelineMotion();
  };

  const jumpToCurrent = () => {
    viewport.resume(scale.totalWorldWidthPx, true);
    if (windowMode === 'paused') {
      frozenAnchorTimeMs = scale.unproject(viewport.offsetPx);
      viewport.freeze();
    } else {
      windowMode = 'following';
      frozenAnchorTimeMs = null;
    }
    resetTimelineMotion();
  };

  const moveWindowToTime = (startTimeMs: number) => {
    frozenAnchorTimeMs = startTimeMs;
    viewport.moveTo(scale.project(startTimeMs));
    windowMode = getTimelineWindowModeAfterManualPosition(windowMode);
    if (windowMode === 'playing') {
      playbackOriginTimeMs = startTimeMs;
      playbackStartedAtMs = Date.now();
    }
    windowLayoutRevision += 1;
    resetTimelineMotion();
  };

  const zoomWindow = (direction: 'in' | 'out') => {
    const nextDurationMs = getTimelineWindowZoomDuration(
      fixedWindowDurationMs,
      direction,
    );
    if (nextDurationMs === fixedWindowDurationMs) return;

    windowDurationCustomized = true;

    if (!viewport.isFollowing) {
      const currentStartTimeMs =
        frozenAnchorTimeMs ?? scale.unproject(viewport.offsetPx);
      const centerTimeMs = currentStartTimeMs + fixedWindowDurationMs / 2;
      const earliestStartTimeMs = timeline.workflowTimespan.startTimeMs;
      const latestStartTimeMs = Math.max(
        earliestStartTimeMs,
        aggregateEndTimeMs - nextDurationMs,
      );
      frozenAnchorTimeMs = Math.min(
        Math.max(centerTimeMs - nextDurationMs / 2, earliestStartTimeMs),
        latestStartTimeMs,
      );
    }

    fixedWindowDurationMs = nextDurationMs;
    if (windowMode === 'playing' && frozenAnchorTimeMs !== null) {
      playbackOriginTimeMs = frozenAnchorTimeMs;
      playbackStartedAtMs = Date.now();
    }
    windowLayoutRevision += 1;
    resetTimelineMotion();
  };

  const resizeWindow = (
    startTimeMs: number,
    endTimeMs: number,
    anchor: TimelineWindowResizeAnchor,
  ) => {
    windowDurationCustomized = true;
    const nextDurationMs = clampTimelineWindowDuration(endTimeMs - startTimeMs);
    const keepFollowing = viewport.isFollowing && anchor === 'end';

    if (!keepFollowing) {
      const requestedStartTimeMs =
        anchor === 'end' ? endTimeMs - nextDurationMs : startTimeMs;
      const earliestStartTimeMs = timeline.workflowTimespan.startTimeMs;
      const latestStartTimeMs = Math.max(
        earliestStartTimeMs,
        aggregateEndTimeMs - nextDurationMs,
      );
      frozenAnchorTimeMs = Math.min(
        Math.max(requestedStartTimeMs, earliestStartTimeMs),
        latestStartTimeMs,
      );
      viewport.moveTo(scale.project(frozenAnchorTimeMs));
      windowMode = getTimelineWindowModeAfterManualPosition(windowMode);
    }

    fixedWindowDurationMs = nextDurationMs;
    if (windowMode === 'playing' && frozenAnchorTimeMs !== null) {
      playbackOriginTimeMs = frozenAnchorTimeMs;
      playbackStartedAtMs = Date.now();
    }
    windowLayoutRevision += 1;
    resetTimelineMotion();
  };

  const fitWindowToFullDuration = () => {
    const fullDurationMs = Math.max(1, timeline.workflowTimespan.durationMs);
    windowDurationCustomized = true;
    fixedWindowDurationMs = fullDurationMs;
    windowLayoutRevision += 1;

    if (workflowIsLive) {
      windowMode = 'following';
      frozenAnchorTimeMs = null;
      viewport.resume(scale.totalWorldWidthPx, true);
    } else {
      windowMode = 'paused';
      frozenAnchorTimeMs = timeline.workflowTimespan.startTimeMs;
      viewport.moveTo(scale.project(frozenAnchorTimeMs));
      viewport.freeze();
    }
    resetTimelineMotion();
  };

  $effect(() => {
    if (displayMode !== 'fixed-window') {
      windowControls = undefined;
      return;
    }
    const windowStartTimeMs =
      fixedWindowTimeRange?.startTimeMs ?? scale.unproject(viewport.offsetPx);
    const windowEndTimeMs =
      fixedWindowTimeRange?.endTimeMs ??
      scale.unproject(viewport.offsetPx + viewport.widthPx);
    windowControls = {
      mode: windowMode,
      atBeginning: viewport.offsetPx <= viewport.minimumOffsetPx + 0.5,
      atCurrent: timelineWindowIsAtEnd(windowEndTimeMs, aggregateEndTimeMs),
      atFullDuration:
        fixedWindowDurationMs >= timeline.workflowTimespan.durationMs,
      windowStartTimeMs,
      windowEndTimeMs,
      windowDurationMs: durationPerViewportMs,
      canZoomIn: fixedWindowDurationMs > TIMELINE_WINDOW_DURATIONS_MS[0],
      canZoomOut: fixedWindowDurationMs < TIMELINE_WINDOW_DURATIONS_MS.at(-1)!,
      pause: pauseWindow,
      resume: resumeWindow,
      zoomIn: () => zoomWindow('in'),
      zoomOut: () => zoomWindow('out'),
      fitToFullDuration: fitWindowToFullDuration,
      resize: resizeWindow,
      jumpToBeginning,
      jumpToCurrent,
      moveToTime: moveWindowToTime,
    };
  });

  $effect(() => {
    if (displayMode !== 'fixed-window' || windowMode !== 'playing') return;

    const advancePlayback = () => {
      const latestStartTimeMs = scale.unproject(viewport.maximumOffsetPx);
      const nextStartTimeMs = Math.min(
        playbackOriginTimeMs + Date.now() - playbackStartedAtMs,
        latestStartTimeMs,
      );
      frozenAnchorTimeMs = nextStartTimeMs;
      if (!workflowIsLive && nextStartTimeMs >= latestStartTimeMs) {
        windowMode = 'paused';
      }
    };

    advancePlayback();
    const interval = setInterval(advancePlayback, 250);
    return () => clearInterval(interval);
  });

  $effect(() => {
    onTimelineInit?.(timeline);
  });

  $effect(() => {
    const previousOffsetPx = viewport.offsetPx;
    const previousWorldWidthPx = viewport.totalWorldWidthPx;
    const anchoredOffsetPx =
      !viewport.isFollowing && frozenAnchorTimeMs !== null
        ? scale.project(frozenAnchorTimeMs)
        : undefined;
    viewport.setGeometry({
      widthPx: timelineWidth,
      totalWorldWidthPx: scale.totalWorldWidthPx,
      anchoredOffsetPx,
    });
    if (
      isTimelineCoordinateRebase({
        previousOffsetPx,
        nextOffsetPx: viewport.offsetPx,
        previousWorldWidthPx,
        nextWorldWidthPx: viewport.totalWorldWidthPx,
        expandedPxPerMs: scale.liveEdgePxPerMs,
      })
    ) {
      // Loading the histories around a dropped overview window changes the
      // scale after the drag has ended. Do not carry the old compositor offset
      // into that new coordinate system: it can paint the former right edge at
      // the viewport's left rail until the animation catches up.
      resetTimelineMotion();
    }
    if (displayMode === 'fixed-window' && timelineRuns.length) {
      const window = getChainRetentionWindow({
        viewport: {
          widthPx: viewport.widthPx,
          offsetPx: viewport.offsetPx,
          expandedDurationPerViewportMs: durationPerViewportMs,
          overscanViewports: 1,
          followingLiveEdge: viewport.isFollowing,
          anchorTimeMs: frozenAnchorTimeMs ?? undefined,
          hasMeasuredGeometry: viewport.widthPx > 0,
        },
        unprojectWorldPx: (worldPx) => scale.unproject(worldPx),
      });
      if (window) onRetentionWindow?.(window);
    }
  });

  $effect(() => {
    const shouldFreeze =
      displayMode === 'fixed-window' && windowMode !== 'following';
    if (shouldFreeze && viewport.isFollowing) {
      frozenAnchorTimeMs = scale.unproject(viewport.offsetPx);
    }
    syncTimelineViewport({
      viewport,
      displayMode,
      paused: shouldFreeze,
      workflowIsLive,
      totalWorldWidthPx: scale.totalWorldWidthPx,
    });
    if (viewport.isFollowing) frozenAnchorTimeMs = null;
  });

  // Smooth only the already-rendered world layers. Membership, ticks, and the
  // segment collection continue to update on the coarse live clock.
  $effect(() => {
    const element = containerEl;
    if (!element) return;

    if (!shouldAnimateTimeline) {
      viewportMotion.reset();
      liveEdgeMotion.reset();
      element.style.setProperty('--timeline-frame-offset', '0px');
      element.style.setProperty('--timeline-live-edge-extension', '0px');
      return;
    }

    let animationFrame = 0;
    const renderFrame = (frameTimeMs: number) => {
      // Two seconds of normal clock motion may be preserved. Anything larger
      // is a coordinate-system rebase (handoff, backfill, or retention prune)
      // and must snap rather than becoming a long-lived visual offset.
      const snapThresholdPx = Math.max(scale.liveEdgePxPerMs * 2_000, 1);
      const frameOffsetPx = viewportMotion.nextFrame({
        nowMs: frameTimeMs,
        committedOffsetPx: viewport.offsetPx,
        expandedPxPerMs: scale.liveEdgePxPerMs,
        animate: true,
        freeze: false,
        snapThresholdPx,
      });
      const liveEdgeExtensionPx = liveEdgeMotion.nextFrame({
        nowMs: frameTimeMs,
        committedOffsetPx: scale.totalWorldWidthPx,
        expandedPxPerMs: scale.liveEdgePxPerMs,
        animate: true,
        freeze: false,
        snapThresholdPx,
      });
      element.style.setProperty(
        '--timeline-frame-offset',
        `${frameOffsetPx}px`,
      );
      element.style.setProperty(
        '--timeline-live-edge-extension',
        `${Math.max(0, liveEdgeExtensionPx)}px`,
      );
      animationFrame = requestAnimationFrame(renderFrame);
    };

    animationFrame = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animationFrame);
  });

  const projectX = (time: ValidTime | undefined | null): number => {
    if (!time) return GUTTER;
    return (
      scale.project(validTimeToDate(time).getTime()) -
      viewport.offsetPx +
      GUTTER
    );
  };

  const getChildControlPlacement = (
    entry: TimelineGroupEntry,
  ): { x: number; fitsAfter: boolean } => {
    const controlEndTime =
      entry.group.isPending && entry.active
        ? new Date(timeline.workflowTimespan.endTimeMs).toISOString()
        : entry.group.isPending
          ? new Date(entry.runEndTimeMs).toISOString()
          : entry.group.lastEvent.eventTime;
    const endX = projectX(controlEndTime);
    const controlWidth = 20;
    const fitsAfter = endX + 34 <= canvasWidth - GUTTER;
    return {
      x: Math.max(
        GUTTER,
        Math.min(endX - controlWidth, canvasWidth - GUTTER - controlWidth),
      ),
      fitsAfter,
    };
  };

  const toggleSegment = (segmentKey: string) => {
    const segment = timeline.segments.find(
      (candidate) => candidate.timespan.key === segmentKey,
    );
    if (segment) {
      timeline.toggleTimeSegment(segment);
    }
  };

  const filteredEntries = $derived.by<TimelineGroupEntry[] | null>(() =>
    filtersAreInactive
      ? null
      : filterTimelineGroupEntriesByStatus(
          eventTypeFilteredEntries,
          $eventStatusFilter,
        ),
  );

  const fixedWindowEntryIndex = $derived(
    new TimelineEntryWindowIndex(filteredEntries ?? timelineGroupEntries),
  );

  const visibleEntries = $derived.by<TimelineGroupEntry[] | null>(() => {
    if (displayMode === 'full-duration') return filteredEntries;
    const timeRange = fixedWindowTimeRange;
    if (
      timeRange &&
      timeRange.startTimeMs <= timeline.workflowTimespan.startTimeMs &&
      timeRange.endTimeMs >= timeline.workflowTimespan.endTimeMs
    ) {
      return filteredEntries;
    }
    const candidates = timeRange
      ? fixedWindowEntryIndex.query(
          timeRange.startTimeMs,
          timeRange.endTimeMs,
          nowMs,
        ).entries
      : (filteredEntries ?? timelineGroupEntries);
    return candidates.filter((entry) =>
      timelineGroupIntersectsViewport({
        group: entry.group,
        currentTimeMs: nowMs,
        retainedEndTimeMs: entry.active ? undefined : entry.runEndTimeMs,
        project: (timeMs) => scale.project(timeMs),
        visibleRange: renderedVisibleRange,
        visibleTimeRange: fixedWindowTimeRange,
      }),
    );
  });
  const totalTimelineGroupCount = $derived.by(() => {
    let count = 0;
    for (const node of workflowNodes) {
      for (const run of node.runs) count += run.groups.length;
    }
    return count;
  });
  const totalTimelinePointCount = $derived.by(() => {
    let count = 0;
    for (const node of workflowNodes) {
      for (const run of node.runs) {
        count +=
          run.pointCount ??
          run.groups.reduce(
            (runCount, entry) => runCount + entry.group.eventCount,
            0,
          );
      }
    }
    return count;
  });
  const filteredEntryCount = $derived(
    filteredEntries?.length ?? totalTimelineGroupCount,
  );
  const visibleEntryCount = $derived(
    visibleEntries?.length ?? totalTimelineGroupCount,
  );
  let observedRunId: string | undefined;

  $effect.pre(() => {
    const currentRunId = workflow.runId;
    if (observedRunId === undefined) {
      observedRunId = currentRunId;
      return;
    }
    if (currentRunId === observedRunId) return;

    observedRunId = currentRunId;
    resetTimelineMotion();
  });

  // Unfetched skeleton rows. totalExpectedEvents is already a density-adjusted
  // group count, so subtracting the loaded count is correct.
  const pendingGroupCount = $derived.by(() => {
    if (!timelineLoading) return 0;
    if (displayMode === 'fixed-window') {
      return visibleEntryCount === 0 && filteredEntryCount === 0
        ? Math.min(totalExpectedEvents || 50, 50)
        : 0;
    }
    if (!totalExpectedEvents) {
      return visibleEntryCount === 0 ? 50 : 0;
    }
    return Math.max(0, totalExpectedEvents - visibleEntryCount);
  });

  const nextFrameCandidates = $derived(
    getRecursiveFrameCandidates({
      nodes: workflowNodes,
      visibleRange:
        displayMode === 'full-duration'
          ? {
              startPx: Number.NEGATIVE_INFINITY,
              endPx: Number.POSITIVE_INFINITY,
            }
          : renderedVisibleRange,
      project: (timeMs) => scale.project(timeMs),
      liveEndTimeMs: timeline.workflowTimespan.endTimeMs,
      rootKnownChainStartRunId: knownChainStartRunId,
      visibleTimeRange: fixedWindowTimeRange,
    }),
  );
  const nextContainmentLayout = $derived(
    getRecursiveTimelineContainmentLayout({
      root: workflowTree,
      visibleEntries,
      participatingRunKeys: nextFrameCandidates.participatingRunKeys,
      reverseSort,
      pendingGroupCount,
      descMinId,
    }),
  );
  const rowPresentationScope = $derived(
    [
      rowHeightRetentionScopeId ?? workflow.runId,
      displayMode,
      reverseSort,
      $eventStatusFilter,
      $eventTypeFilter.join(','),
    ].join(':'),
  );
  type BufferedTimelineScene = {
    frameCandidates: RecursiveFrameCandidates;
    containmentLayout: TimelineContainmentLayout;
  };
  const nextBufferedScene = $derived<BufferedTimelineScene>({
    frameCandidates: nextFrameCandidates,
    containmentLayout: nextContainmentLayout,
  });
  let bufferedScene = $state.raw<BufferedTimelineScene | null>(null);
  let observedSceneBufferScope = '';
  let observedIntervalSceneGeneration: object | undefined;
  let commitNextSceneImmediately = false;
  const sceneDoubleBuffer =
    new TimelineSceneDoubleBuffer<BufferedTimelineScene>({
      delayMs: 1_100,
      keys: ({ containmentLayout, frameCandidates }) => [
        ...containmentLayout
          .rows(0, containmentLayout.rowCount)
          .map((row) => `row:${row.key}`),
        ...frameCandidates.runFrames.map((frame) => `run:${frame.key}`),
        ...frameCandidates.chainFrames.map((frame) => `chain:${frame.key}`),
      ],
      onCommit: (scene) => (bufferedScene = scene),
      shouldWait: () => recursiveSession.requestCount > 0,
    });

  $effect.pre(() => {
    const next = nextBufferedScene;
    const scope = `${rowPresentationScope}:${windowLayoutRevision}`;
    const sameScope = scope === observedSceneBufferScope;
    const sameGeneration = sceneGeneration === observedIntervalSceneGeneration;
    observedSceneBufferScope = scope;
    observedIntervalSceneGeneration = sceneGeneration;
    const deferStructuralChange =
      sameScope &&
      sameGeneration &&
      !commitNextSceneImmediately &&
      reverseSort &&
      aggregateHasLive &&
      !timelineLoading &&
      shouldAnimateTimelineRowEntries({
        totalGroupCount: filteredEntryCount,
        layoutRowCount: next.containmentLayout.rowCount,
      });
    commitNextSceneImmediately = false;
    untrack(() => sceneDoubleBuffer.publish(next, deferStructuralChange));
  });

  onDestroy(() => sceneDoubleBuffer.dispose());

  const presentedScene = $derived(bufferedScene ?? nextBufferedScene);
  const frameCandidates = $derived(presentedScene.frameCandidates);
  const participatingRunFrames = $derived(frameCandidates.runFrames);
  const containmentLayout = $derived(presentedScene.containmentLayout);
  const availableLayoutRowCount = $derived(containmentLayout.rowCount);
  let presentedLayoutRowCount = $state(0);
  let rowPresentationBatching = $state(false);
  let observedRowPresentationScope = '';
  let presentNextChildToggleImmediately = false;

  $effect(() => {
    const availableRows = availableLayoutRowCount;
    const scope = rowPresentationScope;
    if (presentNextChildToggleImmediately) {
      presentNextChildToggleImmediately = false;
      presentedLayoutRowCount = availableRows;
      rowPresentationBatching = false;
    } else if (scope !== observedRowPresentationScope) {
      observedRowPresentationScope = scope;
      presentedLayoutRowCount = initialTimelinePaintRows(availableRows);
      rowPresentationBatching = presentedLayoutRowCount < availableRows;
    } else if (presentedLayoutRowCount > availableRows) {
      presentedLayoutRowCount = availableRows;
      rowPresentationBatching = false;
    } else if (
      !rowPresentationBatching &&
      shouldBatchTimelineRows({
        availableRows,
        presentedRows: presentedLayoutRowCount,
      })
    ) {
      rowPresentationBatching = true;
    } else if (
      !rowPresentationBatching &&
      presentedLayoutRowCount < availableRows
    ) {
      presentedLayoutRowCount = availableRows;
    }

    if (
      !containerEl ||
      !rowPresentationBatching ||
      presentedLayoutRowCount >= availableRows
    ) {
      if (rowPresentationBatching && presentedLayoutRowCount >= availableRows) {
        rowPresentationBatching = false;
      }
      return;
    }

    let paintFrame = 0;
    const prepareNextBatch = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        if (scope !== observedRowPresentationScope) return;
        presentedLayoutRowCount = nextTimelinePaintRows({
          availableRows,
          presentedRows: presentedLayoutRowCount,
        });
      });
    });
    return () => {
      cancelAnimationFrame(prepareNextBatch);
      cancelAnimationFrame(paintFrame);
    };
  });

  const layoutRowCount = $derived(
    Math.min(availableLayoutRowCount, presentedLayoutRowCount),
  );
  const sceneIdentityScopes = new WeakMap<object, Map<string, object>>();
  const topologyScope = $derived.by(() => {
    const parts: string[] = [];
    for (const node of workflowNodes) {
      for (const edge of node.childrenByGroupKey.values()) {
        parts.push(`${edge.key}:${edge.expansion}:${edge.load.state}`);
      }
    }
    return parts.join('|');
  });
  const presentationSceneIdentity = $derived.by(() => {
    const base = sceneGeneration ?? containmentLayout;
    const scope = [
      reverseSort,
      $eventStatusFilter,
      $eventTypeFilter.join(','),
      topologyScope,
    ].join(':');
    let identities = sceneIdentityScopes.get(base);
    if (!identities) {
      // This identity cache is deliberately non-reactive; derived inputs drive
      // invalidation and cached values must not create additional dependencies.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      identities = new Map();
      sceneIdentityScopes.set(base, identities);
    }
    let identity = identities.get(scope);
    if (!identity) {
      identity = {};
      identities.set(scope, identity);
    }
    return identity;
  });
  const rowPresentationComplete = $derived(
    layoutRowCount >= availableLayoutRowCount,
  );
  const presentedPendingGap = $derived.by(() => {
    const gap = containmentLayout.pendingGap;
    if (!gap) return null;
    return rowPresentationComplete || gap.insertionIndex < layoutRowCount
      ? gap
      : null;
  });
  const presentedPhysicalRowCount = $derived.by(() => {
    if (rowPresentationComplete) return containmentLayout.totalRowCount;
    if (layoutRowCount <= 0) return 0;
    const lastPresentedRow = containmentLayout.rowAt(layoutRowCount - 1);
    return lastPresentedRow ? lastPresentedRow.rowIndex + 1 : layoutRowCount;
  });
  const animationLayoutRows = $derived(
    shouldAnimateTimelineRowEntries({
      totalGroupCount: filteredEntryCount,
      layoutRowCount,
    })
      ? containmentLayout.rows(0, layoutRowCount)
      : [],
  );
  const layoutRowKey = (row: TimelineLayoutRow): string => row.key;
  let previousLayoutKeys: string[] | null = null;
  let rowEntryOffsets = $state.raw(new Map<string, number>());
  let rowEntryNewKeys = $state.raw(new Set<string>());
  let rowEntryAnimating = $state(false);
  let rowEntryFrame = 0;
  let rowStackEl: HTMLUListElement | null = null;
  let childToggleExitLayerEl: HTMLDivElement | null = null;
  let rowEntryAnimations: Animation[] = [];
  let rowEntryGeneration = 0;
  let rowEntryDeadlineMs: number | null = null;
  let previousRowPresentationScope = '';
  let previousRowPresentationWasBatching = false;
  let suppressRowEntryAfterChildToggleUntilMs = 0;
  const CHILD_TOGGLE_SETTLE_MS = 1_100;
  let mountedChildToggleAnimations: Animation[] = [];
  let mountedChildToggleFrame = 0;
  let childToggleExitGeneration = 0;
  type PendingChildToggleAnimation = {
    edgeKey: string;
    previousTops: ReadonlyMap<string, number>;
    originY: number;
    exitEntries: ChildToggleExitEntry[];
    direction: 'expand' | 'collapse';
  };
  let pendingLoadedChildToggleAnimation =
    $state.raw<PendingChildToggleAnimation | null>(null);

  onDestroy(() => {
    pendingLoadedChildToggleAnimation = null;
    rowEntryGeneration += 1;
    cancelAnimationFrame(rowEntryFrame);
    rowEntryAnimations.forEach((animation) => animation.cancel());
    cancelAnimationFrame(mountedChildToggleFrame);
    mountedChildToggleAnimations.forEach((animation) => animation.cancel());
  });

  const finishRowEntry = () => {
    rowEntryGeneration += 1;
    cancelAnimationFrame(rowEntryFrame);
    rowEntryAnimations.forEach((animation) => animation.cancel());
    rowEntryAnimations = [];
    rowEntryDeadlineMs = null;
    rowEntryAnimating = false;
    rowEntryOffsets = new Map();
    rowEntryNewKeys = new Set();
  };

  const mountedRowTops = (originY: number): Map<string, number> => {
    return getTimelineChildToggleRowTops(rowStackEl, originY);
  };

  const childEdgeForKey = (edgeKey: string): TimelineChildEdge | undefined =>
    workflowNodes
      .flatMap((node) => [...node.childrenByGroupKey.values()])
      .find((edge) => edge.key === edgeKey);

  type ChildToggleExitEntry = {
    element: HTMLElement;
    key: string;
    top: number;
    kind: 'row' | 'frame';
    framePaint?: string;
  };

  const captureChildToggleExitEntries = (
    previousTops: ReadonlyMap<string, number>,
  ): ChildToggleExitEntry[] => {
    const rows = Array.from(
      rowStackEl?.querySelectorAll<HTMLElement>('li[data-timeline-key]') ?? [],
    ).flatMap((element) => {
      const key = element.dataset.timelineKey ?? '';
      const top = previousTops.get(key);
      return key && top !== undefined
        ? [
            {
              element: element.cloneNode(true) as HTMLElement,
              key,
              top,
              kind: 'row' as const,
            },
          ]
        : [];
    });
    const frames = Array.from(
      containerEl?.querySelectorAll<HTMLElement>(
        '[data-timeline-frame-entry]',
      ) ?? [],
    ).flatMap((element) => {
      const key = element.dataset.timelineEntryKey ?? '';
      const top = previousTops.get(key);
      if (!key || top === undefined) return [];
      const framePaint =
        element.querySelector<HTMLElement>('[data-frame-paint]')?.dataset
          .framePaint ?? 'identity';
      return [
        {
          element: element.cloneNode(true) as HTMLElement,
          key,
          top,
          kind: 'frame' as const,
          framePaint,
        },
      ];
    });
    return [...rows, ...frames];
  };

  const frameEntrySignature = (element: HTMLElement): string =>
    `${element.dataset.timelineEntryKey ?? ''}:${
      element.querySelector<HTMLElement>('[data-frame-paint]')?.dataset
        .framePaint ?? 'identity'
    }`;

  const mountChildToggleExitAnimations = ({
    entries,
    originY,
    direction,
    motionOffsetPx,
  }: {
    entries: ChildToggleExitEntry[];
    originY: number;
    direction: 'expand' | 'collapse';
    motionOffsetPx: number;
  }): {
    animations: Animation[];
    cleanup: () => void;
    offsetPx: number;
  } => {
    const mountedRowKeys = new Set(
      Array.from(
        rowStackEl?.querySelectorAll<HTMLElement>('li[data-timeline-key]') ??
          [],
      ).map((row) => row.dataset.timelineKey ?? ''),
    );
    const mountedFrameSignatures = new Set(
      Array.from(
        containerEl?.querySelectorAll<HTMLElement>(
          '[data-timeline-frame-entry]',
        ) ?? [],
      ).map(frameEntrySignature),
    );
    const exiting = entries.filter((entry) =>
      entry.kind === 'row'
        ? !mountedRowKeys.has(entry.key)
        : !mountedFrameSignatures.has(
            `${entry.key}:${entry.framePaint ?? 'identity'}`,
          ),
    );
    const layerOrder = (entry: ChildToggleExitEntry): number =>
      entry.kind === 'row' ? 1 : entry.framePaint === 'background' ? 0 : 2;
    const ordered = exiting.toSorted(
      (left, right) => layerOrder(left) - layerOrder(right),
    );
    if (!childToggleExitLayerEl || !ordered.length) {
      return { animations: [], cleanup: () => undefined, offsetPx: 0 };
    }
    const clones: HTMLElement[] = [];
    for (const entry of ordered) {
      const clone = entry.element.cloneNode(true) as HTMLElement;
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('inert', '');
      clone
        .querySelectorAll('[id]')
        .forEach((element) => element.removeAttribute('id'));
      // This layer is reserved for detached animation snapshots, so Svelte
      // never reconciles its children.
      // eslint-disable-next-line svelte/no-dom-manipulating
      childToggleExitLayerEl.append(clone);
      clones.push(clone);
    }
    const layer = childToggleExitLayerEl;
    const layerTop = layer.getBoundingClientRect().top;
    const clipBoundaryY = originY + ROW_HEIGHT / 2;
    const clipTop = Math.max(0, clipBoundaryY - layerTop);
    const fallbackOffsetPx = Math.max(
      0,
      ...exiting
        .filter((entry) => entry.kind === 'row')
        .map((entry) => entry.top + ROW_HEIGHT - clipBoundaryY),
    );
    const exitOffsetPx =
      direction === 'collapse' ? fallbackOffsetPx : motionOffsetPx;
    const generation = ++childToggleExitGeneration;
    layer.style.zIndex = direction === 'expand' ? '30' : '10';
    if (direction === 'collapse') {
      layer.style.clipPath = `inset(${clipTop}px 0 0 0)`;
    } else {
      layer.style.removeProperty('clip-path');
    }
    const animations = clones.map((clone, index) => {
      const entry = ordered[index];
      const translatePx = getTimelineChildToggleExitOffset({
        direction,
        kind: entry.kind,
        top: entry.top,
        originY,
        rowHeight: ROW_HEIGHT,
        offsetPx: exitOffsetPx,
      });
      return clone.animate(
        [{ translate: '0 0' }, { translate: `0 ${translatePx}px` }],
        {
          duration: 1200,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
    });
    return {
      animations,
      cleanup: () => {
        clones.forEach((clone) => clone.remove());
        if (childToggleExitGeneration === generation) {
          layer.style.removeProperty('clip-path');
          layer.style.removeProperty('z-index');
        }
      },
      offsetPx: exitOffsetPx,
    };
  };

  const animateMountedRowsAfterChildToggle = ({
    previousTops,
    originY,
    exitEntries = [],
    direction = 'expand',
  }: {
    previousTops: ReadonlyMap<string, number>;
    originY: number;
    exitEntries?: ChildToggleExitEntry[];
    direction?: 'expand' | 'collapse';
  }) => {
    const rowOffsets = new SvelteMap<string, number>();
    const collapsing = direction === 'collapse';
    const candidateRows = Array.from(
      rowStackEl?.querySelectorAll<HTMLElement>('li[data-timeline-key]') ?? [],
    )
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => ({
        element: row,
        key: row.dataset.timelineKey ?? '',
        top: row.getBoundingClientRect().top,
      }))
      .filter(
        ({ key, top }) =>
          previousTops.has(key) ||
          Math.abs(top - originY) <= window.innerHeight * 2,
      )
      .sort(
        (left, right) =>
          Number(previousTops.has(right.key)) -
            Number(previousTops.has(left.key)) ||
          Math.abs(left.top - originY) - Math.abs(right.top - originY),
      )
      .slice(0, 256);
    const candidateFrames = Array.from(
      containerEl?.querySelectorAll<HTMLElement>(
        '[data-timeline-frame-entry]',
      ) ?? [],
    ).filter((frame) => !frame.closest('[data-child-toggle-exit-layer]'));
    const expansionOffsetPx = collapsing
      ? 0
      : Math.max(
          0,
          ...candidateRows.map(({ key, top }) => {
            const previousTop = previousTops.get(key);
            return previousTop === undefined
              ? top + ROW_HEIGHT - (originY + ROW_HEIGHT / 2)
              : top - previousTop;
          }),
        );
    const exit = mountChildToggleExitAnimations({
      entries: exitEntries,
      originY,
      direction,
      motionOffsetPx: expansionOffsetPx,
    });
    const rowAnimations = candidateRows.flatMap(({ element, key, top }) => {
      const offsetPx = collapsing
        ? top > originY
          ? exit.offsetPx
          : 0
        : previousTops.has(key) && top > originY
          ? -expansionOffsetPx
          : (previousTops.get(key) ?? originY) - top;
      rowOffsets.set(key, offsetPx);
      if (!offsetPx) return [];
      return [
        element.animate(
          [{ translate: `0 ${offsetPx}px` }, { translate: '0 0' }],
          {
            duration: 1200,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
        ),
      ];
    });
    const previousFrameKeys = new Set(
      exitEntries
        .filter((entry) => entry.kind === 'frame')
        .map((entry) => entry.key),
    );
    const frameControlOffsets = new SvelteMap<string, number>();
    for (const frame of candidateFrames) {
      const key = frame.dataset.timelineEntryKey ?? '';
      const control = frame.querySelector<HTMLElement>(
        'button[aria-label^="Expand child workflow"], button[aria-label^="Collapse child workflow"]',
      );
      if (!key || !control) continue;
      const bounds = control.getBoundingClientRect();
      const centerY = bounds.top + bounds.height / 2;
      const offsetPx = collapsing
        ? centerY > originY
          ? exit.offsetPx
          : 0
        : previousFrameKeys.has(key)
          ? centerY > originY
            ? -expansionOffsetPx
            : (rowOffsets.get(key) ?? 0)
          : originY - centerY;
      frameControlOffsets.set(key, offsetPx);
    }
    const frameAnimations = candidateFrames.flatMap((frame) => {
      const key = frame.dataset.timelineEntryKey ?? '';
      const offsetPx = frameControlOffsets.get(key) ?? rowOffsets.get(key);
      if (!offsetPx) return [];
      return [
        frame.animate(
          [{ translate: `0 ${offsetPx}px` }, { translate: '0 0' }],
          {
            duration: 1200,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
        ),
      ];
    });
    mountedChildToggleAnimations = [
      ...rowAnimations,
      ...frameAnimations,
      ...exit.animations,
    ];
    const animations = mountedChildToggleAnimations;
    animations.forEach((animation) => {
      animation.pause();
      animation.currentTime = 0;
    });
    cancelAnimationFrame(mountedChildToggleFrame);
    mountedChildToggleFrame = requestAnimationFrame(() => {
      if (mountedChildToggleAnimations !== animations) return;
      animations.forEach((animation) => animation.play());
    });
    void Promise.allSettled(
      animations.map((animation) => animation.finished),
    ).then(() => {
      exit.cleanup();
      if (mountedChildToggleAnimations === animations) {
        mountedChildToggleAnimations = [];
      }
    });
  };

  const expandChildAfterLoad = async (
    pending: PendingChildToggleAnimation,
  ): Promise<void> => {
    let edge = childEdgeForKey(pending.edgeKey);
    while (
      pendingLoadedChildToggleAnimation === pending &&
      (edge?.load.state === 'idle' ||
        edge?.load.state === 'evicted' ||
        edge?.load.state === 'loading')
    ) {
      await new Promise(requestAnimationFrame);
      edge = childEdgeForKey(pending.edgeKey);
    }
    if (
      pendingLoadedChildToggleAnimation !== pending ||
      edge?.expansion !== 'collapsed' ||
      edge.load.state !== 'loaded'
    ) {
      if (pendingLoadedChildToggleAnimation === pending) {
        pendingLoadedChildToggleAnimation = null;
      }
      return;
    }

    const currentTops = mountedRowTops(pending.originY);
    const currentEntries = captureChildToggleExitEntries(currentTops);
    const originEntries = pending.exitEntries.filter((entry) =>
      isTimelineChildToggleOriginRow({
        kind: entry.kind,
        top: entry.top,
        originY: pending.originY,
        rowHeight: ROW_HEIGHT,
      }),
    );
    const originKeys = new SvelteSet(originEntries.map((entry) => entry.key));
    const refreshedTops = new SvelteMap(currentTops);
    for (const entry of originEntries) refreshedTops.set(entry.key, entry.top);
    pending.previousTops = refreshedTops;
    pending.exitEntries = [
      ...currentEntries.filter((entry) => !originKeys.has(entry.key)),
      ...originEntries,
    ];
    pendingLoadedChildToggleAnimation = null;
    mountedChildToggleAnimations.forEach((animation) => animation.cancel());
    mountedChildToggleAnimations = [];
    commitNextSceneImmediately = true;
    presentNextChildToggleImmediately = true;
    suppressRowEntryAfterChildToggleUntilMs =
      performance.now() + CHILD_TOGGLE_SETTLE_MS + 1200;
    flushSync(() => recursiveSession.toggle(pending.edgeKey));
    animateMountedRowsAfterChildToggle(pending);
  };

  const toggleChild = (edgeKey: string) => {
    flushSync(() => sceneDoubleBuffer.flush());
    const edgeBeforeToggle = childEdgeForKey(edgeKey);
    const expanding = edgeBeforeToggle?.expansion === 'collapsed';
    const stageUnloadedExpansion =
      expanding &&
      edgeBeforeToggle?.load.state !== 'loaded' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const activeElement = document.activeElement;
    const originY =
      activeElement instanceof HTMLElement
        ? activeElement.getBoundingClientRect().top +
          activeElement.getBoundingClientRect().height / 2
        : (containerEl?.getBoundingClientRect().top ?? 0);
    const previousTops = mountedRowTops(originY);
    const exitEntries = captureChildToggleExitEntries(previousTops);
    const direction = expanding ? 'expand' : 'collapse';
    pendingLoadedChildToggleAnimation = null;
    mountedChildToggleAnimations.forEach((animation) => animation.cancel());
    mountedChildToggleAnimations = [];
    commitNextSceneImmediately = true;
    presentNextChildToggleImmediately = true;
    suppressRowEntryAfterChildToggleUntilMs =
      performance.now() + CHILD_TOGGLE_SETTLE_MS + 1200;
    if (stageUnloadedExpansion) {
      pendingLoadedChildToggleAnimation = {
        edgeKey,
        previousTops,
        originY,
        exitEntries,
        direction,
      };
      flushSync(() => recursiveSession.load(edgeKey));
      void expandChildAfterLoad(pendingLoadedChildToggleAnimation);
      return;
    }
    flushSync(() => recursiveSession.toggle(edgeKey));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    animateMountedRowsAfterChildToggle({
      previousTops,
      originY,
      exitEntries,
      direction,
    });
  };

  const currentEntryVisualOffsets = (): Map<string, number> => {
    if (!rowEntryOffsets.size) return new Map();
    // This is a one-shot compositor snapshot, not reactive component state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const offsets = new Map<string, number>();
    for (const element of containerEl?.querySelectorAll<HTMLElement>(
      '[data-timeline-entry-key]',
    ) ?? []) {
      const key = element.dataset.timelineEntryKey;
      if (!key) continue;
      const translate = getComputedStyle(element).translate;
      const y = Number.parseFloat(translate.split(/\s+/).at(-1) ?? '0');
      if (Number.isFinite(y)) offsets.set(key, y);
    }
    return offsets;
  };

  $effect.pre(() => {
    const currentKeys = animationLayoutRows.map(layoutRowKey);
    const previousKeys = previousLayoutKeys;
    previousLayoutKeys = currentKeys;
    if (suppressRowEntryAfterChildToggleUntilMs) {
      if (recursiveSession.requestCount > 0) {
        suppressRowEntryAfterChildToggleUntilMs =
          performance.now() + CHILD_TOGGLE_SETTLE_MS;
      } else if (performance.now() >= suppressRowEntryAfterChildToggleUntilMs) {
        suppressRowEntryAfterChildToggleUntilMs = 0;
      }
    }
    if (suppressRowEntryAfterChildToggleUntilMs) {
      finishRowEntry();
      return;
    }
    const initialRowPresentation =
      rowPresentationScope !== previousRowPresentationScope ||
      rowPresentationBatching ||
      previousRowPresentationWasBatching;
    previousRowPresentationScope = rowPresentationScope;
    previousRowPresentationWasBatching = rowPresentationBatching;

    if (
      previousKeys === null ||
      initialRowPresentation ||
      timelineLoading ||
      recursiveSession.requestCount > 0 ||
      !reverseSort ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      finishRowEntry();
      return;
    }

    const layoutChanged =
      previousKeys.length !== currentKeys.length ||
      previousKeys.some((key, index) => key !== currentKeys[index]);
    if (!layoutChanged) return;

    const previousKeySet = new Set(previousKeys);
    const addedKeys = currentKeys.filter((key) => !previousKeySet.has(key));
    const visualOffsets = currentEntryVisualOffsets();
    const offsets = getTimelineRowEntryOffsets(
      previousKeys,
      currentKeys,
      ROW_HEIGHT,
      visualOffsets,
    );

    const entryWasAnimating = rowEntryAnimations.length > 0;
    rowEntryAnimating = entryWasAnimating;
    rowEntryOffsets = offsets;
    rowEntryNewKeys = new Set([
      ...[...rowEntryNewKeys].filter((key) => currentKeys.includes(key)),
      ...addedKeys,
    ]);
    rowEntryGeneration += 1;
    const generation = rowEntryGeneration;
    cancelAnimationFrame(rowEntryFrame);
    rowEntryAnimations.forEach((animation) => animation.cancel());
    rowEntryAnimations = [];

    const element = rowStackEl;
    if (!element) return;
    rowEntryFrame = requestAnimationFrame(() => {
      rowEntryFrame = requestAnimationFrame(() => {
        if (rowEntryOffsets !== offsets || rowEntryGeneration !== generation) {
          return;
        }

        const elements = Array.from(
          containerEl?.querySelectorAll<HTMLElement>(
            '[data-timeline-entry-motion]',
          ) ?? [],
        );
        const durationMs = entryWasAnimating
          ? Math.max(
              1,
              (rowEntryDeadlineMs ?? performance.now()) - performance.now(),
            )
          : 1200;
        const animations = elements.flatMap((element) => {
          const initialTranslate = getTimelineEntryAnimationStartTranslate({
            computedTranslate: getComputedStyle(element).translate,
            frame: element.hasAttribute('data-timeline-frame-entry'),
          });
          if (initialTranslate === undefined) return [];
          return [
            element.animate(
              [{ translate: initialTranslate }, { translate: '0 0' }],
              {
                duration: durationMs,
                easing: entryWasAnimating
                  ? 'linear'
                  : 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both',
              },
            ),
          ];
        });
        if (!animations.length) {
          finishRowEntry();
          return;
        }

        if (!entryWasAnimating) {
          rowEntryDeadlineMs = performance.now() + 1200;
        }
        const startTime = document.timeline.currentTime;
        if (startTime !== null) {
          animations.forEach((animation) => {
            animation.startTime = startTime;
          });
        }
        rowEntryAnimations = animations;
        rowEntryAnimating = true;
        void Promise.allSettled(
          animations.map((animation) => animation.finished),
        ).then(() => {
          if (rowEntryGeneration === generation) finishRowEntry();
        });
      });
    });
  });

  const chainFrameCandidates = $derived(frameCandidates.chainFrames);
  const runFrameEntryOffset = (runKey: string): number =>
    rowEntryOffsets.get(`${runKey}:frame-header`) ?? 0;
  const workflowFrameEntryOffset = (headerKey: string): number =>
    rowEntryOffsets.get(headerKey) ?? 0;
  const horizontalEntryOffset = (
    entryKey: string,
    entryStartPx: number | undefined,
    active: boolean,
  ): number => {
    return getTimelineHorizontalEntryOffset({
      isNew: rowEntryNewKeys.has(entryKey),
      active,
      entryStartPx,
      rightRailPx: canvasWidth - GUTTER - RADIUS / 4,
    });
  };
  const frameBottomEntryOffset = ({
    topKey,
    rowEnd,
  }: {
    topKey: string;
    rowEnd: number;
  }): number =>
    getTimelineFrameBoundaryOffset({
      offsets: rowEntryOffsets,
      topKey,
      bottomKey: containmentLayout.rowAt(rowEnd - 1)?.key,
    });
  const rootChainFrameCandidate = $derived(
    chainFrameCandidates.find((candidate) => candidate.depth === 0),
  );
  const workflowFrameColor = strokeColor({ category: 'child-workflow' });
  const inheritedWorkflowDotColors = $derived(
    dotColors(rootChainFrameCandidate?.status ?? workflow.status),
  );

  const rowHeightRetention = new TimelineRowHeightRetention();
  const heightRowCount = $derived(
    rowHeightRetention.update({
      visibleRowCount: presentedPhysicalRowCount,
      nowMs,
      retain:
        displayMode === 'fixed-window' &&
        windowMode !== 'paused' &&
        (workflow.isRunning || workflow.isPaused),
      retentionDurationMs: durationPerViewportMs + TIMELINE_ROW_HEIGHT_GRACE_MS,
      retentionKey: `${rowHeightRetentionScopeId ?? workflow.runId}:${$eventStatusFilter}:${$eventTypeFilter.join(',')}:${windowLayoutRevision}`,
    }),
  );

  // Rows mounted beyond the viewport, so compositor-thread scrolling can move
  // ahead of the next main-thread sample without exposing an empty band. At a
  // 24 px row height, 32 rows cover 768 px in either direction while keeping
  // the pool bounded to roughly two viewportfuls on a laptop-sized display.
  const OVERSCAN = 0;
  const RETAINED_DOM_ROW_LIMIT = 512;
  // Single-row presentation slices keep even connector-heavy boundary installs
  // inside one frame in the DOM renderer; immutable scene blocks remain
  // independently reusable and the live/parked chunk count stays bounded.
  const PRESENTATION_CHUNK_SIZE = 1;
  const virtualizeRows = $derived(
    !disableVirtualization && availableLayoutRowCount > RETAINED_DOM_ROW_LIMIT,
  );
  const TIMELINE_VERTICAL_PADDING = ROW_HEIGHT;

  // Closed-form inverse of getRowY (both cursor segments are linear) → the
  // [start, end) row-index range to mount for a given visible band.
  // Called once per window recompute (~once per frame), not per row — the object
  // param is free here and keeps the many args readable at the call site.
  function getWindowBounds({
    bandTop,
    bandHeight,
    total,
    overscan,
    reverseSort,
    descStart,
    pendingCount,
    totalForY,
  }: {
    bandTop: number;
    bandHeight: number;
    total: number;
    overscan: number;
    reverseSort: boolean;
    descStart: number;
    pendingCount: number;
    totalForY: number;
  }): [number, number] {
    if (total === 0 || !bandHeight) {
      const cap = Math.min(total, 100);
      return reverseSort ? [Math.max(0, total - cap), total] : [0, cap];
    }
    const yMin = bandTop - overscan * ROW_HEIGHT;
    const yMax = bandTop + bandHeight + overscan * ROW_HEIGHT;
    let start = total;
    let end = 0;
    if (!reverseSort) {
      // Segment 1 [0, descStart): y = (i+2)*ROW_HEIGHT
      const seg1Start = Math.max(0, Math.ceil(yMin / ROW_HEIGHT - 2));
      const seg1End = Math.min(
        descStart,
        Math.floor(yMax / ROW_HEIGHT - 2) + 1,
      );
      if (seg1Start < seg1End) {
        start = Math.min(start, seg1Start);
        end = Math.max(end, seg1End);
      }
      // Segment 2 [descStart, N): y = (i+2+pendingCount)*ROW_HEIGHT
      const seg2Start = Math.max(
        descStart,
        Math.ceil(yMin / ROW_HEIGHT - 2 - pendingCount),
      );
      const seg2End = Math.min(
        total,
        Math.floor(yMax / ROW_HEIGHT - 2 - pendingCount) + 1,
      );
      if (seg2Start < seg2End) {
        start = Math.min(start, seg2Start);
        end = Math.max(end, seg2End);
      }
    } else {
      // Segment 1 [0, descStart): i = totalForY+1 - y/ROW_HEIGHT
      const seg1Start = Math.max(
        0,
        Math.ceil(totalForY + 1 - yMax / ROW_HEIGHT),
      );
      const seg1End = Math.min(
        descStart,
        Math.floor(totalForY + 1 - yMin / ROW_HEIGHT) + 1,
      );
      if (seg1Start < seg1End) {
        start = Math.min(start, seg1Start);
        end = Math.max(end, seg1End);
      }
      // Segment 2 [descStart, N): i = totalForY+1-pendingCount - y/ROW_HEIGHT
      const seg2Start = Math.max(
        descStart,
        Math.ceil(totalForY + 1 - pendingCount - yMax / ROW_HEIGHT),
      );
      const seg2End = Math.min(
        total,
        Math.floor(totalForY + 1 - pendingCount - yMin / ROW_HEIGHT) + 1,
      );
      if (seg2Start < seg2End) {
        start = Math.min(start, seg2Start);
        end = Math.max(end, seg2End);
      }
    }
    return start >= end ? [0, 0] : [start, end];
  }

  const startTime = $derived.by(() => {
    const earliest =
      firstEventTime &&
      (!workflow.executionTime ||
        validTimeToDate(firstEventTime).getTime() <
          validTimeToDate(workflow.executionTime).getTime())
        ? firstEventTime
        : workflow.executionTime;
    return (!isWorkflowDelayed(workflow) && earliest) || workflow.startTime;
  });

  // Active group's index in visibleGroups (-1 = none). Derived here so the row
  // pool doesn't subscribe to $activeGroups directly.
  const activeIdx = $derived.by(() => {
    if ($activeGroups.length === 0) return -1;
    const index = containmentLayout.indexOfGroup($activeGroups[0]) ?? -1;
    return index < layoutRowCount ? index : -1;
  });
  const activeLayoutRow = $derived(
    activeIdx >= 0 ? containmentLayout.rowAt(activeIdx) : undefined,
  );
  const activeRowIndex = $derived(
    activeLayoutRow?.kind === 'group' ? activeLayoutRow.rowIndex : -1,
  );

  $effect(() => {
    if ($activeGroups.length === 0) panelHeight = 0;
  });

  $effect.pre(() => {
    const activeGroupId = $activeGroups[0];
    if (
      !activeGroupId ||
      containmentLayout.indexOfGroup(activeGroupId) !== undefined
    ) {
      return;
    }

    if (containerEl?.contains(document.activeElement)) {
      containerEl.focus({ preventScroll: true });
    }
    clearActiveGroups();
    panelHeight = 0;
  });

  // Rows are already in physical display order, so an open panel shifts every
  // later row regardless of the selected event sort direction.
  function shiftFor(i: number): number {
    if (activeIdx < 0 || panelHeight === 0) return 0;
    return i > activeIdx ? panelHeight : 0;
  }

  const descStart = $derived(
    presentedPendingGap?.insertionIndex ?? layoutRowCount,
  );
  const layoutPendingCount = $derived(presentedPendingGap?.rowCount ?? 0);

  const totalForY = $derived(
    getTotalForY(layoutRowCount, layoutPendingCount, descStart),
  );

  // Widen the mount window by the panel's row span: shiftFor moves rows down but
  // getWindowBounds maps on the unshifted y, so without this they'd leave a blank.
  const windowOverscan = $derived(
    OVERSCAN + Math.ceil(panelHeight / ROW_HEIGHT),
  );

  // Full drawn height (rows + axis + detail panel). The container is this tall and
  // scrolls with the page.
  const logicalTimelineHeight = $derived(
    Math.max(
      ROW_HEIGHT * (heightRowCount + (chainFrameCandidates.length ? 3 : 2)),
      120,
    ) +
      panelHeight +
      2 * TIMELINE_VERTICAL_PADDING,
  );
  const verticalScrollModel = $derived(
    getTimelineSegmentedScrollModel({
      totalRows: heightRowCount + (chainFrameCandidates.length ? 3 : 2),
      rowHeightPx: ROW_HEIGHT,
      forceSegmented:
        containmentLayout.totalRowCount * ROW_HEIGHT >
        TIMELINE_NORMAL_SCROLL_LIMIT_PX,
    }),
  );
  let logicalOriginRow = $state(0);
  const verticalOriginOffsetPx = $derived(
    verticalScrollModel.segmented ? logicalOriginRow * ROW_HEIGHT : 0,
  );
  const timelineHeight = $derived(
    verticalScrollModel.segmented
      ? verticalScrollModel.physicalHeightPx +
          panelHeight +
          2 * TIMELINE_VERTICAL_PADDING
      : logicalTimelineHeight,
  );
  const AXIS_LABEL_ZONE = 150;
  const svgHeight = $derived(timelineHeight + AXIS_LABEL_ZONE);
  const SEGMENTED_VIEWPORT_HEIGHT_PX = 800;
  const shellHeight = $derived(
    verticalScrollModel.segmented
      ? Math.min(SEGMENTED_VIEWPORT_HEIGHT_PX, svgHeight)
      : svgHeight,
  );

  // ── Scroll-driven virtualization ────────────────────────────────────────────
  // Each frame we read the container's offset within its scroll parent to get the
  // visible pixel band, which getWindowBounds turns into a row range. Not
  // IntersectionObserver: the browser drops IO callbacks during fast scroll, so
  // the window trailed the viewport and rows blanked until it settled.
  let visibleBand = $state.raw<[number, number] | null>(null);

  // Visible pixel band, used to window full-height overlays (the collapsed-idle
  // zigzag) so they don't rasterize the entire tens-of-thousands-px canvas.
  const layerBandTop = $derived(visibleBand ? visibleBand[0] : 0);
  const layerBandHeight = $derived(
    visibleBand ? visibleBand[1] - visibleBand[0] : timelineHeight,
  );

  let scroller: HTMLElement | null = null;
  let bandRafId: ReturnType<typeof requestAnimationFrame> | undefined;
  let lastTop = NaN;
  let lastHeight = NaN;
  let stableFrames = 0;
  const STABLE_FRAMES = 8; // still frames before the sampling loop idles out

  function measureVisibleBand() {
    if (!containerEl) return;
    let top: number;
    let viewHeight: number;
    if (verticalScrollModel.segmented) {
      const rebased = rebaseTimelineScroll({
        model: verticalScrollModel,
        originRow: logicalOriginRow,
        scrollTop: containerEl.scrollTop,
        viewportHeightPx: containerEl.clientHeight,
      });
      if (rebased.originRow !== logicalOriginRow) {
        logicalOriginRow = rebased.originRow;
        containerEl.scrollTop = rebased.scrollTop;
      }
      top = containerEl.scrollTop;
      viewHeight = containerEl.clientHeight;
    } else {
      const elTop = containerEl.getBoundingClientRect().top;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
      top = viewTop - elTop;
    }

    if (top !== lastTop || viewHeight !== lastHeight) {
      lastTop = top;
      lastHeight = viewHeight;
      stableFrames = 0;
      const chunkHeight = PRESENTATION_CHUNK_SIZE * ROW_HEIGHT;
      const bandTop = virtualizeRows
        ? Math.floor(top / chunkHeight) * chunkHeight
        : top;
      const bandBottom = virtualizeRows
        ? Math.ceil((top + viewHeight) / chunkHeight) * chunkHeight
        : top + viewHeight;
      if (visibleBand?.[0] !== bandTop || visibleBand?.[1] !== bandBottom) {
        visibleBand = [bandTop, bandBottom];
      }
    } else {
      stableFrames++;
    }
  }

  function sampleBand() {
    bandRafId = undefined;
    measureVisibleBand();

    // Loop while moving; idle out once still. pokeSampler restarts it on activity.
    if (stableFrames < STABLE_FRAMES) {
      bandRafId = requestAnimationFrame(sampleBand);
    }
  }

  function prepareForVerticalMovement() {
    stableFrames = 0;
  }

  function pokeSampler() {
    prepareForVerticalMovement();
    if (bandRafId === undefined) {
      bandRafId = requestAnimationFrame(sampleBand);
    }
  }

  function sampleScrollImmediately() {
    prepareForVerticalMovement();
    measureVisibleBand();
    if (bandRafId === undefined) {
      bandRafId = requestAnimationFrame(sampleBand);
    }
  }

  const revealLogicalRow = (
    logicalRow: number,
    focusEdge?: 'first' | 'last',
  ): void => {
    if (!containerEl) return;
    const revealed = revealTimelineLogicalRow({
      model: verticalScrollModel,
      originRow: logicalOriginRow,
      logicalRow,
      viewportHeightPx: containerEl.clientHeight,
    });
    logicalOriginRow = revealed.originRow;
    containerEl.scrollTop = revealed.scrollTop;
    pokeSampler();
    if (focusEdge) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const controls = containerEl?.querySelectorAll<HTMLElement>(
            '[data-timeline-entry-key] button',
          );
          controls?.[focusEdge === 'first' ? 0 : controls.length - 1]?.focus();
        }),
      );
    }
  };

  function findScrollParent(node: HTMLElement): HTMLElement | null {
    let el = node.parentElement;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  $effect(() => {
    if (!containerEl) return;
    if (!virtualizeRows && !verticalScrollModel.segmented) {
      scroller = null;
      visibleBand = null;
      logicalOriginRow = 0;
      return;
    }
    scroller = verticalScrollModel.segmented
      ? containerEl
      : findScrollParent(containerEl);
    if (!verticalScrollModel.segmented) logicalOriginRow = 0;
    lastTop = NaN;
    lastHeight = NaN;
    stableFrames = 0;
    sampleBand();
    const target: HTMLElement | Window = scroller ?? window;
    const opts = { passive: true };
    // wheel/touchmove cover flings where `scroll` events are throttled.
    target.addEventListener('scroll', sampleScrollImmediately, opts);
    target.addEventListener('wheel', pokeSampler, opts);
    target.addEventListener('touchmove', pokeSampler, opts);
    window.addEventListener('resize', pokeSampler, opts);
    return () => {
      target.removeEventListener('scroll', sampleScrollImmediately);
      target.removeEventListener('wheel', pokeSampler);
      target.removeEventListener('touchmove', pokeSampler);
      window.removeEventListener('resize', pokeSampler);
      if (bandRafId !== undefined) cancelAnimationFrame(bandRafId);
    };
  });

  let revealedActiveGroup: string | null = null;
  $effect(() => {
    const activeGroup = $activeGroups[0] ?? null;
    if (
      !verticalScrollModel.segmented ||
      !containerEl ||
      activeIdx < 0 ||
      activeGroup === revealedActiveGroup
    ) {
      if (!activeGroup) revealedActiveGroup = null;
      return;
    }
    revealLogicalRow(activeIdx);
    revealedActiveGroup = activeGroup;
  });

  const [windowStart, windowEnd] = $derived.by(() => {
    const band = visibleBand;
    const bandTop = band ? band[0] : 0;
    const bandHeight = band ? band[1] - band[0] : Math.min(svgHeight, 1000);
    return getWindowBounds({
      bandTop: bandTop + verticalOriginOffsetPx - TIMELINE_VERTICAL_PADDING,
      bandHeight,
      total: layoutRowCount,
      overscan: windowOverscan,
      reverseSort: false,
      descStart,
      pendingCount: layoutPendingCount,
      totalForY,
    });
  });
  const renderedWindowStart = $derived(virtualizeRows ? windowStart : 0);
  const renderedWindowEnd = $derived(
    virtualizeRows ? windowEnd : layoutRowCount,
  );

  const presentationController = new TimelinePresentationController(
    PRESENTATION_CHUNK_SIZE,
    8,
  );
  const sceneBlockCache = new TimelineSceneBlockCache<{
    index: number;
    row: TimelineLayoutRow;
    chunkKey: string;
  }>();
  let presentationChunks = $state.raw(
    presentationController.update({
      sceneIdentity: untrack(() => presentationSceneIdentity),
      totalRows: 0,
      windowStart: 0,
      windowEnd: 0,
    }),
  );
  let focusedGroupId = $state<string | null>(null);
  let focusedSlotIndex = $state<number | null>(null);
  const focusedRowIndex = $derived(
    focusedGroupId
      ? (containmentLayout.indexOfGroup(focusedGroupId) ?? -1)
      : -1,
  );

  $effect(() => {
    const next = presentationController.update({
      sceneIdentity: presentationSceneIdentity,
      totalRows: layoutRowCount,
      windowStart: renderedWindowStart,
      windowEnd: renderedWindowEnd,
      pinnedRows: [activeIdx, focusedRowIndex],
      retainAll: !virtualizeRows,
    });
    if (next !== untrack(() => presentationChunks)) {
      presentationChunks = next;
    }
  });

  onDestroy(() => presentationController.clear());

  const activePresentationChunkKeys = $derived(
    new Set(
      presentationChunks.filter(({ active }) => active).map(({ key }) => key),
    ),
  );
  const presentationRows = $derived(
    presentationChunks.flatMap(
      (chunk) =>
        sceneBlockCache.get(
          presentationSceneIdentity,
          chunk,
          (rowStart, rowEnd) =>
            containmentLayout.rows(rowStart, rowEnd).map((row) =>
              Object.freeze({
                index: row.rowIndex,
                row: Object.freeze(row),
                chunkKey: chunk.key,
              }),
            ),
          [
            chunk.rowStart,
            chunk.rowEnd,
            containmentLayout.rowAt(chunk.rowStart)?.key,
            containmentLayout.rowAt(chunk.rowEnd - 1)?.key,
          ].join(':'),
        ).rows,
    ),
  );
  const pool = $derived(
    presentationRows.filter(({ chunkKey }) =>
      activePresentationChunkKeys.has(chunkKey),
    ),
  );

  const mountedRowCount = $derived(
    pool.reduce((count, slot) => count + Number(Boolean(slot)), 0),
  );

  const pooledGroupIds = $derived(
    new Set(
      pool.flatMap((slot) =>
        slot?.row.kind === 'group' ? [slot.row.entry.timelineKey] : [],
      ),
    ),
  );

  $effect.pre(() => {
    const moveFocus = shouldMoveFocusToTimeline({
      focusWithinTimeline: Boolean(
        containerEl?.contains(document.activeElement),
      ),
      focusedGroupId,
      focusedSlotIndex,
      visibleGroupIds: pooledGroupIds,
      slotGroupIds: pool.map((slot) =>
        slot?.row.kind === 'group' ? slot.row.entry.timelineKey : null,
      ),
    });

    if (!moveFocus) return;
    containerEl?.focus({ preventScroll: true });
    focusedGroupId = null;
    focusedSlotIndex = null;
  });

  const getY = $derived.by(
    () =>
      (i: number): number =>
        TIMELINE_VERTICAL_PADDING +
        physicalYForLogicalRow(
          verticalScrollModel,
          logicalOriginRow,
          getRowY(i, {
            descStart,
            pendingGroupCount: layoutPendingCount,
            totalForY,
            reverseSort: false,
          }) / ROW_HEIGHT,
        ),
  );

  const layoutRunSpans = $derived(
    containmentLayout
      .runSpans(0, layoutRowCount)
      .map((span) => ({
        ...span,
        rowEnd: Math.min(span.rowEnd, presentedPhysicalRowCount),
      }))
      .filter((span) => span.rowStart < span.rowEnd),
  );
  const layoutWorkflowSpans = $derived(
    containmentLayout
      .workflowSpans(0, layoutRowCount)
      .map((span) => ({
        ...span,
        rowEnd: Math.min(span.rowEnd, presentedPhysicalRowCount),
      }))
      .filter((span) => span.rowStart < span.rowEnd),
  );
  const frameVerticalLayout = $derived(
    getTimelineFrameVerticalLayout({
      runSpans: layoutRunSpans,
      workflowSpans: layoutWorkflowSpans,
      activeRowIndex,
      panelHeight,
      verticalPaddingPx: TIMELINE_VERTICAL_PADDING - verticalOriginOffsetPx,
    }),
  );
  const frameBandTop = $derived(virtualizeRows ? layerBandTop : 0);
  const frameBandHeight = $derived(
    virtualizeRows ? layerBandHeight : timelineHeight,
  );
  const runSpanByKey = $derived(
    new Map(layoutRunSpans.map((span) => [span.key, span])),
  );
  const workflowSpanByKey = $derived(
    new Map(layoutWorkflowSpans.map((span) => [span.workflowKey, span])),
  );

  const runFrameLayouts = $derived.by(() => {
    return participatingRunFrames.flatMap((candidate) => {
      const runKey = timelineRunKey(
        candidate.workflowKey ?? '',
        candidate.runId,
      );
      const vertical = frameVerticalLayout.runBoundsByKey.get(runKey);
      const span = runSpanByKey.get(runKey);
      if (!vertical || !span) return [];
      const incomingChild = incomingChildHeaderByWorkflowKey.get(
        candidate.workflowKey ?? '',
      );
      const relationshipStartWorldPx = incomingChild?.parentEntry.group
        .initialEvent.eventTime
        ? scale.project(
            validTimeToDate(
              incomingChild.parentEntry.group.initialEvent.eventTime,
            ).getTime(),
          )
        : candidate.startWorldPx;
      const isFirstChildRun = incomingChild?.firstRunId === candidate.runId;
      const startWorldPx = isFirstChildRun
        ? Math.max(
            relationshipStartWorldPx,
            Math.min(candidate.startWorldPx, relationshipStartWorldPx + 12),
          )
        : candidate.startWorldPx;
      return [
        {
          candidate,
          span,
          geometry: getWorkflowFrameGeometry({
            startWorldPx,
            endWorldPx: candidate.endWorldPx,
            viewportOffsetPx: viewport.offsetPx,
            viewportWidthPx: renderedViewportWidthPx,
            gutterPx: GUTTER,
            topPx: vertical.topPx,
            bottomPx: vertical.bottomPx,
            startBoundaryKnown: candidate.startBoundaryKnown,
            endBoundaryKnown: candidate.endBoundaryKnown,
            labelInsetPx: 2 * RADIUS,
          }),
        },
      ];
    });
  });
  const chainFrameLayouts = $derived.by(() => {
    return chainFrameCandidates.flatMap((candidate) => {
      const workflowKey = candidate.workflowKey ?? '';
      const vertical = frameVerticalLayout.workflowBoundsByKey.get(workflowKey);
      const span = workflowSpanByKey.get(workflowKey);
      if (!vertical || !span) return [];
      const incomingChild = incomingChildHeaderByWorkflowKey.get(workflowKey);
      const relationshipStartWorldPx = incomingChild?.parentEntry.group
        .initialEvent.eventTime
        ? scale.project(
            validTimeToDate(
              incomingChild.parentEntry.group.initialEvent.eventTime,
            ).getTime(),
          )
        : candidate.startWorldPx;
      const relationshipEndTimeMs = incomingChild?.parentEntry.group.lastEvent
        .eventTime
        ? validTimeToDate(
            incomingChild.parentEntry.group.lastEvent.eventTime,
          ).getTime()
        : undefined;
      const relationshipEndWorldPx =
        relationshipEndTimeMs === undefined
          ? candidate.endWorldPx
          : scale.project(relationshipEndTimeMs);
      const startWorldPx = Math.min(
        relationshipStartWorldPx,
        candidate.startWorldPx,
      );
      const endWorldPx = Math.max(relationshipEndWorldPx, candidate.endWorldPx);
      return [
        {
          candidate,
          span,
          geometry: getWorkflowFrameGeometry({
            startWorldPx,
            endWorldPx,
            viewportOffsetPx: viewport.offsetPx,
            viewportWidthPx: renderedViewportWidthPx,
            gutterPx: GUTTER,
            topPx: vertical.topPx,
            bottomPx: vertical.bottomPx,
            startBoundaryKnown: candidate.startBoundaryKnown,
            endBoundaryKnown: candidate.endBoundaryKnown,
            labelInsetPx: 2 * RADIUS,
          }),
        },
      ];
    });
  });
  const frameIntersectsBand = (frame: {
    geometry: { topPx: number; bottomPx: number };
  }): boolean =>
    frame.geometry.bottomPx >= frameBandTop &&
    frame.geometry.topPx <= frameBandTop + frameBandHeight;
  const presentedRunFrameLayouts = $derived(
    virtualizeRows
      ? runFrameLayouts.filter(frameIntersectsBand)
      : runFrameLayouts,
  );
  const presentedChainFrameLayouts = $derived(
    virtualizeRows
      ? chainFrameLayouts.filter(frameIntersectsBand)
      : chainFrameLayouts,
  );

  let sceneRevision = $state(0);
  let projectionRevision = $state(0);
  let observedSceneIdentity: object | null = null;
  let observedProjectionKey = '';

  $effect(() => {
    const identity = presentationSceneIdentity;
    if (identity === observedSceneIdentity) return;
    observedSceneIdentity = identity;
    sceneRevision += 1;
  });

  $effect(() => {
    const key = [
      canvasWidth,
      viewport.offsetPx,
      displayMode,
      collapsedSegmentCount,
      windowLayoutRevision,
    ].join(':');
    if (key === observedProjectionKey) return;
    observedProjectionKey = key;
    projectionRevision += 1;
  });

  const performanceTracker = new TimelinePerformanceTracker();
  let performanceUpdateStartedAt = 0;
  let performanceUpdateRevision = '';
  let lastRecordedPerformanceRevision = '';

  const getPerformanceUpdateRevision = (): string =>
    [
      virtualizeRows ? windowStart : 0,
      virtualizeRows ? windowEnd : layoutRowCount,
      layoutRowCount,
      mountedRowCount,
      fixedWindowDurationMs,
      windowLayoutRevision,
      presentedRunFrameLayouts.length,
      presentedChainFrameLayouts.length,
    ].join(':');

  $effect.pre(() => {
    if (!instrumentPerformance) return;
    performanceUpdateStartedAt = performance.now();
    performanceUpdateRevision = getPerformanceUpdateRevision();
  });

  $effect(() => {
    if (!instrumentPerformance) return;
    const revision = getPerformanceUpdateRevision();
    const element = containerEl;
    if (
      !element ||
      revision !== performanceUpdateRevision ||
      revision === lastRecordedPerformanceRevision
    ) {
      return;
    }
    lastRecordedPerformanceRevision = revision;

    const updateMs = performance.now() - performanceUpdateStartedAt;
    performanceStats = performanceTracker.record({
      logicalRows: layoutRowCount,
      mountedRows: mountedRowCount,
      renderedLines: pool.reduce(
        (count, slot) =>
          count +
          (slot?.row.kind === 'group'
            ? Math.max(
                0,
                (('eventPoints' in slot.row.entry.group
                  ? slot.row.entry.group.eventPoints?.length
                  : undefined) ?? slot.row.entry.group.eventCount) - 1,
              )
            : 0),
        0,
      ),
      renderedElements: mountedRowCount,
      updateMs,
    });
  });

  // Border rails span the full timeline height so they meet the bottom axis.
  const lineTop = 0;
  const lineBottom = $derived(timelineHeight);
</script>

<div
  id="event-history-timeline-graph"
  role="region"
  aria-label={translate('workflows.timeline-tab')}
  data-display-mode={displayMode}
  data-viewport-offset={viewport.offsetPx}
  data-viewport-following={viewport.isFollowing}
  data-live-paused={$pauseLiveUpdates}
  class:timeline-motion-active={shouldAnimateTimeline}
  class={twMerge(
    'timeline-height-shell relative border border-t-0 border-subtle bg-primary',
    verticalScrollModel.segmented ? 'overflow-y-auto' : 'overflow-hidden',
    error && 'bg-danger',
  )}
  style:height="{shellHeight}px"
  data-segmented-scroll={verticalScrollModel.segmented || undefined}
  data-virtualized-rows={virtualizeRows || undefined}
  data-logical-row-count={layoutRowCount}
  data-logical-point-count={totalTimelinePointCount}
  data-available-row-count={availableLayoutRowCount}
  data-row-presentation-complete={rowPresentationComplete}
  data-scene-revision={sceneRevision}
  data-projection-revision={projectionRevision}
  data-presentation-revision={presentationController.counters.updates}
  data-scene-ready={rowPresentationComplete &&
    recursiveSession.requestCount === 0 &&
    !modelLoading}
  data-model-ready={!modelLoading}
  aria-busy={!rowPresentationComplete || undefined}
  data-mounted-row-count={performanceStats?.mountedRows}
  data-rendered-line-count={performanceStats?.renderedLines}
  data-rendered-element-count={performanceStats?.renderedElements}
  data-update-ms={performanceStats?.updateMs}
  data-update-p95-ms={performanceStats?.p95UpdateMs}
  data-update-sample-count={performanceStats?.sampleCount}
  data-update-sequence={performanceStats?.sequence}
  data-window-duration-ms={fixedWindowDurationMs}
  data-logical-origin-row={verticalScrollModel.segmented
    ? logicalOriginRow
    : undefined}
  bind:this={containerEl}
  tabindex="-1"
>
  {#if verticalScrollModel.segmented}
    <button
      class="sr-only z-50 focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      onclick={() => revealLogicalRow(0, 'first')}
    >
      {translate('workflows.timeline-jump-beginning')}
    </button>
    <button
      class="sr-only z-50 focus:not-sr-only focus:absolute focus:left-40 focus:top-2"
      onclick={() => revealLogicalRow(layoutRowCount - 1, 'last')}
    >
      {translate('workflows.timeline-jump-current')}
    </button>
  {/if}
  <EndTimeInterval
    {workflow}
    {startTime}
    live={aggregateHasLive}
    endTimeOverride={aggregateEndTimeMs}
    bind:currentTime={nowMs}
  >
    {#snippet children({ endTime })}
      {@const visibleStartTime = fixedWindowTimeRange?.startTimeMs ?? startTime}
      {@const visibleEndTime = fixedWindowTimeRange?.endTimeMs ?? endTime}
      <div
        class="pointer-events-none sticky top-[120px]"
        class:invisible={!!$activeGroups.length}
      >
        <div class="flex w-full justify-between text-xs">
          <p class="w-60 -translate-x-24 rotate-90">
            {$timestamp(visibleStartTime, { format: 'short' })}
          </p>
          <p class="w-60 translate-x-24 rotate-90">
            {$timestamp(visibleEndTime, { format: 'short' })}
          </p>
        </div>
      </div>
      <!-- Tall scrolled layer; rows/lines/dots are absolutely-positioned divs,
         only the windowed slots exist in the DOM. -->
      <div
        class="canvas"
        style:width="{canvasWidth}px"
        style:height="{svgHeight}px"
        style:--dot="{dotSize}px"
        style:--dot-r="{dotRadius}px"
        style:--timeline-gutter="{GUTTER}px"
        style:--timeline-clip-inset="{GUTTER + RADIUS / 4}px"
      >
        <TimelineIconDefs />

        <!-- Border rails -->
        <div
          class="timeline-height-rail pointer-events-none absolute z-10 bg-current"
          style:left="{GUTTER - RADIUS / 4}px"
          style:top="{virtualizeRows ? layerBandTop : lineTop}px"
          style:width="{RADIUS / 2}px"
          style:height="{virtualizeRows ? layerBandHeight : lineBottom}px"
        ></div>
        <div
          class="timeline-height-rail pointer-events-none absolute z-10 bg-current"
          style:left="{canvasWidth - GUTTER - RADIUS / 4}px"
          style:top="{virtualizeRows ? layerBandTop : lineTop}px"
          style:width="{RADIUS / 2}px"
          style:height="{virtualizeRows ? layerBandHeight : lineBottom}px"
        ></div>

        <div class="timeline-viewport-clip absolute inset-0">
          <div
            class="timeline-motion-layer pointer-events-none absolute inset-0"
          >
            {#each presentedChainFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                workflowType={frame.candidate.workflow?.name}
                accessibleName=""
                color={workflowFrameColor}
                colors={inheritedWorkflowDotColors}
                live={frame.candidate.live}
                kind="chain"
                headerKind={frame.span.headerKind}
                depth={frame.span.depth}
                paint="background"
                bandTop={frameBandTop}
                bandHeight={frameBandHeight}
                entryOffsetPx={workflowFrameEntryOffset(frame.span.headerKey)}
                entryOffsetXPx={horizontalEntryOffset(
                  frame.span.headerKey,
                  frame.geometry.horizontal?.startPx,
                  frame.candidate.live,
                )}
                entryKey={frame.span.headerKey}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: frame.span.headerKey,
                  rowEnd: frame.span.rowEnd,
                })}
              />
            {/each}
            {#each presentedRunFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                accessibleName=""
                color={workflowFrameColor}
                colors={dotColors(frame.candidate.status)}
                live={frame.candidate.live}
                kind="run"
                depth={frame.span.depth}
                paint="background"
                bandTop={frameBandTop}
                bandHeight={frameBandHeight}
                entryOffsetPx={runFrameEntryOffset(
                  timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  ),
                )}
                entryOffsetXPx={horizontalEntryOffset(
                  `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                  frame.geometry.horizontal?.startPx,
                  frame.candidate.live,
                )}
                entryKey={`${timelineRunKey(
                  frame.candidate.workflowKey ?? '',
                  frame.candidate.runId,
                )}:frame-header`}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                  rowEnd: frame.span.rowEnd,
                })}
              />
            {/each}
          </div>
          <TimelineAxis
            x1={GUTTER - RADIUS / 4}
            x2={canvasWidth - GUTTER + RADIUS / 4}
            gutter={GUTTER}
            {timelineHeight}
            bandTop={virtualizeRows ? layerBandTop : 0}
            bandHeight={virtualizeRows ? layerBandHeight : timelineHeight}
            {startTime}
            {scale}
            viewportOffsetPx={viewport.offsetPx}
          />
          {#if !timelineLoading}
            <!-- Anchor's left provides the gutter offset for the layer's 0-based coords. -->
            <div
              class="timeline-motion-layer absolute top-0"
              style:left="{GUTTER}px"
            >
              <TimelineCollapsedLayer
                {scale}
                {timelineHeight}
                bandTop={layerBandTop}
                bandHeight={layerBandHeight}
                {readOnly}
                viewportOffsetPx={viewport.offsetPx}
                viewportWidthPx={timelineWidth}
                onToggle={toggleSegment}
              />
            </div>
          {/if}

          <div
            class="timeline-motion-layer pointer-events-none absolute inset-0 z-20"
          >
            {#each presentedChainFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                workflowType={frame.candidate.workflow?.name}
                accessibleName={translate('workflows.row-accessible-name', {
                  workflowId: frame.candidate.workflow?.id ?? '',
                  status: getWorkflowStatusLabel(frame.candidate.status),
                })}
                color={workflowFrameColor}
                colors={inheritedWorkflowDotColors}
                live={frame.candidate.live}
                kind="chain"
                headerKind={frame.span.headerKind}
                depth={frame.span.depth}
                paint="foreground"
                bandTop={frameBandTop}
                bandHeight={frameBandHeight}
                entryOffsetPx={workflowFrameEntryOffset(frame.span.headerKey)}
                entryOffsetXPx={horizontalEntryOffset(
                  frame.span.headerKey,
                  frame.geometry.horizontal?.startPx,
                  frame.candidate.live,
                )}
                entryKey={frame.span.headerKey}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: frame.span.headerKey,
                  rowEnd: frame.span.rowEnd,
                })}
              />
            {/each}
            {#each presentedRunFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                accessibleName={translate(
                  'workflows.chain-row-accessible-name',
                  {
                    workflowId: frame.candidate.workflow?.id ?? '',
                    runId: frame.candidate.runId,
                    status: getWorkflowStatusLabel(frame.candidate.status),
                  },
                )}
                color={workflowFrameColor}
                colors={dotColors(frame.candidate.status)}
                live={frame.candidate.live}
                kind="run"
                depth={frame.span.depth}
                paint="foreground"
                bandTop={frameBandTop}
                bandHeight={frameBandHeight}
                entryOffsetPx={runFrameEntryOffset(
                  timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  ),
                )}
                entryOffsetXPx={horizontalEntryOffset(
                  `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                  frame.geometry.horizontal?.startPx,
                  frame.candidate.live,
                )}
                entryKey={`${timelineRunKey(
                  frame.candidate.workflowKey ?? '',
                  frame.candidate.runId,
                )}:frame-header`}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                  rowEnd: frame.span.rowEnd,
                })}
              />
            {/each}
          </div>

          <!-- Keyed by immutable scene row identity so returning to a retained
             chunk reuses its <li> and component subtree. pointer-events-none
             lets clicks fall through to the collapse toggles; event buttons
             opt back in with pointer-events:auto. -->
          <ul
            class="pointer-events-none absolute inset-0 m-0 list-none p-0"
            class:timeline-rows-entering={rowEntryOffsets.size > 0 ||
              rowEntryNewKeys.size > 0}
            class:timeline-rows-animating={rowEntryAnimating}
            bind:this={rowStackEl}
          >
            {#each presentationRows as slot, slotIndex (slot.row.key)}
              {@const slotActive = activePresentationChunkKeys.has(
                slot.chunkKey,
              )}
              {@const rowKey = slot ? layoutRowKey(slot.row) : ''}
              {@const entryOffsetPx = rowEntryOffsets.get(rowKey) ?? 0}
              {@const entryStartXPx =
                slot?.row.kind === 'group'
                  ? projectX(slot.row.entry.group.initialEvent.eventTime)
                  : undefined}
              <li
                class="absolute left-0 right-0 top-0 {slot?.row.kind ===
                  'group' && slot.row.childEdge
                  ? 'z-30'
                  : ''}"
                class:timeline-row-entering={entryOffsetPx !== 0}
                class:timeline-row-animating={rowEntryAnimating}
                data-timeline-key={rowKey || undefined}
                data-timeline-entry-offset={entryOffsetPx || undefined}
                data-timeline-entry-key={rowKey || undefined}
                data-timeline-entry-start-x={entryStartXPx}
                data-timeline-entry-motion={entryOffsetPx !== 0
                  ? true
                  : undefined}
                aria-hidden={!slotActive || undefined}
                aria-posinset={slot.index + 1}
                aria-setsize={layoutRowCount}
                inert={!slotActive || undefined}
                style:display={slotActive ? 'block' : 'none'}
                style:height="{ROW_HEIGHT}px"
                style:contain="layout"
                style:--timeline-row-entry-offset={`${entryOffsetPx}px`}
                style:transform={slot
                  ? `translateY(${getY(slot.index) - ROW_HEIGHT / 2 + shiftFor(slot.index)}px)`
                  : undefined}
                onfocusin={() => {
                  focusedGroupId =
                    slot?.row.kind === 'group'
                      ? slot.row.entry.timelineKey
                      : null;
                  focusedSlotIndex =
                    slot?.row.kind === 'group' ? slotIndex : null;
                }}
              >
                {#if slot?.row.kind === 'group'}
                  {@const timelineEntry = slot.row.entry}
                  {@const childControl = slot.row.childEdge
                    ? getChildControlPlacement(timelineEntry)
                    : undefined}
                  <div class="timeline-motion-layer absolute inset-0">
                    {#if !('eventList' in timelineEntry.group) && timelineEntry.group.eventCount === 1 && !timelineEntry.group.isPending && timelineEntry.active === false}
                      <TimelineStaticMarkerRow
                        group={timelineEntry.group}
                        timelineKey={timelineEntry.timelineKey}
                        {canvasWidth}
                        project={projectX}
                        {readOnly}
                      />
                    {:else}
                      <TimelineGraphRow
                        group={timelineEntry.group}
                        timelineKey={timelineEntry.timelineKey}
                        eventCount={timelineEntry.group.eventCount}
                        {canvasWidth}
                        project={projectX}
                        {readOnly}
                        active={timelineEntry?.active ?? true}
                        resolvedStatus={timelineEntry?.resolvedStatus}
                        retainedEndTimeMs={timelineEntry?.active
                          ? undefined
                          : timelineEntry?.runEndTimeMs}
                        pendingEndTimeMs={timelineEntry?.active
                          ? timeline.workflowTimespan.endTimeMs
                          : undefined}
                        viewportEndOverscanPx={displayMode === 'fixed-window'
                          ? TIMELINE_MOTION_OVERSCAN_PX
                          : 0}
                        fanOutShortBoundaryMarkers={Boolean(slot.row.childEdge)}
                        continuousConnector={Boolean(slot.row.childEdge)}
                        connectorColor={slot.row.childEdge
                          ? workflowFrameColor
                          : undefined}
                        displayNamePrefix={slot.row.childEdge
                          ? `${translate('common.workflow-id')}: ${slot.row.childEdge.reference.workflowId}`
                          : undefined}
                        labelLeadingOffsetPx={slot.row.childEdge &&
                        childControl?.fitsAfter
                          ? 34
                          : 0}
                        labelTrailingOffsetPx={slot.row.childEdge &&
                        !childControl?.fitsAfter
                          ? 34
                          : 0}
                        onBeforeSelect={slot.row.childEdge
                          ? () => {
                              if (
                                slot.row.kind === 'group' &&
                                slot.row.childEdge?.expansion === 'expanded'
                              ) {
                                toggleChild(slot.row.childEdge.key);
                              }
                            }
                          : undefined}
                      />
                    {/if}
                    {#if slot.row.childEdge}
                      <TimelineChildEdgeRow
                        edge={slot.row.childEdge}
                        {canvasWidth}
                        anchorX={childControl?.x}
                        onToggle={toggleChild}
                        onRetry={(edgeKey) => recursiveSession.retry(edgeKey)}
                      />
                    {/if}
                  </div>
                {:else if slot?.row.kind === 'child-state'}
                  <TimelineChildEdgeRow
                    edge={slot.row.edge}
                    {canvasWidth}
                    presentation="state"
                    onToggle={toggleChild}
                    onRetry={(edgeKey) => recursiveSession.retry(edgeKey)}
                  />
                {/if}
              </li>
            {/each}
          </ul>
          <div
            class="pointer-events-none absolute inset-0 z-10"
            aria-hidden="true"
            data-child-toggle-exit-layer
            bind:this={childToggleExitLayerEl}
          ></div>
        </div>
        {#if timelineLoading && presentedPendingGap}
          {@const rectY =
            TIMELINE_VERTICAL_PADDING +
            (presentedPendingGap.rowStart + 1.5) * ROW_HEIGHT +
            shiftFor(presentedPendingGap.insertionIndex)}
          {@const rectH = presentedPendingGap.rowCount * ROW_HEIGHT + RADIUS}
          <div
            class="absolute animate-pulse rounded bg-slate-400/30"
            style:left="{GUTTER}px"
            style:top="{rectY}px"
            style:width="{canvasWidth - GUTTER * 2}px"
            style:height="{rectH}px"
          ></div>
        {/if}

        <!-- Last child so it paints above rows; onHeight feeds shiftFor. -->
        {#if !readOnly && activeIdx >= 0}
          {#if activeLayoutRow?.kind === 'group'}
            {@const activeTimelineEntry = activeLayoutRow.entry}
            {@const activeGroup = materializeTimelineGroup(activeTimelineEntry)}
            {@const panelY = getY(activeIdx) + 1.33 * RADIUS}
            <GroupDetailsRow
              y={panelY}
              group={activeGroup}
              timelineKey={activeTimelineEntry.timelineKey}
              {canvasWidth}
              endTime={activeTimelineEntry?.active === false
                ? activeTimelineEntry.runEndTimeMs
                : workflow?.endTime
                  ? endTime
                  : nowMs}
              active={activeTimelineEntry?.active ?? true}
              onHeight={(height) => {
                panelHeight = height;
              }}
            />
          {/if}
        {/if}
      </div>
    {/snippet}
  </EndTimeInterval>
</div>

<style lang="postcss">
  /* color drives currentColor for the rails, axis, grid lines, tick labels and
     fallback row labels, so it must be theme-aware (white only reads on dark). */
  .canvas {
    position: relative;
    margin-top: -1rem;
    color: rgb(var(--color-text-primary));
  }

  .canvas :global(.timeline-motion-layer) {
    transform: translateX(calc(-1 * var(--timeline-frame-offset, 0px)));
  }

  /* The motion layer deliberately mounts geometry just beyond the viewport so
     it can glide in continuously. Clip it at the stationary inner edges of the
     rails; clipping the transformed layer itself would move this boundary. */
  .canvas :global(.timeline-viewport-clip) {
    clip-path: inset(0 var(--timeline-clip-inset));
  }

  .timeline-motion-active .canvas :global(.timeline-motion-layer) {
    will-change: transform;
  }

  .timeline-row-entering {
    translate: 0 var(--timeline-row-entry-offset);
  }

  @media (prefers-reduced-motion: reduce) {
    .timeline-row-entering {
      translate: none;
    }
  }

  /* Keep interactive overlays stable while their painted segment layer glides.
     The coarse viewport update repositions these hit targets often enough to
     remain aligned without making pointer and keyboard interaction chase rAF. */
  .canvas :global(.timeline-motion-hit-target) {
    transform: translateX(var(--timeline-frame-offset, 0));
  }

  /* Connector-line styles for the row components' `.tl-line` divs; :global since
     they're in children, scoped under .canvas so they don't leak. Elements set
     geometry + --tl-line-color inline. border-radius: 9999px → pill ends. */
  .canvas :global(.tl-line) {
    border-radius: 9999px;
    background-color: var(--tl-line-color);
  }

  /* Render each live connector as one fixed-width pattern and reveal through
     its interpolated endpoint. A separate extension would restart the stripe
     pattern at its seam; scaling it would distort stripe width. */
  .canvas :global(.tl-line--live) {
    border-radius: 9999px 0 0 9999px;
    clip-path: inset(
      0
        calc(
          100% - var(--tl-live-committed-width) -
            var(--timeline-live-edge-extension, 0px)
        )
        0 0
    );
    will-change: clip-path;
  }

  .canvas :global(.tl-line--gradient) {
    background-image: linear-gradient(255deg, #1ff1a5 0%, #f55 100%);
  }

  .canvas :global(.tl-line--dashed) {
    background-color: transparent;
    background-image: repeating-linear-gradient(
      to right,
      var(--tl-line-color) 0 3px,
      transparent 3px 6px
    );
    background-size: 6px 100%;
  }

  /* Animated dashes run on a pseudo-element's transform (GPU-composited) rather
     than background-position (which forces a main-thread repaint every frame). */
  .canvas :global(.tl-line--dashed.tl-line--animate) {
    background-image: none;
    overflow: hidden;
  }

  .canvas :global(.tl-line--dashed.tl-line--animate)::after {
    content: '';
    position: absolute;
    inset: 0 -6px 0 0;
    background-image: repeating-linear-gradient(
      to right,
      var(--tl-line-color) 0 3px,
      transparent 3px 6px
    );
    background-size: 6px 100%;
    animation: tl-line-dash 1.8s linear infinite;
    will-change: transform;
  }

  /* A connector clipped to the stationary left rail does not reproject its
     local origin at coarse clock commits. Counter the parent layer's smooth
     offset so its repeating pattern keeps the same screen-space phase. */
  .canvas :global(.tl-line--viewport-clipped-start)::after {
    translate: var(--timeline-frame-offset, 0) 0;
    will-change: transform, translate;
  }

  @keyframes tl-line-dash {
    to {
      transform: translateX(-6px);
    }
  }
</style>
