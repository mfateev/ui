import { SvelteSet } from 'svelte/reactivity';

import type { LazyGroup } from '$lib/services/grouped-event-buffer';
import type { WorkflowExecution } from '$lib/types/workflows';
import { isWorkflowDelayed } from '$lib/utilities/delayed-workflows';
import { validTimeToDate } from '$lib/utilities/format-time';

import {
  buildTimeSegments,
  buildTimeSegmentsFromRanges,
  type TimelineActiveTimeRange,
} from './build-time-segments';
import { Timespan } from './timespan';
import type { TimeSegment, TimeSegmentKey } from './types';

const DEFAULT_DURATION_THRESHOLD_RATIO = 0.1;

interface TimelineInit {
  getFirstEventTime?: () => string | undefined;
  getWorkflow: () => WorkflowExecution;
  getLazyGroups: () => Iterable<LazyGroup>;
  getPrecompiledActiveRanges?: () =>
    | Iterable<TimelineActiveTimeRange>
    | undefined;
  getLazyGroupEndMs?: (group: LazyGroup) => number | undefined;
  getCurrentTimeMs: () => number;
  getDurationThresholdRatio?: () => number;
  getLoading?: () => boolean;
  getShouldCollapseByDefault?: () => boolean;
  getStartTimeMs?: () => number | undefined;
  getEndTimeMs?: () => number | undefined;
  getEndUnbounded?: () => boolean;
}

export class Timeline {
  private _collapsedSegmentKeys = new SvelteSet<TimeSegmentKey>();
  private _hasUserToggled = false;

  private _getWorkflow: () => WorkflowExecution;
  private _getFirstEventTime: () => string | undefined;
  private _getLazyGroups: () => Iterable<LazyGroup>;
  private _getPrecompiledActiveRanges?: () =>
    | Iterable<TimelineActiveTimeRange>
    | undefined;
  private _getLazyGroupEndMs?: (group: LazyGroup) => number | undefined;
  private _getCurrentTimeMs: () => number;
  private _getDurationThresholdRatio: () => number;
  private _getLoading: () => boolean;
  private _getShouldCollapseByDefault: () => boolean;
  private _getStartTimeMs: () => number | undefined;
  private _getEndTimeMs: () => number | undefined;
  private _getEndUnbounded: () => boolean;

  constructor({
    getFirstEventTime,
    getWorkflow,
    getLazyGroups,
    getPrecompiledActiveRanges,
    getLazyGroupEndMs,
    getCurrentTimeMs,
    getDurationThresholdRatio,
    getLoading,
    getShouldCollapseByDefault,
    getStartTimeMs,
    getEndTimeMs,
    getEndUnbounded,
  }: TimelineInit) {
    this._getFirstEventTime = getFirstEventTime ?? (() => undefined);
    this._getWorkflow = getWorkflow;
    this._getLazyGroups = getLazyGroups;
    this._getPrecompiledActiveRanges = getPrecompiledActiveRanges;
    this._getLazyGroupEndMs = getLazyGroupEndMs;
    this._getCurrentTimeMs = getCurrentTimeMs;
    this._getDurationThresholdRatio =
      getDurationThresholdRatio ?? (() => DEFAULT_DURATION_THRESHOLD_RATIO);
    this._getLoading = getLoading ?? (() => false);
    this._getShouldCollapseByDefault =
      getShouldCollapseByDefault ?? (() => false);
    this._getStartTimeMs = getStartTimeMs ?? (() => undefined);
    this._getEndTimeMs = getEndTimeMs ?? (() => undefined);
    this._getEndUnbounded =
      getEndUnbounded ?? (() => !this._getWorkflow().endTime);

    // Finalize once the fetch completes: releasing the freeze (see `segments`)
    // builds the real segment set, and collapsing the idle gaps by default is
    // the same lifecycle moment — both key off the loading→done transition.
    // While loading, `segments` is a single span so this is a no-op anyway.
    $effect(() => {
      if (!this._getLoading() && this._getShouldCollapseByDefault()) {
        this.collapseAllSegmentsByDefault();
      }
    });
  }

  readonly workflow = $derived.by(() => this._getWorkflow());
  readonly lazyGroups = $derived.by(() => this._getLazyGroups());
  private readonly _endUnbounded = $derived.by(() => this._getEndUnbounded());

  private readonly _endMs = $derived.by(() => {
    // `||` not `??`: a running workflow's endTime is often an empty string, not
    // null — fall back to "now" so validTimeToDate doesn't throw on "".
    const end =
      this._getEndTimeMs() ??
      (this.workflow.endTime || this._getCurrentTimeMs());
    return validTimeToDate(end).getTime();
  });

