import type { TimelineRun } from '$lib/services/chain-workflow-session';

import {
  type TimelineChildEdge,
  type TimelineWorkflowNode,
  workflowGroupKey,
} from './recursive-timeline-model';
import type { TimelineGroupEntry } from './timeline-run-entries';

export type TimelineLayoutRow =
  | {
      kind: 'group';
      key: string;
      entry: TimelineGroupEntry;
      rowIndex: number;
      workflowKey?: string;
      runKey?: string;
      depth?: number;
      ancestorRunKeys?: string[];
      childEdge?: TimelineChildEdge;
    }
  | {
      kind: 'child-state';
      key: string;
      edge: TimelineChildEdge;
      workflowKey: string;
      runKey: string;
      runId: string;
      depth: number;
      ancestorRunKeys: string[];
      rowIndex: number;
    }
  | {
      kind: 'frame-header';
      key: string;
      workflowKey: string;
      runKey: string;
      runId: string;
      depth: number;
      ancestorRunKeys: string[];
      rowIndex: number;
    }
  | {
      kind: 'workflow-header';
      key: string;
      workflowKey: string;
      depth: number;
      ancestorRunKeys: string[];
      rowIndex: number;
    }
  | {
      kind: 'workflow-spacing';
      key: string;
      workflowKey: string;
      depth: number;
      ancestorRunKeys: string[];
      rowIndex: number;
    }
  | {
      kind: 'empty-run';
      key: string;
      runId: string;
      rowIndex: number;
      workflowKey?: string;
      runKey?: string;
      depth?: number;
      ancestorRunKeys?: string[];
    }
  | {
      kind: 'run-gap';
      key: string;
      beforeRunId: string;
      afterRunId: string;
      rowIndex: number;
      workflowKey?: string;
      depth?: number;
      ancestorRunKeys?: string[];
    };

export type TimelineRunSpan = {
  runId: string;
  rowStart: number;
  rowEnd: number;
  key?: string;
  workflowKey?: string;
  depth?: number;
  ancestorRunKeys?: string[];
};

export type TimelineWorkflowSpan = {
  key: string;
  workflowKey: string;
  rowStart: number;
  rowEnd: number;
  depth: number;
  ancestorRunKeys: string[];
};

export type TimelineContainmentLayout = {
  rows: TimelineLayoutRow[];
  runSpans: TimelineRunSpan[];
  workflowSpans?: TimelineWorkflowSpan[];
  chainSpan: { rowStart: number; rowEnd: number } | null;
  pendingGap: {
    insertionIndex: number;
    rowStart: number;
    rowCount: number;
  } | null;
  totalRowCount: number;
};

export type RecursiveContainmentLayoutInput = {
  root: TimelineWorkflowNode;
  visibleEntries: TimelineGroupEntry[];
  participatingRunKeys: ReadonlySet<string>;
  reverseSort: boolean;
  pendingGroupCount: number;
  descMinId: number;
};

