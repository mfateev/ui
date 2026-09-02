export type TimelinePerformanceSample = {
  logicalRows: number;
  mountedRows: number;
  renderedLines: number;
  renderedElements: number;
  updateMs: number;
};

export type TimelinePerformanceStats = TimelinePerformanceSample & {
  maximumUpdateMs: number;
  p95UpdateMs: number;
  sampleCount: number;
  sequence: number;
};

const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * quantile)] ?? 0;
};

export class TimelinePerformanceTracker {
  readonly #maximumSamples: number;
  readonly #samplesByDensity = new Map<string, number[]>();
  #sequence = 0;

  constructor(maximumSamples = 120) {
    this.#maximumSamples = Math.max(1, maximumSamples);
  }

  record(sample: TimelinePerformanceSample): TimelinePerformanceStats {
    const densityKey = `${sample.logicalRows}:${sample.mountedRows}:${sample.renderedLines}`;
    const samples = this.#samplesByDensity.get(densityKey) ?? [];
    samples.push(sample.updateMs);
    if (samples.length > this.#maximumSamples) samples.shift();
    this.#samplesByDensity.set(densityKey, samples);

    return {
      ...sample,
      maximumUpdateMs: Math.max(...samples),
      p95UpdateMs: percentile(samples, 0.95),
      sampleCount: samples.length,
      sequence: ++this.#sequence,
    };
  }
}
