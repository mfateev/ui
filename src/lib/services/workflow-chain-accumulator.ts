import type { WorkflowChainOverviewRun } from './workflow-chain-overview';

export class WorkflowChainOverviewAccumulator {
  readonly runs: WorkflowChainOverviewRun[];
  private readonly indexByRunId: Map<string, number>;

  constructor(initial: WorkflowChainOverviewRun[] = []) {
    this.runs = [...initial];
    this.indexByRunId = new Map(
      this.runs.map((run, index) => [run.runId, index]),
    );
  }

  upsert(update: WorkflowChainOverviewRun): 'append' | 'replace' {
    const index = this.indexByRunId.get(update.runId);
    if (index === undefined) {
      this.indexByRunId.set(update.runId, this.runs.length);
      this.runs.push(update);
      return 'append';
    }

    const existing = this.runs[index];
    this.runs[index] = {
      ...existing,
      ...update,
      nextRunId: update.nextRunId ?? existing.nextRunId,
      transitionToNext: update.transitionToNext ?? existing.transitionToNext,
    };
    return 'replace';
  }

  indexOf(runId: string): number | undefined {
    return this.indexByRunId.get(runId);
  }

  snapshot(): WorkflowChainOverviewRun[] {
    return [...this.runs];
  }
}