  private readonly _workflowStartMs = $derived.by(() => {
    const firstEventTime = this._getFirstEventTime();
    let earliestStartTime = this.workflow.executionTime;
    if (
      firstEventTime &&
      (!earliestStartTime ||
        validTimeToDate(firstEventTime).getTime() <
          validTimeToDate(earliestStartTime).getTime())
    ) {
      earliestStartTime = firstEventTime;
    }
    const workflowStart =
      (isWorkflowDelayed(this.workflow) && this.workflow.startTime
        ? this.workflow.startTime
        : earliestStartTime) ??
      this.workflow.startTime ??
      this._endMs;

    return Math.min(validTimeToDate(workflowStart).getTime(), this._endMs);
  });

  private readonly _startMs = $derived.by(() => {
    const requestedStart = this._getStartTimeMs();
    return Math.min(
      requestedStart ?? this._workflowStartMs,
      this._workflowStartMs,
    );
  });

  // Primitive-number deriveds above so the Timespan (and everything downstream)
  // only rebuilds when a boundary actually changes, not on every streamed event.
  readonly workflowTimespan = $derived.by(
    () =>
      new Timespan(this._startMs, this._endMs, {
        endUnbounded: this._endUnbounded,
      }),
  );

  readonly segments = $derived.by<TimeSegment[]>(() => {
    // While history is still streaming, the event-derived gaps shift on every
    // page, which reprojects every already-placed event and forces a full-canvas
    // repaint each frame. Hold a single linear span until the fetch completes,
    // then build the real segmented scale once (one reflow instead of ~1/page).
    if (this._getLoading()) {
      return [{ kind: 'active', timespan: this.workflowTimespan }];
    }
    const precompiled = this._getPrecompiledActiveRanges?.();
    if (precompiled) {
      return buildTimeSegmentsFromRanges({
        workflowTimespan: this.workflowTimespan,
        groupTimespans: precompiled,
      });
    }
    return buildTimeSegments({
      workflowTimespan: this.workflowTimespan,
      lazyGroups: this.lazyGroups,
      getEventGroupEndMs: this._getLazyGroupEndMs,
    });
  });

  // Raw set membership (not isTimeSegmentCollapsed): the guarded check reads this
  // value so it'd be circular, and using raw membership keeps the denominator
  // stable so expanding one gap can't cascade borderline gaps open.
  readonly expandedDurationMs = $derived.by(() =>
    this.segments.reduce(
      (sum, segment) =>
        this._isSegmentCollapsedRaw(segment)
          ? sum
          : sum + segment.timespan.durationMs,
      0,
    ),
  );

  private _isSegmentCollapsedRaw(segment: TimeSegment): boolean {
    return this._collapsedSegmentKeys.has(segment.timespan.key);
  }

  isTimeSegmentCollapsible(segment: TimeSegment): boolean {
    if (segment.kind !== 'inactive') return false;
    if (this.segments.length <= 1) return false;
    if (this.expandedDurationMs <= 0) return false;

    return (
      segment.timespan.durationMs / this.expandedDurationMs >=
      this._getDurationThresholdRatio()
    );
  }

  isTimeSegmentCollapsed(segment: TimeSegment): boolean {
    return (
      this._isSegmentCollapsedRaw(segment) &&
      this.isTimeSegmentCollapsible(segment)
    );
  }

  readonly collapsibleSegments = $derived(
    this.segments.filter((segment) => this.isTimeSegmentCollapsible(segment)),
  );

  readonly hasCollapsibleSegments = $derived(
    this.collapsibleSegments.length > 0,
  );

  readonly allCollapsibleSegmentsCollapsed = $derived(
    this.hasCollapsibleSegments &&
      this.collapsibleSegments.every((segment) =>
        this.isTimeSegmentCollapsed(segment),
      ),
  );

  toggleTimeSegment(segment: TimeSegment): void {
    this._hasUserToggled = true;
    const key = segment.timespan.key;
    if (this._collapsedSegmentKeys.has(key)) {
      this._collapsedSegmentKeys.delete(key);
    } else {
      this._collapsedSegmentKeys.add(key);
    }
  }

  expandAllSegments(): void {
    this._hasUserToggled = true;
    this._collapsedSegmentKeys.clear();
  }

  collapseAllSegments(): void {
    this._hasUserToggled = true;
    this._collapseAllSegments();
  }

  collapseAllSegmentsByDefault(): void {
    if (this._hasUserToggled) return;
    this._collapseAllSegments();
  }

  private _collapseAllSegments(): void {
    // Doesn't set _hasUserToggled — only public methods do.
    // Loops because collapsing shrinks expandedDurationMs, which can push more
    // segments past the threshold.
    let collapsed = true;
    while (collapsed) {
      collapsed = false;
      for (const segment of this.segments) {
        const key = segment.timespan.key;
        if (this._collapsedSegmentKeys.has(key)) continue;
        if (this.isTimeSegmentCollapsible(segment)) {
          this._collapsedSegmentKeys.add(key);
          collapsed = true;
        }
      }
    }
  }
}
