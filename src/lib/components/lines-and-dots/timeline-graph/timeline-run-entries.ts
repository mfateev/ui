import { allEventTypeOptions } from '$lib/models/event-history/get-event-categorization';
import type {
  TimelineGroup,
  TimelineRun,
} from '$lib/services/chain-workflow-session';
import type { EventTypeCategory } from '$lib/types/events';
import type { WorkflowStatus } from '$lib/types/workflows';
import { getFailedOrPendingGroups } from '$lib/utilities/get-failed-or-pending';

export type TimelineGroupEntry = TimelineGroup & {
  active: boolean;
  runEndTimeMs: number;
  resolvedStatus?: WorkflowStatus;
};

export function getTimelineGroupEntry(
  entry: TimelineGroup,
  run: TimelineRun,
  execution?: {
    status: WorkflowStatus;
    active: boolean;
    endTimeMs?: number;
  },
): TimelineGroupEntry {
  const active = execution?.active ?? run.active;
  const runEndTimeMs = execution?.endTimeMs ?? run.endTimeMs;
  const resolvedStatus = execution?.status;
  const entryResolvedStatus =
    'resolvedStatus' in entry ? entry.resolvedStatus : undefined;
  return entry.active === active &&
    entry.runEndTimeMs === runEndTimeMs &&
    entryResolvedStatus === resolvedStatus
    ? (entry as TimelineGroupEntry)
    : {
        ...entry,
        active,
        runEndTimeMs,
        resolvedStatus,
      };
}

export function getTimelineGroupEntries(
  runs: TimelineRun[],
): TimelineGroupEntry[] {
  return runs.flatMap((run) =>
    run.groups.map((entry) => getTimelineGroupEntry(entry, run)),
  );
}

export function filterTimelineGroupEntries({
  entries,
  eventTypes,
  failedOrPending,
}: {
  entries: TimelineGroupEntry[];
  eventTypes: EventTypeCategory[];
  failedOrPending: boolean;
}): TimelineGroupEntry[] {
  const selectedTypes = new Set(eventTypes);
  const allTypesSelected =
    selectedTypes.size === allEventTypeOptions.length &&
    allEventTypeOptions.every(({ value }) => selectedTypes.has(value));
  const eventTypeFiltered = allTypesSelected
    ? entries
    : entries.filter((entry) => selectedTypes.has(entry.group.category));
  return filterTimelineGroupEntriesByStatus(eventTypeFiltered, failedOrPending);
}

export function filterTimelineGroupEntriesByStatus(
  entries: TimelineGroupEntry[],
  failedOrPending: boolean,
): TimelineGroupEntry[] {
  if (!failedOrPending) return entries;
  const matchingGroups = new Set(
    getFailedOrPendingGroups(
      entries
        .filter((entry) => !entry.resolvedStatus)
        .map((entry) => entry.group),
      true,
    ),
  );
  return entries.filter((entry) =>
    entry.resolvedStatus
      ? entry.resolvedStatus === 'Failed' || entry.resolvedStatus === 'TimedOut'
      : matchingGroups.has(entry.group),
  );
}
