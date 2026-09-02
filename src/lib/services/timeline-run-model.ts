import type { ChildWorkflowReference } from '$lib/components/lines-and-dots/timeline-graph/recursive-timeline-model';
import type { EventGroup } from '$lib/models/event-groups/event-groups';
import {
  getEventGroupDisplayName,
  getEventGroupLabel,
} from '$lib/models/event-groups/get-group-name';
import { resolveSystemNexusEvent } from '$lib/system-nexus-endpoints';
import type {
  EventClassification,
  EventTypeCategory,
  WorkflowEvent,
} from '$lib/types/events';
import { validTimeToDate } from '$lib/utilities/format-time';
import { isActivityTaskScheduledEvent } from '$lib/utilities/is-event-type';

import type { GroupedEventBuffer, LazyGroup } from './grouped-event-buffer';
import type { WorkflowChainOverviewRun } from './workflow-chain-overview';

export type TimelineEventPoint = {
  eventId: number;
  timestampMs: number;
  classification: EventClassification;
};

export type TimelineRowPresentation = {
  displayName: string;
  prefix: string;
  initialEventType: WorkflowEvent['eventType'];
  activityStartedTimeMs?: number;
  retryAttempt: number;
  retried: boolean;
  scheduling: boolean;
  timelineCategory: EventTypeCategory | 'retry' | 'pending';
  pendingAttempt?: number;
  pendingMaximumAttempts?: number;
  pendingPaused: boolean;
  pendingPauseTimeMs?: number;
};

export type TimelineGroupSummary = {
  key: string;
  version: number;
  initialEventId: number;
  finalEventId: number;
  startTimeMs: number;
  endTimeMs: number;
  category: EventTypeCategory;
  classification: EventClassification;
  finalClassification: EventClassification;
  eventCount: number;
  points: readonly TimelineEventPoint[];
  row: TimelineRowPresentation;
  pending: boolean;
  childWorkflow?: ChildWorkflowReference;
};

export interface TimelineRunModel {
  readonly run: WorkflowChainOverviewRun;
  readonly revision: number;
  readonly groupCount: number;
  readonly statistics?: TimelineRunModelStatistics;
  groupAt(ordinal: number): TimelineGroupSummary | undefined;
  groups(startOrdinal: number, endOrdinal: number): TimelineGroupSummary[];
  loadDetails(key: string, expectedVersion: number): Promise<EventGroup>;
  retain(): () => void;
  dispose(): void;
}

export type TimelineRunModelStatistics = {
  eventCount: number;
  estimatedBytes: number;
};

export class StaleTimelineGroupError extends Error {
  constructor() {
    super('The timeline group changed before its details were loaded.');
    this.name = 'StaleTimelineGroupError';
  }
}

type DetailCacheEntry = {
  group: EventGroup;
  bytes: number;
  live: boolean;
  runKey: string;
  pins: number;
};

const estimateStringBytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

export const estimateTimelineGroupBytes = (
  summary: TimelineGroupSummary,
): number => {
  let bytes = 64;
  bytes += estimateStringBytes(summary.key);
  bytes += estimateStringBytes(summary.row.displayName);
  bytes += estimateStringBytes(summary.row.prefix);
  bytes += summary.points.length * 24;
  if (summary.childWorkflow) {
    bytes += estimateStringBytes(summary.childWorkflow.namespace);
    bytes += estimateStringBytes(summary.childWorkflow.workflowId);
    bytes += estimateStringBytes(summary.childWorkflow.runId);
  }
  return bytes;
};

const estimateDetailBytes = (group: EventGroup): number => {
  let bytes = 64;
  for (const event of group.eventList) {
    bytes +=
      64 + estimateStringBytes(event.eventType) + estimateStringBytes(event.id);
    try {
      bytes += estimateStringBytes(JSON.stringify(event.attributes));
    } catch {
      bytes += 64;
    }
  }
  return bytes;
};

export class TimelineDetailCache {
  private readonly entries = new Map<string, DetailCacheEntry>();
  private totalBytes = 0;

  constructor(readonly maximumBytes: number) {}

