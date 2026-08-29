interface TimelineMotionFrame {
  nowMs: number;
  committedOffsetPx: number;
  expandedPxPerMs: number;
  animate: boolean;
  freeze: boolean;
}

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
