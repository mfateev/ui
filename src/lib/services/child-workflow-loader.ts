import type { ChildWorkflowReference } from '$lib/components/lines-and-dots/timeline-graph/recursive-timeline-model';
import type { TimelineTruncation } from '$lib/components/lines-and-dots/timeline-graph/recursive-timeline-model';
import { groupEvents } from '$lib/models/event-groups';
import { toEventHistory } from '$lib/models/event-history';
import { toWorkflowExecution } from '$lib/models/workflow-execution';
import type {
  CommonHistoryEvent,
  GetWorkflowExecutionHistoryResponse,
} from '$lib/types/events';
import type { NetworkError } from '$lib/types/global';
import type {
  WorkflowExecution,
  WorkflowExecutionAPIResponse,
} from '$lib/types/workflows';
import { requestFromAPI } from '$lib/utilities/request-from-api';
import { routeForApi } from '$lib/utilities/route-for-api';

import {
  getClosureFromEvents,
  getSuccessorFromEvents,
  type TimelineRun,
  toTimelineGroups,
} from './chain-workflow-session';

export type ChildWorkflowLoadErrorKind =
  | 'unavailable'
  | 'unauthorized'
  | 'network'
  | 'malformed';

export class ChildWorkflowLoadError extends Error {
  readonly kind: ChildWorkflowLoadErrorKind;
  readonly retryable: boolean;

  constructor(kind: ChildWorkflowLoadErrorKind, reason: string) {
    super(reason);
    this.name = 'ChildWorkflowLoadError';
    this.kind = kind;
    this.retryable = kind === 'network';
  }
}

export type ChildWorkflowHistoryLimits = {
  maximumEvents: number;
  maximumGroups: number;
};

export type LoadedChildWorkflow = {
  workflow: WorkflowExecution;
  run: TimelineRun;
  eventCount: number;
  groupCount: number;
  truncation?: TimelineTruncation;
};

export type ChildWorkflowRequest = <T>(
  route: string,
  init: {
    params?: Record<string, string>;
    token?: string;
    options?: RequestInit;
  },
) => Promise<T | undefined>;

const defaultRequest: ChildWorkflowRequest = (route, init) =>
  requestFromAPI(route, {
    ...init,
    request: fetch,
    notifyOnError: false,
  });

const statusCode = (error: unknown): number | undefined => {
  const candidate = error as Partial<NetworkError> & { status?: number };
  return candidate.statusCode ?? candidate.response?.status ?? candidate.status;
};

export const classifyChildWorkflowError = (
  error: unknown,
): ChildWorkflowLoadError => {
  if (error instanceof ChildWorkflowLoadError) return error;
  const status = statusCode(error);
  const reason =
    error instanceof Error
      ? error.message
      : ((error as { message?: string })?.message ??
        'Unable to load child workflow');
  if (status === 401 || status === 403) {
    return new ChildWorkflowLoadError('unauthorized', reason);
  }
  if (status === 404) {
    return new ChildWorkflowLoadError('unavailable', reason);
  }
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  return new ChildWorkflowLoadError('network', reason);
};

export const loadChildWorkflow = async ({
  reference,
  signal,
  limits,
  request = defaultRequest,
}: {
  reference: ChildWorkflowReference;
  signal: AbortSignal;
  limits: ChildWorkflowHistoryLimits;
  request?: ChildWorkflowRequest;
}): Promise<LoadedChildWorkflow> => {
  try {
    const describeRoute = routeForApi('workflow', {
      namespace: reference.namespace,
      workflowId: reference.workflowId,
    });
    const response = await request<WorkflowExecutionAPIResponse>(
      describeRoute,
      {
        params: { 'execution.runId': reference.runId },
        options: { signal },
      },
    );
    if (!response) {
      throw new ChildWorkflowLoadError(
        'unavailable',
        'The child workflow is unavailable',
      );
    }
    const workflow = toWorkflowExecution(response);
    if (
      !workflow.id ||
      !workflow.runId ||
      workflow.id !== reference.workflowId ||
      workflow.runId !== reference.runId
    ) {
      throw new ChildWorkflowLoadError(
        'malformed',
        'The child workflow response did not match the requested execution',
      );
    }

    const historyRoute = routeForApi('events.ascending', {
      namespace: reference.namespace,
      workflowId: reference.workflowId,
    });
    const acceptedEvents: CommonHistoryEvent[] = [];
    let token = '';
    let eventTruncated = false;
    do {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const remaining = limits.maximumEvents - acceptedEvents.length;
      if (remaining <= 0) {
        eventTruncated = Boolean(token);
        break;
      }
      const page = await request<GetWorkflowExecutionHistoryResponse>(
        historyRoute,
        {
          token,
          params: {
            'execution.runId': reference.runId,
            maximumPageSize: String(Math.min(1_000, remaining)),
          },
          options: { signal },
        },
      );
      const converted = await toEventHistory(page?.history?.events ?? []);
      if (converted.length > remaining) {
        eventTruncated = true;
        break;
      }
      acceptedEvents.push(...converted);
      token = String(page?.nextPageToken ?? '');
      if (acceptedEvents.length === limits.maximumEvents && token) {
        eventTruncated = true;
        break;
      }
    } while (token);

    const allGroups = groupEvents(
      acceptedEvents,
      'ascending',
      workflow.pendingActivities,
      workflow.pendingNexusOperations,
    );
    const groups = allGroups.slice(0, limits.maximumGroups);
    const groupTruncated = groups.length < allGroups.length;
    const closure = getClosureFromEvents(acceptedEvents);
    const endTimeMs =
      closure?.endTimeMs ??
      (workflow.endTime ? Date.parse(workflow.endTime) : Date.now());
    const run: TimelineRun = {
      runId: workflow.runId,
      status: closure?.status ?? workflow.status,
      startTimeMs: Date.parse(workflow.startTime),
      endTimeMs,
      active: !closure && (workflow.isRunning || workflow.isPaused),
      groups: toTimelineGroups(workflow.runId, groups),
      successorRunId: getSuccessorFromEvents(acceptedEvents)?.runId,
    };
    if (!Number.isFinite(run.startTimeMs) || !Number.isFinite(run.endTimeMs)) {
      throw new ChildWorkflowLoadError(
        'malformed',
        'The child workflow contains invalid timestamps',
      );
    }

    return {
      workflow,
      run,
      eventCount: groups.reduce(
        (count, group) => count + group.eventList.length,
        0,
      ),
      groupCount: groups.length,
      truncation: groupTruncated
        ? { reason: 'group-limit' }
        : eventTruncated
          ? { reason: 'event-limit' }
          : undefined,
    };
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw classifyChildWorkflowError(error);
  }
};
