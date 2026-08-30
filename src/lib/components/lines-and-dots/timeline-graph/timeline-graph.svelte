<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';

  import { onDestroy, untrack } from 'svelte';
  import { twMerge } from 'tailwind-merge';

  import { timestamp } from '$lib/components/timestamp.svelte';
  import { translate } from '$lib/i18n/translate';
  import type { EventGroups } from '$lib/models/event-groups/event-groups';
  import {
    type ChainRetentionWindow,
    getChainRetentionWindow,
    type TimelineRun,
    toTimelineGroups,
  } from '$lib/services/chain-workflow-session';
  import { RecursiveWorkflowSession } from '$lib/services/recursive-workflow-session.svelte';
  import { activeGroups, clearActiveGroups } from '$lib/stores/active-events';
  import { collapseIdleTime } from '$lib/stores/event-view';
  import { fullEventHistory, pauseLiveUpdates } from '$lib/stores/events';
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
    type TimelineChildEdge,
    timelineRunKey,
  } from './recursive-timeline-model';
  import {
    getRecursiveTimelineContainmentLayout,
    type TimelineLayoutRow,
  } from './timeline-containment-layout';
  import {
    DEFAULT_TIMELINE_DISPLAY_MODE,
    expandedDurationPerViewportMs,
  } from './timeline-display-mode';
  import { shouldMoveFocusToTimeline } from './timeline-focus';
  import { getRecursiveFrameCandidates } from './timeline-frame-visibility';
  import { timelineGroupIntersectsViewport } from './timeline-group-window';
  import { TimelineMotion } from './timeline-motion';
  import { getRowY, getTotalForY } from './timeline-positioning';
  import {
    getTimelineFrameBoundaryOffset,
    getTimelineRowEntryOffsets,
  } from './timeline-row-entry-motion';
  import {
    TIMELINE_ROW_HEIGHT_GRACE_MS,
    TimelineRowHeightRetention,
  } from './timeline-row-height-retention';
  import {
    filterTimelineGroupEntries,
    filterTimelineGroupEntriesByStatus,
    getTimelineEntryMaps,
    getTimelineGroupEntries,
  } from './timeline-run-entries';
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
  import { TimelineScale } from './timeline-scale.svelte';
  import { Timeline } from './timeline.svelte';
  import { Viewport } from './viewport.svelte';
  import WorkflowFrame from './workflow-frame.svelte';

  interface Props {
    namespace: string;
    workflow: WorkflowExecution;
    groups: EventGroups;
    readOnly?: boolean;
    error?: boolean;
    reverseSort?: boolean;
    loading?: boolean;
    totalExpectedEvents?: number;
    descMinId?: number;
    panelHeight?: number;
    displayMode?: TimelineDisplayMode;
    onTimelineInit?: (timeline: Timeline) => void;
    timelineRuns?: TimelineRun[];
    onRetentionWindow?: (window: ChainRetentionWindow) => void;
    rowHeightRetentionScopeId?: string;
    knownChainStartRunId?: string;
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
    panelHeight = $bindable(0),
    displayMode = DEFAULT_TIMELINE_DISPLAY_MODE,
    onTimelineInit,
    timelineRuns = [],
    onRetentionWindow,
    rowHeightRetentionScopeId,
    knownChainStartRunId = workflow.runId,
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
  const incomingEdgeByWorkflowKey = $derived.by(() => {
    const incomingEdges = new SvelteMap<string, TimelineChildEdge>();
    for (const node of workflowNodes) {
      for (const edge of node.childrenByGroupKey.values()) {
        if (edge.load.state === 'loaded') {
          incomingEdges.set(edge.load.node.key, edge);
        }
      }
    }
    return incomingEdges;
  });
  const allWorkflowRuns = $derived(workflowNodes.flatMap((node) => node.runs));
  const aggregateHasLive = $derived(
    allWorkflowRuns.some(
      (run) =>
        run.active && (run.status === 'Running' || run.status === 'Paused'),
    ),
  );
  const aggregateStartTimeMs = $derived(
    Math.min(...allWorkflowRuns.map((run) => run.startTimeMs)),
  );
  const aggregateEndTimeMs = $derived(
    aggregateHasLive
      ? nowMs
      : Math.max(...allWorkflowRuns.map((run) => run.endTimeMs)),
  );

  const timelineGroupEntries = $derived(
    workflowNodes.flatMap((node) => getTimelineGroupEntries(node.runs)),
  );
  const eventTypeFilteredEntries = $derived(
    filterTimelineGroupEntries({
      entries: timelineGroupEntries,
      eventTypes: $eventTypeFilter,
      failedOrPending: false,
    }),
  );
  const renderedGroups = $derived(
    eventTypeFilteredEntries.map((entry) => entry.group),
  );
  const timelineEntryMaps = $derived(
    getTimelineEntryMaps(eventTypeFilteredEntries),
  );
  const timelineKeys = $derived(timelineEntryMaps.keyByGroup);
  const timelineEntryByGroup = $derived(timelineEntryMaps.entryByGroup);
  const getRetainedEndTimeMs = (
    group: EventGroups[number],
  ): number | undefined => {
    const entry = timelineEntryByGroup.get(group);
    return entry && !entry.active && group.isPending
      ? entry.runEndTimeMs
      : undefined;
  };
  const getTimelineKey = (group: EventGroups[number]): string =>
    timelineKeys.get(group) ?? `${workflow.runId}:${group.id}`;
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

  const timeline = new Timeline({
    getFullEventHistory: () => $fullEventHistory,
    getWorkflow: () => workflow,
    getEventGroups: () => renderedGroups,
    getEventGroupEndMs: (group) => getRetainedEndTimeMs(group),
    getCurrentTimeMs: () => nowMs,
    getLoading: () => timelineLoading,
    getShouldCollapseByDefault: () => $collapseIdleTime === 'on',
    getStartTimeMs: () => aggregateStartTimeMs,
    getEndTimeMs: () => aggregateEndTimeMs,
    getEndUnbounded: () => aggregateHasLive,
  });

  const collapsedSegmentCount = $derived(
    timeline.segments.filter((segment) =>
      timeline.isTimeSegmentCollapsed(segment),
    ).length,
  );

  const durationPerViewportMs = $derived(
    expandedDurationPerViewportMs({
      displayMode,
      viewportWidthPx: timelineWidth,
      expandedDurationMs: timeline.expandedDurationMs,
      collapsedSegmentCount,
    }),
  );

  const scale = new TimelineScale({
    timeline,
    getViewportWidthPx: () => timelineWidth,
    getExpandedDurationPerViewportMs: () => durationPerViewportMs,
  });

  const viewport = new Viewport();
  const viewportMotion = new TimelineMotion();
  const liveEdgeMotion = new TimelineMotion();
  const workflowIsLive = $derived(aggregateHasLive);
  const shouldAnimateTimeline = $derived(
    displayMode === 'fixed-window' &&
      workflowIsLive &&
      viewport.isFollowing &&
      !$pauseLiveUpdates &&
      scale.liveEdgePxPerMs > 0,
  );
  let frozenAnchorTimeMs: number | null = null;

  $effect(() => {
    onTimelineInit?.(timeline);
  });

  $effect(() => {
    const anchoredOffsetPx =
      !viewport.isFollowing && frozenAnchorTimeMs !== null
        ? scale.project(frozenAnchorTimeMs)
        : undefined;
    viewport.setGeometry({
      widthPx: timelineWidth,
      totalWorldWidthPx: scale.totalWorldWidthPx,
      anchoredOffsetPx,
    });
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
      displayMode === 'fixed-window' && $pauseLiveUpdates && workflowIsLive;
    if (shouldFreeze && viewport.isFollowing) {
      frozenAnchorTimeMs = scale.unproject(viewport.offsetPx);
    }
    syncTimelineViewport({
      viewport,
      displayMode,
      paused: $pauseLiveUpdates,
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

  const toggleSegment = (segmentKey: string) => {
    const segment = timeline.segments.find(
      (candidate) => candidate.timespan.key === segmentKey,
    );
    if (segment) {
      timeline.toggleTimeSegment(segment);
    }
  };

  const filteredEntries = $derived(
    filterTimelineGroupEntriesByStatus(
      eventTypeFilteredEntries,
      $eventStatusFilter,
    ),
  );

  const visibleEntries = $derived(
    displayMode === 'full-duration'
      ? filteredEntries
      : filteredEntries.filter((entry) =>
          timelineGroupIntersectsViewport({
            group: entry.group,
            currentTimeMs: nowMs,
            retainedEndTimeMs: entry.active ? undefined : entry.runEndTimeMs,
            project: (timeMs) => scale.project(timeMs),
            visibleRange: viewport.visibleRange,
          }),
        ),
  );
  const visibleGroups = $derived(visibleEntries.map((entry) => entry.group));

  const visibleGroupIds = $derived(
    new Set(visibleGroups.map((group) => getTimelineKey(group))),
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
    viewportMotion.reset(viewport.offsetPx);
    liveEdgeMotion.reset(scale.totalWorldWidthPx);
    containerEl?.style.setProperty('--timeline-frame-offset', '0px');
    containerEl?.style.setProperty('--timeline-live-edge-extension', '0px');
  });

  // Unfetched skeleton rows. totalExpectedEvents is already a density-adjusted
  // group count, so subtracting the loaded count is correct.
  const pendingGroupCount = $derived.by(() => {
    if (!timelineLoading) return 0;
    if (displayMode === 'fixed-window') {
      return visibleEntries.length === 0 && filteredEntries.length === 0
        ? Math.min(totalExpectedEvents || 50, 50)
        : 0;
    }
    if (!totalExpectedEvents) {
      return visibleGroups.length === 0 ? 50 : 0;
    }
    return Math.max(0, totalExpectedEvents - visibleEntries.length);
  });

  const frameCandidates = $derived(
    getRecursiveFrameCandidates({
      nodes: workflowNodes,
      visibleRange:
        displayMode === 'full-duration'
          ? {
              startPx: Number.NEGATIVE_INFINITY,
              endPx: Number.POSITIVE_INFINITY,
            }
          : viewport.visibleRange,
      project: (timeMs) => scale.project(timeMs),
      liveEndTimeMs: timeline.workflowTimespan.endTimeMs,
      rootKnownChainStartRunId: knownChainStartRunId,
    }),
  );
  const participatingRunFrames = $derived(frameCandidates.runFrames);
  const containmentLayout = $derived(
    getRecursiveTimelineContainmentLayout({
      root: workflowTree,
      visibleEntries,
      participatingRunKeys: frameCandidates.participatingRunKeys,
      reverseSort,
      pendingGroupCount,
      descMinId,
    }),
  );
  const layoutRows = $derived(containmentLayout.rows);
  const layoutRowKey = (row: TimelineLayoutRow): string => row.key;
  let previousLayoutKeys: string[] | null = null;
  let rowEntryOffsets = $state.raw(new Map<string, number>());
  let rowEntryNewKeys = $state.raw(new Set<string>());
  let rowEntryAnimating = $state(false);
  let rowEntryFrame = 0;
  let rowStackEl: HTMLUListElement | null = null;
  let rowEntryObserver: MutationObserver | null = null;
  let rowEntryAnimations: Animation[] = [];
  let rowEntryGeneration = 0;
  let rowEntryDeadlineMs: number | null = null;
  let rowEntrySettleTimer: ReturnType<typeof setTimeout> | null = null;

  // Live polling can split one server-side event burst across adjacent refreshes.
  // Keep the previous layout painted until that burst has gone quiet, then admit
  // every new row in one motion instead of rewinding an animation in progress.
  const ROW_ENTRY_SETTLE_MS = 1100;

  onDestroy(() => {
    rowEntryGeneration += 1;
    cancelAnimationFrame(rowEntryFrame);
    if (rowEntrySettleTimer !== null) clearTimeout(rowEntrySettleTimer);
    rowEntryObserver?.disconnect();
    rowEntryAnimations.forEach((animation) => animation.cancel());
  });

  const finishRowEntry = () => {
    rowEntryGeneration += 1;
    cancelAnimationFrame(rowEntryFrame);
    if (rowEntrySettleTimer !== null) clearTimeout(rowEntrySettleTimer);
    rowEntrySettleTimer = null;
    rowEntryObserver?.disconnect();
    rowEntryAnimations.forEach((animation) => animation.cancel());
    rowEntryAnimations = [];
    rowEntryDeadlineMs = null;
    rowEntryAnimating = false;
    rowEntryOffsets = new Map();
    rowEntryNewKeys = new Set();
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
    const currentKeys = layoutRows.map(layoutRowKey);
    const previousKeys = previousLayoutKeys;
    previousLayoutKeys = currentKeys;

    if (
      previousKeys === null ||
      timelineLoading ||
      !reverseSort ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      finishRowEntry();
      return;
    }

    const previousKeySet = new Set(previousKeys);
    const addedKeys = currentKeys.filter((key) => !previousKeySet.has(key));
    const layoutChanged =
      previousKeys.length !== currentKeys.length ||
      previousKeys.some((key, index) => key !== currentKeys[index]);
    if (!layoutChanged) return;

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
    if (rowEntrySettleTimer !== null) clearTimeout(rowEntrySettleTimer);
    rowEntrySettleTimer = null;
    rowEntryObserver?.disconnect();
    rowEntryAnimations.forEach((animation) => animation.cancel());
    rowEntryAnimations = [];

    const element = rowStackEl;
    if (!element) return;
    const added = new Set(addedKeys);
    const beginAfterSettle = () => {
      if (rowEntryOffsets !== offsets || rowEntryGeneration !== generation) {
        return;
      }
      if (!entryWasAnimating && recursiveSession.requestCount > 0) {
        rowEntrySettleTimer = setTimeout(beginAfterSettle, 50);
        return;
      }

      rowEntrySettleTimer = null;
      cancelAnimationFrame(rowEntryFrame);
      rowEntryFrame = requestAnimationFrame(() => {
        rowEntryFrame = requestAnimationFrame(() => {
          if (
            rowEntryOffsets !== offsets ||
            rowEntryGeneration !== generation
          ) {
            return;
          }
          if (!entryWasAnimating && recursiveSession.requestCount > 0) {
            rowEntrySettleTimer = setTimeout(beginAfterSettle, 50);
            return;
          }

          const elements = Array.from(
            containerEl?.querySelectorAll<HTMLElement>(
              '[data-timeline-entry-offset]',
            ) ?? [],
          );
          const durationMs = entryWasAnimating
            ? Math.max(
                1,
                (rowEntryDeadlineMs ?? performance.now()) - performance.now(),
              )
            : 1200;
          const animations = elements.flatMap((element) => {
            const offsetPx = Number(element.dataset.timelineEntryOffset);
            if (!offsetPx) return [];
            return [
              element.animate(
                [{ translate: `0 ${offsetPx}px` }, { translate: '0 0' }],
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
    };

    rowEntryObserver = new MutationObserver(() => {
      const mounted = Array.from(
        element.querySelectorAll<HTMLElement>('[data-timeline-key]'),
      ).some((row) => !added.size || added.has(row.dataset.timelineKey ?? ''));
      if (!mounted) return;
      rowEntryObserver?.disconnect();
      rowEntrySettleTimer = setTimeout(beginAfterSettle, ROW_ENTRY_SETTLE_MS);
    });
    rowEntryObserver.observe(element, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });

  const chainFrameCandidates = $derived(frameCandidates.chainFrames);
  const runFrameEntryOffset = (runKey: string): number =>
    rowEntryOffsets.get(`${runKey}:frame-header`) ?? 0;
  const workflowFrameEntryOffset = (workflowKey: string): number =>
    rowEntryOffsets.get(`${workflowKey}:workflow-header`) ?? 0;
  const frameEntryPending = (entryKey: string): boolean =>
    !rowEntryAnimating && rowEntryNewKeys.has(entryKey);
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
      bottomKey: layoutRows[rowEnd - 1]?.key,
    });
  const rootChainFrameCandidate = $derived(
    chainFrameCandidates.find((candidate) => candidate.depth === 0),
  );
  const inheritedWorkflowFrameColor = $derived(
    strokeColor({
      status: rootChainFrameCandidate?.status ?? workflow.status,
      delayed:
        Boolean(rootChainFrameCandidate?.live) && isWorkflowDelayed(workflow),
    }),
  );
  const inheritedWorkflowDotColors = $derived(
    dotColors(rootChainFrameCandidate?.status ?? workflow.status),
  );

  const rowHeightRetention = new TimelineRowHeightRetention();
  const heightRowCount = $derived(
    rowHeightRetention.update({
      visibleRowCount: containmentLayout.totalRowCount,
      nowMs,
      retain:
        displayMode === 'fixed-window' &&
        (workflow.isRunning || workflow.isPaused),
      retentionDurationMs: durationPerViewportMs + TIMELINE_ROW_HEIGHT_GRACE_MS,
      retentionKey: `${rowHeightRetentionScopeId ?? workflow.runId}:${$eventStatusFilter}:${$eventTypeFilter.join(',')}`,
    }),
  );

  // Rows mounted beyond the viewport, so edge rows survive small scrolls and
  // direction reversals and are ready ahead of a fast fling.
  const OVERSCAN = 12;
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

  const firstStartTime = $derived.by(() => {
    const firstEventTime = $fullEventHistory[0]?.eventTime;

    if (!firstEventTime) {
      return workflow.executionTime;
    }

    return firstEventTime < workflow.executionTime
      ? firstEventTime
      : workflow.executionTime;
  });

  const startTime = $derived(
    (!isWorkflowDelayed(workflow) && firstStartTime) || workflow.startTime,
  );

  const groupIndexMap = $derived(
    new Map(
      layoutRows.flatMap((row, index) =>
        row.kind === 'group' ? [[row.entry.timelineKey, index] as const] : [],
      ),
    ),
  );

  // Active group's index in visibleGroups (-1 = none). Derived here so the row
  // pool doesn't subscribe to $activeGroups directly.
  const activeIdx = $derived(
    $activeGroups.length > 0 ? (groupIndexMap.get($activeGroups[0]) ?? -1) : -1,
  );
  const activeLayoutRow = $derived(
    activeIdx >= 0 ? layoutRows[activeIdx] : undefined,
  );
  const activeRowIndex = $derived(
    activeLayoutRow?.kind === 'group' ? activeLayoutRow.rowIndex : -1,
  );

  $effect(() => {
    if ($activeGroups.length === 0) panelHeight = 0;
  });

  $effect.pre(() => {
    const activeGroupId = $activeGroups[0];
    if (!activeGroupId || visibleGroupIds.has(activeGroupId)) return;

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
    containmentLayout.pendingGap?.insertionIndex ?? layoutRows.length,
  );
  const layoutPendingCount = $derived(
    containmentLayout.pendingGap?.rowCount ?? 0,
  );

  const totalForY = $derived(
    getTotalForY(layoutRows.length, layoutPendingCount, descStart),
  );

  // Widen the mount window by the panel's row span: shiftFor moves rows down but
  // getWindowBounds maps on the unshifted y, so without this they'd leave a blank.
  const windowOverscan = $derived(
    OVERSCAN + Math.ceil(panelHeight / ROW_HEIGHT),
  );

  // Full drawn height (rows + axis + detail panel). The container is this tall and
  // scrolls with the page.
  const timelineHeight = $derived(
    Math.max(
      ROW_HEIGHT * (heightRowCount + (chainFrameCandidates.length ? 3 : 2)),
      120,
    ) +
      panelHeight +
      2 * TIMELINE_VERTICAL_PADDING,
  );
  const AXIS_LABEL_ZONE = 150;
  const svgHeight = $derived(timelineHeight + AXIS_LABEL_ZONE);

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

  // Self-driven rAF loop, not a per-scroll-event measure: a wheel fling fires
  // `wheel` but coalesces `scroll`, so an event-driven measure goes stale mid-fling.
  function sampleBand() {
    bandRafId = undefined;
    if (!containerEl) return;
    const elTop = containerEl.getBoundingClientRect().top;
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
    const top = viewTop - elTop; // container-local top of the visible area

    if (top !== lastTop || viewHeight !== lastHeight) {
      lastTop = top;
      lastHeight = viewHeight;
      stableFrames = 0;
      visibleBand = [top, top + viewHeight];
    } else {
      stableFrames++;
    }

    // Loop while moving; idle out once still. pokeSampler restarts it on activity.
    if (stableFrames < STABLE_FRAMES) {
      bandRafId = requestAnimationFrame(sampleBand);
    }
  }

  function pokeSampler() {
    stableFrames = 0;
    if (bandRafId === undefined) {
      bandRafId = requestAnimationFrame(sampleBand);
    }
  }

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
    scroller = findScrollParent(containerEl);
    lastTop = NaN;
    lastHeight = NaN;
    stableFrames = 0;
    sampleBand();
    const target: HTMLElement | Window = scroller ?? window;
    const opts = { passive: true };
    // wheel/touchmove cover flings where `scroll` events are throttled.
    target.addEventListener('scroll', pokeSampler, opts);
    target.addEventListener('wheel', pokeSampler, opts);
    target.addEventListener('touchmove', pokeSampler, opts);
    window.addEventListener('resize', pokeSampler, opts);
    return () => {
      target.removeEventListener('scroll', pokeSampler);
      target.removeEventListener('wheel', pokeSampler);
      target.removeEventListener('touchmove', pokeSampler);
      window.removeEventListener('resize', pokeSampler);
      if (bandRafId !== undefined) cancelAnimationFrame(bandRafId);
    };
  });

  const [windowStart, windowEnd] = $derived.by(() => {
    const band = visibleBand;
    const bandTop = band ? band[0] : 0;
    const bandHeight = band ? band[1] - band[0] : Math.min(svgHeight, 1000);
    return getWindowBounds({
      bandTop: bandTop - TIMELINE_VERTICAL_PADDING,
      bandHeight,
      total: layoutRows.length,
      overscan: windowOverscan,
      reverseSort: false,
      descStart,
      pendingCount: layoutPendingCount,
      totalForY,
    });
  });

  // ── Row pool ────────────────────────────────────────────────────────────────
  // Fixed-size set of slots reused across scroll (vs a keyed each that creates/
  // destroys rows as the window slides). Slots keep their DOM + instance and just
  // re-point to a new group — avoids the mount churn that caused major-GC pauses.
  const POOL_SLACK = 4;
  const poolSize = $derived.by(() => {
    const band = visibleBand;
    const bandHeight = band ? band[1] - band[0] : Math.min(svgHeight, 1000);
    return Math.ceil(bandHeight / ROW_HEIGHT) + 2 * windowOverscan + POOL_SLACK;
  });

  // Slot i%poolSize always holds group i (keyed by slot index below, so the DOM
  // stays put; span capped at poolSize so slots never collide). Reuse the prior
  // slot object when unchanged — a fresh object each pass would change the {#each}
  // item and re-run the row derived for rows that didn't move.
  let prevSlots: ({ index: number; row: TimelineLayoutRow } | null)[] = [];
  const pool = $derived.by(() => {
    const total = layoutRows.length;
    const slots: ({ index: number; row: TimelineLayoutRow } | null)[] =
      new Array(poolSize).fill(null);
    const end = Math.min(windowEnd, total, windowStart + poolSize);
    for (let index = windowStart; index < end; index++) {
      const slot = index % poolSize;
      const row = layoutRows[index];
      const prev = prevSlots[slot];
      if (prev && prev.index === index && prev.row === row) {
        slots[slot] = prev;
      } else {
        slots[slot] = { index, row };
      }
    }
    prevSlots = slots;
    return slots;
  });

  const pooledEdgeKeys = $derived(
    new Set(
      pool.flatMap((slot) => {
        const row = slot?.row;
        if (!row) return [];
        if (row.kind === 'group' && row.childEdge) {
          return [row.childEdge.key];
        }
        return [];
      }),
    ),
  );

  $effect(() => {
    const edgeKeys = pooledEdgeKeys;
    untrack(() => recursiveSession.observeEdges(edgeKeys));
  });

  let focusedGroupId = $state<string | null>(null);
  let focusedSlotIndex = $state<number | null>(null);

  $effect.pre(() => {
    const moveFocus = shouldMoveFocusToTimeline({
      focusWithinTimeline: Boolean(
        containerEl?.contains(document.activeElement),
      ),
      focusedGroupId,
      focusedSlotIndex,
      visibleGroupIds,
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
        getRowY(i, {
          descStart,
          pendingGroupCount: layoutPendingCount,
          totalForY,
          reverseSort: false,
        }),
  );

  const frameVerticalLayout = $derived(
    getTimelineFrameVerticalLayout({
      runSpans: containmentLayout.runSpans,
      workflowSpans: containmentLayout.workflowSpans,
      activeRowIndex,
      panelHeight,
      verticalPaddingPx: TIMELINE_VERTICAL_PADDING,
    }),
  );

  const runFrameLayouts = $derived.by(() => {
    return participatingRunFrames.flatMap((candidate) => {
      const runKey = timelineRunKey(
        candidate.workflowKey ?? '',
        candidate.runId,
      );
      const vertical = frameVerticalLayout.runBoundsByKey.get(runKey);
      const span = containmentLayout.runSpans.find(
        (candidateSpan) => candidateSpan.key === runKey,
      );
      if (!vertical || !span) return [];
      return [
        {
          candidate,
          span,
          geometry: getWorkflowFrameGeometry({
            startWorldPx: candidate.startWorldPx,
            endWorldPx: candidate.endWorldPx,
            viewportOffsetPx: viewport.offsetPx,
            viewportWidthPx: timelineWidth,
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
      const span = containmentLayout.workflowSpans.find(
        (candidateSpan) => candidateSpan.workflowKey === workflowKey,
      );
      if (!vertical || !span) return [];
      return [
        {
          candidate,
          span,
          geometry: getWorkflowFrameGeometry({
            startWorldPx: candidate.startWorldPx,
            endWorldPx: candidate.endWorldPx,
            viewportOffsetPx: viewport.offsetPx,
            viewportWidthPx: timelineWidth,
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

  // Border rails span the full timeline height so they meet the bottom axis.
  const lineTop = 0;
  const lineBottom = $derived(timelineHeight);
</script>

<div
  id="event-history-timeline-graph"
  role="region"
  aria-label={translate('workflows.timeline-tab')}
  data-viewport-offset={viewport.offsetPx}
  data-viewport-following={viewport.isFollowing}
  data-live-paused={$pauseLiveUpdates}
  class:timeline-motion-active={shouldAnimateTimeline}
  class={twMerge(
    'timeline-height-shell relative overflow-hidden border border-t-0 border-subtle bg-primary',
    error && 'bg-danger',
  )}
  style:height="{svgHeight}px"
  bind:this={containerEl}
  tabindex="-1"
>
  <EndTimeInterval
    {workflow}
    {startTime}
    live={aggregateHasLive}
    endTimeOverride={aggregateEndTimeMs}
    bind:currentTime={nowMs}
  >
    {#snippet children({ endTime })}
      <div
        class="pointer-events-none sticky top-[120px]"
        class:invisible={!!$activeGroups.length}
      >
        <div class="flex w-full justify-between text-xs">
          <p class="w-60 -translate-x-24 rotate-90">
            {$timestamp(startTime, { format: 'short' })}
          </p>
          <p class="w-60 translate-x-24 rotate-90">
            {$timestamp(endTime, { format: 'short' })}
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
          style:top="{lineTop}px"
          style:width="{RADIUS / 2}px"
          style:height="{lineBottom}px"
        ></div>
        <div
          class="timeline-height-rail pointer-events-none absolute z-10 bg-current"
          style:left="{canvasWidth - GUTTER - RADIUS / 4}px"
          style:top="{lineTop}px"
          style:width="{RADIUS / 2}px"
          style:height="{lineBottom}px"
        ></div>

        <div class="timeline-viewport-clip absolute inset-0">
          <TimelineAxis
            x1={GUTTER - RADIUS / 4}
            x2={canvasWidth - GUTTER + RADIUS / 4}
            gutter={GUTTER}
            {timelineHeight}
            {startTime}
            {scale}
            viewportOffsetPx={viewport.offsetPx}
          />
          <div
            class="timeline-motion-layer pointer-events-none absolute inset-0"
          >
            {#each chainFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                workflowType={frame.candidate.workflow?.name}
                accessibleName=""
                color={inheritedWorkflowFrameColor}
                colors={inheritedWorkflowDotColors}
                live={frame.candidate.live}
                kind="chain"
                paint="background"
                bandTop={layerBandTop}
                bandHeight={layerBandHeight}
                entryOffsetPx={workflowFrameEntryOffset(
                  frame.candidate.workflowKey ?? '',
                )}
                entryKey={`${frame.candidate.workflowKey ?? ''}:workflow-header`}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: `${frame.candidate.workflowKey ?? ''}:workflow-header`,
                  rowEnd: frame.span.rowEnd,
                })}
                entryPending={frameEntryPending(
                  `${frame.candidate.workflowKey ?? ''}:workflow-header`,
                )}
              />
            {/each}
            {#each runFrameLayouts as frame (frame.candidate.key)}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                accessibleName=""
                color={strokeColor({
                  status: frame.candidate.status,
                  delayed:
                    frame.candidate.live &&
                    Boolean(
                      frame.candidate.workflow &&
                      isWorkflowDelayed(frame.candidate.workflow),
                    ),
                })}
                colors={dotColors(frame.candidate.status)}
                live={frame.candidate.live}
                kind="run"
                paint="background"
                bandTop={layerBandTop}
                bandHeight={layerBandHeight}
                entryOffsetPx={runFrameEntryOffset(
                  timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  ),
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
                entryPending={frameEntryPending(
                  `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                )}
              />
            {/each}
          </div>
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
            {#each chainFrameLayouts as frame (frame.candidate.key)}
              {@const incomingEdge = frame.candidate.workflowKey
                ? incomingEdgeByWorkflowKey.get(frame.candidate.workflowKey)
                : undefined}
              <WorkflowFrame
                geometry={frame.geometry}
                label={frame.candidate.label}
                workflowType={frame.candidate.workflow?.name}
                accessibleName={translate('workflows.row-accessible-name', {
                  workflowId: frame.candidate.workflow?.id ?? '',
                  status: getWorkflowStatusLabel(frame.candidate.status),
                })}
                color={inheritedWorkflowFrameColor}
                colors={inheritedWorkflowDotColors}
                live={frame.candidate.live}
                kind="chain"
                paint="foreground"
                bandTop={layerBandTop}
                bandHeight={layerBandHeight}
                entryOffsetPx={workflowFrameEntryOffset(
                  frame.candidate.workflowKey ?? '',
                )}
                entryKey={`${frame.candidate.workflowKey ?? ''}:workflow-header`}
                bottomEntryOffsetPx={frameBottomEntryOffset({
                  topKey: `${frame.candidate.workflowKey ?? ''}:workflow-header`,
                  rowEnd: frame.span.rowEnd,
                })}
                entryPending={frameEntryPending(
                  `${frame.candidate.workflowKey ?? ''}:workflow-header`,
                )}
                onToggle={incomingEdge
                  ? () => recursiveSession.toggle(incomingEdge.key)
                  : undefined}
              />
            {/each}
            {#each runFrameLayouts as frame (frame.candidate.key)}
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
                color={strokeColor({
                  status: frame.candidate.status,
                  delayed:
                    frame.candidate.live &&
                    Boolean(
                      frame.candidate.workflow &&
                      isWorkflowDelayed(frame.candidate.workflow),
                    ),
                })}
                colors={dotColors(frame.candidate.status)}
                live={frame.candidate.live}
                kind="run"
                paint="foreground"
                bandTop={layerBandTop}
                bandHeight={layerBandHeight}
                entryOffsetPx={runFrameEntryOffset(
                  timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  ),
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
                entryPending={frameEntryPending(
                  `${timelineRunKey(
                    frame.candidate.workflowKey ?? '',
                    frame.candidate.runId,
                  )}:frame-header`,
                )}
              />
            {/each}
          </div>

          <!-- Keyed by slot index so Svelte reuses the <li>s in place; the <li>
             persists when its slot is null, only the inner row toggles.
             pointer-events-none so clicks fall through to the collapse toggles;
             event buttons opt back in with pointer-events:auto. -->
          <ul
            class="pointer-events-none absolute inset-0 m-0 list-none p-0"
            class:timeline-rows-entering={rowEntryOffsets.size > 0}
            class:timeline-rows-animating={rowEntryAnimating}
            bind:this={rowStackEl}
          >
            {#each pool as slot, slotIndex (slotIndex)}
              {@const rowKey = slot ? layoutRowKey(slot.row) : ''}
              {@const entryOffsetPx = rowEntryOffsets.get(rowKey) ?? 0}
              <li
                class="absolute left-0 right-0 top-0"
                class:timeline-row-entering={entryOffsetPx !== 0}
                class:timeline-row-animating={rowEntryAnimating}
                class:timeline-row-entry-pending={!rowEntryAnimating &&
                  rowEntryNewKeys.has(rowKey)}
                data-timeline-key={rowKey || undefined}
                data-timeline-entry-offset={entryOffsetPx || undefined}
                data-timeline-entry-key={rowKey || undefined}
                style:display={slot ? 'block' : 'none'}
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
                  {@const childControlAfterX =
                    projectX(timelineEntry.group.lastEvent.eventTime) +
                    RADIUS * 1.5 +
                    1}
                  {@const childControlFitsAfter =
                    childControlAfterX + 24 <= canvasWidth - GUTTER}
                  {@const childControlX = slot.row.childEdge
                    ? childControlFitsAfter
                      ? childControlAfterX
                      : Math.max(
                          GUTTER + slot.row.childEdge.depth * 12,
                          projectX(timelineEntry.group.initialEvent.eventTime) -
                            RADIUS * 1.5 -
                            24,
                        )
                    : undefined}
                  <div class="timeline-motion-layer absolute inset-0">
                    <TimelineGraphRow
                      group={timelineEntry.group}
                      timelineKey={timelineEntry.timelineKey}
                      eventCount={timelineEntry.group.eventList.length}
                      {canvasWidth}
                      project={projectX}
                      {readOnly}
                      active={timelineEntry?.active ?? true}
                      retainedEndTimeMs={timelineEntry?.active
                        ? undefined
                        : timelineEntry?.runEndTimeMs}
                      labelLeadingOffsetPx={slot.row.childEdge &&
                      childControlFitsAfter
                        ? 34
                        : 0}
                      labelTrailingOffsetPx={slot.row.childEdge &&
                      !childControlFitsAfter
                        ? 34
                        : 0}
                    />
                    {#if slot.row.childEdge}
                      <TimelineChildEdgeRow
                        edge={slot.row.childEdge}
                        {canvasWidth}
                        anchorX={childControlX}
                        onToggle={(edgeKey) => recursiveSession.toggle(edgeKey)}
                        onRetry={(edgeKey) => recursiveSession.retry(edgeKey)}
                      />
                    {/if}
                  </div>
                {:else if slot?.row.kind === 'child-state'}
                  <TimelineChildEdgeRow
                    edge={slot.row.edge}
                    {canvasWidth}
                    presentation="state"
                    onToggle={(edgeKey) => recursiveSession.toggle(edgeKey)}
                    onRetry={(edgeKey) => recursiveSession.retry(edgeKey)}
                  />
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        {#if timelineLoading && containmentLayout.pendingGap}
          {@const rectY =
            TIMELINE_VERTICAL_PADDING +
            (containmentLayout.pendingGap.rowStart + 1.5) * ROW_HEIGHT +
            shiftFor(containmentLayout.pendingGap.insertionIndex)}
          {@const rectH =
            containmentLayout.pendingGap.rowCount * ROW_HEIGHT + RADIUS}
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
            {@const activeGroup = activeTimelineEntry.group}
            {@const panelY = getY(activeIdx) + 1.33 * RADIUS}
            <GroupDetailsRow
              y={panelY}
              group={activeGroup}
              timelineKey={getTimelineKey(activeGroup)}
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

  .timeline-row-entry-pending {
    visibility: hidden;
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
