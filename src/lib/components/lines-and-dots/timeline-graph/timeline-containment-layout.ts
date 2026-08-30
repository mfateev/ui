import type { TimelineRun } from '$lib/services/chain-workflow-session';

import type { TimelineGroupEntry } from './timeline-run-entries';

export type TimelineLayoutRow =
  | {
      kind: 'group';
      key: string;
      entry: TimelineGroupEntry;
      rowIndex: number;
    }
  | { kind: 'empty-run'; key: string; runId: string; rowIndex: number }
  | {
      kind: 'run-gap';
      key: string;
      beforeRunId: string;
      afterRunId: string;
      rowIndex: number;
    };

export type TimelineRunSpan = {
  runId: string;
  rowStart: number;
  rowEnd: number;
  empty: boolean;
  pendingRowStart: number | null;
  pendingRowCount: number;
};

export type TimelineContainmentLayout = {
  rows: TimelineLayoutRow[];
  runSpans: TimelineRunSpan[];
  chainSpan: { rowStart: number; rowEnd: number } | null;
  pendingGap: {
    runId: string;
    insertionIndex: number;
    rowStart: number;
    rowCount: number;
  } | null;
  totalRowCount: number;
};

export type ContainmentLayoutInput = {
  runs: TimelineRun[];
  visibleEntries: TimelineGroupEntry[];
  participatingRunIds: ReadonlySet<string>;
  reverseSort: boolean;
  pendingGroupCount: number;
  descMinId: number;
};

const eventId = (entry: TimelineGroupEntry): number =>
  Number(entry.group.initialEvent.id);

function orderEntries(
  entries: TimelineGroupEntry[],
  reverseSort: boolean,
): TimelineGroupEntry[] {
  return [...entries].sort((a, b) => {
    const idDifference = eventId(a) - eventId(b);
    const ordered = idDifference || a.timelineKey.localeCompare(b.timelineKey);
    return reverseSort ? -ordered : ordered;
  });
}

export function getTimelineContainmentLayout({
  runs,
  visibleEntries,
  participatingRunIds,
  reverseSort,
  pendingGroupCount,
  descMinId,
}: ContainmentLayoutInput): TimelineContainmentLayout {
  const entriesByRun = new Map<string, TimelineGroupEntry[]>();
  for (const entry of visibleEntries) {
    const entries = entriesByRun.get(entry.runId) ?? [];
    entries.push(entry);
    entriesByRun.set(entry.runId, entries);
  }

  const participatingRuns = runs
    .filter((run) => participatingRunIds.has(run.runId))
    .sort((a, b) => {
      const ordered =
        a.startTimeMs - b.startTimeMs || a.runId.localeCompare(b.runId);
      return reverseSort ? -ordered : ordered;
    });

  const rows: TimelineLayoutRow[] = [];
  const runSpans: TimelineRunSpan[] = [];
  let pendingGap: TimelineContainmentLayout['pendingGap'] = null;
  let rowIndex = 0;

  for (const [runIndex, run] of participatingRuns.entries()) {
    if (runIndex > 0) {
      const beforeRunId = participatingRuns[runIndex - 1].runId;
      rows.push({
        kind: 'run-gap',
        key: `run-gap:${beforeRunId}:${run.runId}`,
        beforeRunId,
        afterRunId: run.runId,
        rowIndex,
      });
      rowIndex += 1;
    }
    const ordered = orderEntries(
      entriesByRun.get(run.runId) ?? [],
      reverseSort,
    );
    const empty = ordered.length === 0;
    const rowStart = rowIndex;
    let pendingRowStart: number | null = null;
    const runPendingCount = run.active ? pendingGroupCount : 0;

    if (empty) {
      rows.push({
        kind: 'empty-run',
        key: `empty-run:${run.runId}`,
        runId: run.runId,
        rowIndex,
      });
      rowIndex += 1;
      if (runPendingCount > 0) {
        pendingRowStart = rowIndex;
        pendingGap = {
          runId: run.runId,
          insertionIndex: rows.length,
          rowStart: rowIndex,
          rowCount: runPendingCount,
        };
        rowIndex += runPendingCount;
      }
    } else {
      const hasCursorGap = runPendingCount > 0 && descMinId > 0;
      let gapInserted = false;
      for (const entry of ordered) {
        const isHighCursorEntry = eventId(entry) >= descMinId;
        const shouldInsertGap =
          hasCursorGap &&
          !gapInserted &&
          (reverseSort ? !isHighCursorEntry : isHighCursorEntry);
        if (shouldInsertGap) {
          pendingRowStart = rowIndex;
          pendingGap = {
            runId: run.runId,
            insertionIndex: rows.length,
            rowStart: rowIndex,
            rowCount: runPendingCount,
          };
          rowIndex += runPendingCount;
          gapInserted = true;
        }
        rows.push({
          kind: 'group',
          key: entry.timelineKey,
          entry,
          rowIndex,
        });
        rowIndex += 1;
      }
      if (runPendingCount > 0 && !gapInserted) {
        pendingRowStart = rowIndex;
        pendingGap = {
          runId: run.runId,
          insertionIndex: rows.length,
          rowStart: rowIndex,
          rowCount: runPendingCount,
        };
        rowIndex += runPendingCount;
      }
    }

    runSpans.push({
      runId: run.runId,
      rowStart,
      rowEnd: rowIndex,
      empty,
      pendingRowStart,
      pendingRowCount: runPendingCount,
    });
  }

  return {
    rows,
    runSpans,
    chainSpan: runSpans.length
      ? {
          rowStart: runSpans[0].rowStart,
          rowEnd: runSpans[runSpans.length - 1].rowEnd,
        }
      : null,
    pendingGap,
    totalRowCount: rowIndex,
  };
}
