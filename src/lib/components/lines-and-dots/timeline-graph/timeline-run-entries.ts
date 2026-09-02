import type { EventGroup } from '$lib/models/event-groups/event-groups';
import { allEventTypeOptions } from '$lib/models/event-history/get-event-categorization';
import type {
  TimelineGroup,
  TimelineRun,
} from '$lib/services/chain-workflow-session';
import type { LazyGroup } from '$lib/services/grouped-event-buffer';
import type { EventTypeCategory } from '$lib/types/events';
import { getFailedOrPendingGroups } from '$lib/utilities/get-failed-or-pending';

export type TimelineGroupEntry = TimelineGroup & {
  active: boolean;
  runEndTimeMs: number;
};

export function getTimelineGroupEntries(
  runs: TimelineRun[],
): TimelineGroupEntry[] {
  return runs.flatMap((run) =>
    run.groups.map((entry) =>
      entry.active === run.active && entry.runEndTimeMs === run.endTimeMs
        ? (entry as TimelineGroupEntry)
        : {
            ...entry,
            active: run.active,
            runEndTimeMs: run.endTimeMs,
          },
    ),
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
      entries.map((entry) => entry.group),
      true,
    ),
  );
  return entries.filter((entry) => matchingGroups.has(entry.group));
}

export function getTimelineEntryMaps(entries: TimelineGroupEntry[]): {
  entryByGroup: Map<EventGroup | LazyGroup, TimelineGroupEntry>;
  keyByGroup: Map<EventGroup | LazyGroup, string>;
} {
  const entryByGroup = new Map<EventGroup | LazyGroup, TimelineGroupEntry>();
  const keyByGroup = new Map<EventGroup | LazyGroup, string>();
  for (const entry of entries) {
    entryByGroup.set(entry.group, entry);
    keyByGroup.set(entry.group, entry.timelineKey);
  }
  return {
    entryByGroup,
    keyByGroup,
  };
}
