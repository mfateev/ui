import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';

import { TimelineIntervalIndex } from '../src/lib/components/lines-and-dots/timeline-graph/timeline-interval-index';
import type {
  TimelineGroupSummary,
  TimelineRunModel,
} from '../src/lib/services/timeline-run-model';
import { WorkflowChainOverviewAccumulator } from '../src/lib/services/workflow-chain-accumulator';

const collectGarbage = (globalThis as typeof globalThis & { gc?: () => void })
  .gc;
if (!collectGarbage) {
  throw new Error(
    'timeline-performance.mts requires NODE_OPTIONS=--expose-gc.',
  );
}

const FIXTURE_SEED = 0x5eed_2026;
const WARMUPS = 3;
const ITERATIONS = 10;

const percentile = (values: number[], ratio: number): number => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)
  ];
};

const measure = (
  operation: () => void,
): { medianMs: number; p95Ms: number } => {
  for (let iteration = 0; iteration < WARMUPS; iteration += 1) operation();
  const durations: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const startedAt = performance.now();
    operation();
    durations.push(performance.now() - startedAt);
  }
  return {
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
};

const accumulate = (count: number): void => {
  const accumulator = new WorkflowChainOverviewAccumulator();
  for (let index = 0; index < count; index += 1) {
    accumulator.upsert({
      runId: `run-${index}`,
      status: 'Completed',
      startTimeMs: index,
      endTimeMs: index + 1,
    });
  }
};

const millionGroupModel = (count: number): TimelineRunModel => {
  const groupAt = (ordinal: number): TimelineGroupSummary | undefined => {
    if (ordinal < 0 || ordinal >= count) return undefined;
    const startTimeMs = ordinal * 10;
    return {
      key: `${ordinal}`,
      version: 1,
      initialEventId: ordinal * 2 + 1,
      finalEventId: ordinal * 2 + 2,
      startTimeMs,
      endTimeMs: startTimeMs + (ordinal % 97),
      category: 'activity',
      classification: 'Completed',
      finalClassification: 'Completed',
      eventCount: 2,
      points: [],
      row: {
        displayName: '',
        prefix: '',
        initialEventType: 'ActivityTaskScheduled',
        retryAttempt: 0,
        retried: false,
        scheduling: false,
        timelineCategory: 'activity',
        pendingPaused: false,
      },
      pending: false,
    };
  };
  return {
    run: {
      runId: 'million-groups',
      status: 'Completed',
      startTimeMs: 0,
      endTimeMs: count * 10,
    },
    revision: 1,
    groupCount: count,
    groupAt,
    groups: (start, end) => {
      const result: TimelineGroupSummary[] = [];
      for (let ordinal = start; ordinal < end; ordinal += 1) {
        const group = groupAt(ordinal);
        if (group) result.push(group);
      }
      return result;
    },
    loadDetails: async () => {
      throw new Error('Synthetic models have no details.');
    },
    retain: () => () => undefined,
    dispose: () => undefined,
  };
};

collectGarbage();
const baselineHeapBytes = process.memoryUsage().heapUsed;
const chain1k = measure(() => accumulate(1_000));
const chain10k = measure(() => accumulate(10_000));
const model = millionGroupModel(1_000_000);
const index = new TimelineIntervalIndex(model);
index.ingest();
const intervalQuery = measure(() => {
  const result = index.query(5_000_000, 5_009_990, 5_009_990);
  if (result.ordinals.length > 1_010)
    throw new Error('Fixture returned too many intervals.');
});
collectGarbage();
const indexedHeapBytes = process.memoryUsage().heapUsed;

const cpuInfo = readFileSync('/proc/cpuinfo', 'utf8');
const osCpuModel = cpus()[0]?.model.trim();
const reportedCpuModel = cpuInfo.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim();
const cpuIdentity = [
  cpuInfo.match(/^CPU implementer\s*:\s*(.+)$/m)?.[1]?.trim(),
  cpuInfo.match(/^CPU part\s*:\s*(.+)$/m)?.[1]?.trim(),
].filter(Boolean);
const cpuModel =
  (osCpuModel && osCpuModel !== 'unknown' ? osCpuModel : undefined) ||
  reportedCpuModel ||
  `${process.platform} ${process.arch}${cpuIdentity.length ? ` (${cpuIdentity.join(', ')})` : ''}`;

const report = {
  node: process.version,
  cpu: cpuModel,
  fixtureSeed: FIXTURE_SEED,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  warmups: WARMUPS,
  iterations: ITERATIONS,
  results: {
    chain1k,
    chain10k,
    intervalQuery,
    indexedHeapBytes: indexedHeapBytes - baselineHeapBytes,
  },
};

if (chain10k.medianMs >= 500) {
  throw new Error(
    `10k chain accumulation median was ${chain10k.medianMs.toFixed(1)} ms.`,
  );
}
if (intervalQuery.p95Ms >= 25) {
  throw new Error(
    `1m interval query p95 was ${intervalQuery.p95Ms.toFixed(1)} ms.`,
  );
}

const artifactDirectory = resolve('..', '.agent-artifacts');
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(
  resolve(artifactDirectory, 'timeline-performance.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