  get bytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): EventGroup | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.group;
  }

  set(
    key: string,
    group: EventGroup,
    { live, runKey }: { live: boolean; runKey: string },
  ): void {
    this.delete(key);
    const entry = {
      group,
      bytes: estimateDetailBytes(group),
      live,
      runKey,
      pins: 0,
    };
    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;
    this.evict();
  }

  pin(key: string): () => void {
    const entry = this.entries.get(key);
    if (!entry) return () => undefined;
    entry.pins += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.pins = Math.max(0, entry.pins - 1);
      this.evict();
    };
  }

  invalidateLiveRun(runKey: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.live && entry.runKey === runKey) this.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }

  private evict(): void {
    if (this.totalBytes <= this.maximumBytes) return;
    for (const [key, entry] of this.entries) {
      if (entry.pins > 0) continue;
      this.delete(key);
      if (this.totalBytes <= this.maximumBytes) return;
    }
  }
}

const eventTimeMs = (event: WorkflowEvent): number =>
  event.eventTime ? validTimeToDate(event.eventTime).getTime() : 0;

const toSummary = (
  lazy: LazyGroup,
  currentNamespace: string,
): TimelineGroupSummary => {
  const pendingActivity = lazy.pendingActivity;
  const pauseTime = pendingActivity?.pauseInfo?.pauseTime;
  const retryAttempt = lazy.activityAttempt ?? 0;
  const child = lazy.childWorkflow;
  return {
    key: lazy.id,
    version: lazy.version ?? 0,
    initialEventId: Number(lazy.initialEvent.id),
    finalEventId: Number(lazy.lastEvent.id),
    startTimeMs: eventTimeMs(lazy.initialEvent),
    endTimeMs: eventTimeMs(lazy.lastEvent),
    category: lazy.category,
    classification: lazy.classification,
    finalClassification: lazy.finalClassification,
    eventCount: lazy.eventCount,
    points: (
      lazy.eventPoints ?? [
        {
          eventId: Number(lazy.initialEvent.id),
          timeMs: eventTimeMs(lazy.initialEvent),
          classification: lazy.initialEvent.classification,
        },
      ]
    ).map((point) => ({
      eventId: point.eventId,
      timestampMs: point.timeMs,
      classification: point.classification,
    })),
    row: {
      displayName: getEventGroupDisplayName(lazy.initialEvent as never),
      prefix: isActivityTaskScheduledEvent(lazy.initialEvent)
        ? getEventGroupDisplayName(lazy.initialEvent as never)
        : getEventGroupLabel(lazy.initialEvent as never),
      initialEventType: lazy.initialEvent.eventType,
      activityStartedTimeMs: lazy.activityStartedTimeMs,
      retryAttempt,
      retried: retryAttempt > 1,
      scheduling: lazy.finalClassification === 'Completed',
      timelineCategory:
        resolveSystemNexusEvent(lazy.initialEvent)?.timelineCategory ??
        lazy.category,
      pendingAttempt: pendingActivity?.attempt ?? undefined,
      pendingMaximumAttempts: pendingActivity?.maximumAttempts ?? undefined,
      pendingPaused: Boolean(pendingActivity?.paused),
      pendingPauseTimeMs: pauseTime
        ? validTimeToDate(pauseTime).getTime()
        : undefined,
    },
    pending: lazy.isPending,
    childWorkflow: child
      ? {
          namespace: child.namespace ?? currentNamespace,
          workflowId: child.workflowId,
          runId: child.runId,
        }
      : undefined,
  };
};

export class BufferTimelineRunModel implements TimelineRunModel {
  private buffer: GroupedEventBuffer | null;
  private _revision = 0;
  private leases = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly summaryCache = new Map<
    number,
    { version: number; summary: TimelineGroupSummary }
  >();

  constructor(
    readonly run: WorkflowChainOverviewRun,
    private readonly namespace: string,
    private readonly workflowId: string,
    buffer: GroupedEventBuffer,
    private readonly detailCache: TimelineDetailCache,
  ) {
    this.buffer = buffer;
    this.unsubscribe = buffer.onChange(() => {
      this._revision += 1;
    });
  }

  get revision(): number {
    return this._revision;
  }

  get groupCount(): number {
    return this.lazyGroups().length;
  }

  get sourceGroups(): readonly LazyGroup[] {
    return this.lazyGroups();
  }

  get statistics(): TimelineRunModelStatistics {
    let eventCount = 0;
    let estimatedBytes = 0;
    for (const group of this.lazyGroups()) {
      eventCount += group.eventCount;
      // Cache accounting only needs a stable, conservative approximation. Do
      // not build TimelineGroupSummary objects just to measure their strings.
      estimatedBytes +=
        64 +
        estimateStringBytes(group.id) +
        estimateStringBytes(group.initialEvent.eventType) * 2 +
        (group.eventPoints?.length ?? 1) * 24;
      if (group.childWorkflow) {
        estimatedBytes += estimateStringBytes(
          group.childWorkflow.namespace ?? this.namespace,
        );
        estimatedBytes += estimateStringBytes(group.childWorkflow.workflowId);
        estimatedBytes += estimateStringBytes(group.childWorkflow.runId);
      }
    }
    return { eventCount, estimatedBytes };
  }

