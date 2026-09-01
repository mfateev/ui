interface TimelineMotionFrame {
  nowMs: number;
  committedOffsetPx: number;
  expandedPxPerMs: number;
  animate: boolean;
  freeze: boolean;
  snapThresholdPx?: number;
}

export const isTimelineCoordinateRebase = ({
  previousOffsetPx,
  nextOffsetPx,
  previousWorldWidthPx,
  nextWorldWidthPx,
  expandedPxPerMs,
  continuityWindowMs = 2_000,
}: {
  previousOffsetPx: number;
  nextOffsetPx: number;
  previousWorldWidthPx: number;
  nextWorldWidthPx: number;
  expandedPxPerMs: number;
  continuityWindowMs?: number;
}): boolean => {
  const continuousChangeLimitPx = Math.max(
    expandedPxPerMs * continuityWindowMs,
    1,
  );
  return (
    Math.abs(nextOffsetPx - previousOffsetPx) > continuousChangeLimitPx ||
    Math.abs(nextWorldWidthPx - previousWorldWidthPx) > continuousChangeLimitPx
  );
};

export class TimelineMotion {
  private _baseTimeMs: number | null = null;
  private _baseOffsetPx = 0;
  private _baseFrameOffsetPx = 0;
  private _frameOffsetPx = 0;

  nextFrame({
    nowMs,
    committedOffsetPx,
    expandedPxPerMs,
    animate,
    freeze,
    snapThresholdPx,
  }: TimelineMotionFrame): number {
    if (freeze) return this._frameOffsetPx;

    if (!animate) {
      this._reset(committedOffsetPx);
      return 0;
    }

    if (this._baseTimeMs === null) {
      this._baseTimeMs = nowMs;
      this._baseOffsetPx = committedOffsetPx;
      this._baseFrameOffsetPx = 0;
      this._frameOffsetPx = 0;
      return 0;
    }

    if (committedOffsetPx !== this._baseOffsetPx) {
      // Ordinary clock commits are small and should preserve visual
      // continuity. A run handoff/backfill can rebase the entire world by
      // thousands of pixels; carrying that delta as a compositor offset leaves
      // the geometry distorted until real time catches up.
      if (
        snapThresholdPx !== undefined &&
        Math.abs(committedOffsetPx - this._baseOffsetPx) > snapThresholdPx
      ) {
        this._baseTimeMs = nowMs;
        this._baseOffsetPx = committedOffsetPx;
        this._baseFrameOffsetPx = 0;
        this._frameOffsetPx = 0;
        return 0;
      }
      const effectiveOffsetPx =
        this._baseOffsetPx +
        this._baseFrameOffsetPx +
        (nowMs - this._baseTimeMs) * expandedPxPerMs;
      this._baseTimeMs = nowMs;
      this._baseOffsetPx = committedOffsetPx;
      this._baseFrameOffsetPx = effectiveOffsetPx - committedOffsetPx;
      this._frameOffsetPx = this._baseFrameOffsetPx;
      return this._frameOffsetPx;
    }

    this._frameOffsetPx =
      this._baseFrameOffsetPx + (nowMs - this._baseTimeMs) * expandedPxPerMs;
    return this._frameOffsetPx;
  }

  reset(committedOffsetPx = 0): void {
    this._reset(committedOffsetPx);
  }

  private _reset(committedOffsetPx: number): void {
    this._baseTimeMs = null;
    this._baseOffsetPx = committedOffsetPx;
    this._baseFrameOffsetPx = 0;
    this._frameOffsetPx = 0;
  }
}
