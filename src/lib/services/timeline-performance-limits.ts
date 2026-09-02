export type TimelinePerformanceLimits = {
  successorDiscoveryRuns: number;
  intervalRunJobs: number;
  intervalHttpRequests: number;
  intervalRuns: number;
  intervalGroups: number;
  intervalEvents: number;
  intervalBytes: number;
  intervalCacheRuns: number;
  intervalCacheBytes: number;
  detailCacheBytes: number;
};

export const DEFAULT_TIMELINE_PERFORMANCE_LIMITS: TimelinePerformanceLimits = {
  successorDiscoveryRuns: 10_000,
  intervalRunJobs: 4,
  intervalHttpRequests: 8,
  intervalRuns: 256,
  intervalGroups: 550_000,
  intervalEvents: 650_000,
  intervalBytes: 128 * 1024 * 1024,
  intervalCacheRuns: 256,
  intervalCacheBytes: 128 * 1024 * 1024,
  detailCacheBytes: 16 * 1024 * 1024,
};

export type TimelineTruncationReason =
  | 'run-limit'
  | 'group-limit'
  | 'event-limit'
  | 'byte-limit'
  | 'discovery-limit'
  | 'load-error';

export type TimelinePartialResult = {
  reason: TimelineTruncationReason;
  startTimeMs: number;
  endTimeMs: number;
  omittedRuns?: number;
  omittedGroups?: number;
  affectsSelectedWindow: boolean;
};
