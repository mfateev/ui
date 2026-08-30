import type { EventGroup } from '$lib/models/event-groups/event-groups';
import type { WorkflowEvent } from '$lib/types/events';

import type { ChildWorkflowReference } from './recursive-timeline-model';

const attributes = (event: WorkflowEvent): Record<string, unknown> =>
  event.attributes as Record<string, unknown>;

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const getChildWorkflowReference = (
  group: EventGroup,
  currentNamespace: string,
): ChildWorkflowReference | null => {
  const started = group.eventList.find(
    (event) => event.eventType === 'ChildWorkflowExecutionStarted',
  );
  if (!started) return null;

  const startedAttributes = attributes(started);
  const execution = startedAttributes.workflowExecution;
  if (!execution || typeof execution !== 'object') return null;
  const workflowId = stringValue(
    (execution as Record<string, unknown>).workflowId,
  );
  const runId = stringValue((execution as Record<string, unknown>).runId);
  if (!workflowId || !runId) return null;

  const initiated = group.eventList.find(
    (event) => event.eventType === 'StartChildWorkflowExecutionInitiated',
  );
  const namespace =
    stringValue(startedAttributes.namespace) ??
    (initiated ? stringValue(attributes(initiated).namespace) : undefined) ??
    currentNamespace;

  return { namespace, workflowId, runId };
};
