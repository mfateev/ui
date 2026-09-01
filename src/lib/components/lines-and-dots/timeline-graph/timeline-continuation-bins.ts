import type { WorkflowChainOverviewRun } from '$lib/services/workflow-chain-overview';

export type TimelineContinuationBins = {
  path: string;
  totalCount: number;
  binCount: number;
};

export const binTimelineContinuations = ({
  runs,
  startTimeMs,
  durationMs,
  widthPx,
}: {
  runs: readonly WorkflowChainOverviewRun[];
  startTimeMs: number;
  durationMs: number;
  widthPx: number;
}): TimelineContinuationBins => {
  const width = Math.max(1, Math.floor(widthPx));
  const bins = new Uint8Array(width);
  let totalCount = 0;
  let binCount = 0;
  for (const run of runs) {
    if (run.transitionToNext !== 'continue-as-new') continue;
    totalCount += 1;
    const ratio = (run.endTimeMs - startTimeMs) / Math.max(1, durationMs);
    const bin = Math.min(width - 1, Math.max(0, Math.floor(ratio * width)));
    if (bins[bin]) continue;
    bins[bin] = 1;
    binCount += 1;
  }

  let path = '';
  for (let bin = 0; bin < bins.length; bin += 1) {
    if (bins[bin]) path += `M${bin + 0.5} 0V20`;
  }
  return { path, totalCount, binCount };
};