  materializeSource(group: EventGroup | LazyGroup): EventGroup {
    if ('eventList' in group) return group;
    const version = group.version ?? 0;
    const cacheKey = this.detailKey(group.id, version);
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;
    const materialized = this.requireBuffer().materializeGroup(group);
    this.detailCache.set(cacheKey, materialized, {
      live: this.run.status === 'Running' || this.run.status === 'Paused',
      runKey: this.runKey,
    });
    return materialized;
  }

  groupAt(ordinal: number): TimelineGroupSummary | undefined {
    const lazy = this.lazyGroups()[ordinal];
    if (!lazy) return undefined;
    const version = lazy.version ?? 0;
    const cached = this.summaryCache.get(ordinal);
    if (cached?.version === version) return cached.summary;
    const summary = toSummary(lazy, this.namespace);
    this.summaryCache.set(ordinal, { version, summary });
    return summary;
  }

  groups(startOrdinal: number, endOrdinal: number): TimelineGroupSummary[] {
    const start = Math.max(0, startOrdinal);
    const end = Math.min(this.groupCount, Math.max(start, endOrdinal));
    const groups: TimelineGroupSummary[] = [];
    for (let ordinal = start; ordinal < end; ordinal += 1) {
      const group = this.groupAt(ordinal);
      if (group) groups.push(group);
    }
    return groups;
  }

  async loadDetails(key: string, expectedVersion: number): Promise<EventGroup> {
    const buffer = this.requireBuffer();
    const cacheKey = this.detailKey(key, expectedVersion);
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;
    const lazy = buffer
      .getLazyGroups({ excludeWorkflowTasks: true })
      .find((candidate) => candidate.id === key);
    if (!lazy || (lazy.version ?? 0) !== expectedVersion) {
      throw new StaleTimelineGroupError();
    }
    const group = this.materializeSource(lazy);
    if ((lazy.version ?? 0) !== expectedVersion) {
      throw new StaleTimelineGroupError();
    }
    return group;
  }

  retain(): () => void {
    if (this.disposed)
      throw new Error('Cannot retain a disposed timeline model.');
    this.leases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases = Math.max(0, this.leases - 1);
      if (this.leases === 0) this.dispose();
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.detailCache.invalidateLiveRun(this.runKey);
    this.summaryCache.clear();
    this.buffer?.reset(0);
    this.buffer = null;
  }

  private lazyGroups(): LazyGroup[] {
    return this.requireBuffer().getLazyGroups({ excludeWorkflowTasks: true });
  }

  private requireBuffer(): GroupedEventBuffer {
    if (!this.buffer || this.disposed) {
      throw new Error('The timeline run model has been disposed.');
    }
    return this.buffer;
  }

  private get runKey(): string {
    return `${this.namespace}:${this.workflowId}:${this.run.runId}`;
  }

  private detailKey(key: string, version: number): string {
    return `${this.runKey}:${key}:${version}`;
  }
}

export const estimateTimelineModelBytes = (model: TimelineRunModel): number => {
  let bytes = 0;
  for (let ordinal = 0; ordinal < model.groupCount; ordinal += 1) {
    const summary = model.groupAt(ordinal);
    if (summary) bytes += estimateTimelineGroupBytes(summary);
  }
  return bytes;
};

export class TimelineRunModelCache {
  private readonly entries = new Map<
    string,
    { model: TimelineRunModel; bytes: number; release: () => void }
  >();
  private totalBytes = 0;

  constructor(
    readonly maximumEntries: number,
    readonly maximumBytes: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get(key: string): TimelineRunModel | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.model;
  }

  set(key: string, model: TimelineRunModel, bytes: number): void {
    this.delete(key);
    const entry = { model, bytes, release: model.retain() };
    this.entries.set(key, entry);
    this.totalBytes += bytes;
    this.evict();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    entry.release();
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }

  private evict(): void {
    while (
      this.entries.size > this.maximumEntries ||
      this.totalBytes > this.maximumBytes
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.delete(oldestKey);
    }
  }
}
