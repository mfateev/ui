import type {
  ChainRetentionWindow,
  ChainTruncationState,
  RetainedTimelineRun,
} from '$lib/services/chain-workflow-session';

export const WORKFLOW_RUN_CTX = Symbol('workflow-run-ctx');

export type WorkflowRunContext = {
  readonly chainRunId: string;
  readonly activeRunId: string;
  readonly activeBufferRunId: string;
  readonly following: boolean;
  readonly staging: boolean;
  readonly retainedRuns: RetainedTimelineRun[];
  readonly truncation: ChainTruncationState | null;
  pruneRetainedRuns: (window: ChainRetentionWindow) => void;
  enableFollowing: () => Promise<void>;
  disableFollowing: () => Promise<void>;
  pinnedRunUrl: () => string;
};