export const timelineRunKey = (workflowKey: string, runId: string): string =>
  `${workflowKey}:run:${runId}`;

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
        pendingGap = {
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
          pendingGap = {
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
        pendingGap = {
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

export function getRecursiveTimelineContainmentLayout({
  root,
  visibleEntries,
  participatingRunKeys,
  reverseSort,
  pendingGroupCount,
  descMinId,
}: RecursiveContainmentLayoutInput): TimelineContainmentLayout {
  const visibleByGroup = new Map(
    visibleEntries.map((entry) => [entry.group, entry]),
  );
  const rows: TimelineLayoutRow[] = [];
  const runSpans: TimelineRunSpan[] = [];
  const workflowSpans: TimelineWorkflowSpan[] = [];
  let rowIndex = 0;
  let pendingGap: TimelineContainmentLayout['pendingGap'] = null;

  const appendState = ({
    edge,
    node,
    run,
    runKey,
    ancestorRunKeys,
  }: {
    edge: TimelineChildEdge;
    node: TimelineWorkflowNode;
    run: TimelineRun;
    runKey: string;
    ancestorRunKeys: string[];
  }) => {
    rows.push({
      kind: 'child-state',
      key: `${edge.key}:state`,
      edge,
      workflowKey: node.key,
      runKey,
      runId: run.runId,
      depth: edge.depth,
      ancestorRunKeys,
      rowIndex,
    });
    rowIndex += 1;
  };

  const visitWorkflow = (
    node: TimelineWorkflowNode,
    ancestorRunKeys: string[],
  ): void => {
    if (node.depth > 0) {
      rows.push({
        kind: 'workflow-spacing',
        key: `${node.key}:workflow-spacing-before`,
        workflowKey: node.key,
        depth: node.depth,
        ancestorRunKeys,
        rowIndex,
      });
      rowIndex += 1;
    }
    const workflowStart = rowIndex;
    const participatingRuns = node.runs
      .filter((run) =>
        participatingRunKeys.has(timelineRunKey(node.key, run.runId)),
      )
      .sort((a, b) => {
        const ordered =
          a.startTimeMs - b.startTimeMs || a.runId.localeCompare(b.runId);
        return reverseSort ? -ordered : ordered;
      });

    if (participatingRuns.length > 0) {
      rows.push({
        kind: 'workflow-header',
        key: `${node.key}:workflow-header`,
        workflowKey: node.key,
        depth: node.depth,
        ancestorRunKeys,
        rowIndex,
      });
      rowIndex += 1;
    }

    for (const run of participatingRuns) {
      const runKey = timelineRunKey(node.key, run.runId);
      const owners = [...ancestorRunKeys, runKey];
      const runStart = rowIndex;
      rows.push({
        kind: 'frame-header',
        key: `${runKey}:frame-header`,
        workflowKey: node.key,
        runKey,
        runId: run.runId,
        depth: node.depth,
        ancestorRunKeys,
        rowIndex,
      });
      rowIndex += 1;
      const orderedGroups = [...run.groups].sort((a, b) => {
        const idDifference =
          Number(a.group.initialEvent.id) - Number(b.group.initialEvent.id);
        const ordered =
          idDifference || a.timelineKey.localeCompare(b.timelineKey);
        return reverseSort ? -ordered : ordered;
      });
      let appended = false;
      let gapInserted = false;
      const runPendingCount =
        node === root && run.active ? pendingGroupCount : 0;
      const hasCursorGap = runPendingCount > 0 && descMinId > 0;

      for (const timelineGroup of orderedGroups) {
        const edge = node.childrenByGroupKey.get(timelineGroup.timelineKey);
        const entry = visibleByGroup.get(timelineGroup.group);
        if (!entry && !edge) continue;
        if (entry && hasCursorGap && !gapInserted) {
          const highCursor = eventId(entry) >= descMinId;
          if (reverseSort ? !highCursor : highCursor) {
            pendingGap = {
              insertionIndex: rows.length,
              rowStart: rowIndex,
              rowCount: runPendingCount,
            };
            rowIndex += runPendingCount;
            gapInserted = true;
          }
        }

        const childIsExpanded =
          edge?.expansion === 'expanded' && edge.load.state === 'loaded';
        if (childIsExpanded) appended = true;
        if (entry && !childIsExpanded) {
          rows.push({
            kind: 'group',
            key:
              edge?.key ??
              workflowGroupKey({
                executionKey: node.key,
                runId: run.runId,
                timelineKey: entry.timelineKey,
              }),
            entry,
            workflowKey: node.key,
            runKey,
            depth: node.depth,
            ancestorRunKeys: owners,
            childEdge: edge,
            rowIndex,
          });
          rowIndex += 1;
          appended = true;
        }

        if (!edge || edge.expansion === 'collapsed') continue;
        if (edge.load.state === 'loaded') {
          visitWorkflow(edge.load.node, owners);
          if (edge.load.truncation) {
            appendState({ edge, node, run, runKey, ancestorRunKeys: owners });
          }
        } else if (edge.load.state !== 'idle') {
          appendState({ edge, node, run, runKey, ancestorRunKeys: owners });
        }
      }

      if (runPendingCount > 0 && !gapInserted) {
        pendingGap = {
          insertionIndex: rows.length,
          rowStart: rowIndex,
          rowCount: runPendingCount,
        };
        rowIndex += runPendingCount;
      }
      if (!appended && runPendingCount === 0) {
        rows.push({
          kind: 'empty-run',
          key: `${node.key}:empty-run:${run.runId}`,
          runId: run.runId,
          workflowKey: node.key,
          runKey,
          depth: node.depth,
          ancestorRunKeys,
          rowIndex,
        });
        rowIndex += 1;
      }
      runSpans.push({
        key: runKey,
        workflowKey: node.key,
        runId: run.runId,
        depth: node.depth,
        ancestorRunKeys,
        rowStart: runStart,
        rowEnd: rowIndex,
      });
    }

    if (participatingRuns.length) {
      workflowSpans.push({
        key: `${node.key}:workflow-span`,
        workflowKey: node.key,
        depth: node.depth,
        ancestorRunKeys,
        rowStart: workflowStart,
        rowEnd: rowIndex,
      });
      if (node.depth > 0) {
        for (const suffix of ['after', 'after-padding']) {
          rows.push({
            kind: 'workflow-spacing',
            key: `${node.key}:workflow-spacing-${suffix}`,
            workflowKey: node.key,
            depth: node.depth,
            ancestorRunKeys,
            rowIndex,
          });
          rowIndex += 1;
        }
      }
    }
  };

  visitWorkflow(root, []);
  return {
    rows,
    runSpans,
    workflowSpans,
    chainSpan:
      workflowSpans.find((span) => span.workflowKey === root.key) ?? null,
    pendingGap,
    totalRowCount: rowIndex,
  };
}
