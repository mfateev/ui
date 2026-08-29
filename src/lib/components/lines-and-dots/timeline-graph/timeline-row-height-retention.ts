export const TIMELINE_ROW_HEIGHT_GRACE_MS = 1_000;

export class TimelineRowHeightRetention {
  #retainedRowCount = 0;
  #lastPeakSeenAtMs = 0;

  update({
    visibleRowCount,
    nowMs,
    retain,
    retentionDurationMs,
  }: {
    visibleRowCount: number;
    nowMs: number;
    retain: boolean;
    retentionDurationMs: number;
  }): number {
    const rowCount = Math.max(0, visibleRowCount);

    if (!retain) {
      this.#retainedRowCount = rowCount;
      this.#lastPeakSeenAtMs = nowMs;
      return rowCount;
    }

    if (rowCount >= this.#retainedRowCount) {
      this.#retainedRowCount = rowCount;
      this.#lastPeakSeenAtMs = nowMs;
    } else if (nowMs - this.#lastPeakSeenAtMs >= retentionDurationMs) {
      this.#retainedRowCount = rowCount;
      this.#lastPeakSeenAtMs = nowMs;
    }

    return this.#retainedRowCount;
  }
}
