interface ViewportGeometry {
  widthPx: number;
  totalWorldWidthPx: number;
  anchoredOffsetPx?: number;
  allowLeadingSpace?: boolean;
}

interface ViewportInit {
  widthPx?: number;
  totalWorldWidthPx?: number;
  offsetPx?: number;
  following?: boolean;
}

const nonNegative = (value: number): number => Math.max(0, value);

export class Viewport {
  widthPx = $state(0);
  offsetPx = $state(0);

  private _totalWorldWidthPx = $state(0);
  private _isFollowing = $state(true);
  private _allowLeadingSpace = false;

  readonly visibleRange = $derived({
    startPx: this.offsetPx,
    endPx: this.offsetPx + this.widthPx,
  });

  constructor(init: ViewportInit = {}) {
    this.widthPx = nonNegative(init.widthPx ?? 0);
    this._totalWorldWidthPx = nonNegative(init.totalWorldWidthPx ?? 0);
    this._isFollowing = init.following ?? true;
    this.offsetPx = this._isFollowing
      ? this._rightEdgeOffset()
      : this._clampOffset(init.offsetPx ?? 0);
  }

  get totalWorldWidthPx(): number {
    return this._totalWorldWidthPx;
  }

  get isFollowing(): boolean {
    return this._isFollowing;
  }

  get minimumOffsetPx(): number {
    const rightEdgeOffset = this._rightEdgeOffset();
    return this._allowLeadingSpace ? Math.min(0, rightEdgeOffset) : 0;
  }

  get maximumOffsetPx(): number {
    return this._rightEdgeOffset();
  }

  setGeometry({
    widthPx,
    totalWorldWidthPx,
    anchoredOffsetPx,
    allowLeadingSpace,
  }: ViewportGeometry): void {
    this.widthPx = nonNegative(widthPx);
    this._totalWorldWidthPx = nonNegative(totalWorldWidthPx);
    this._allowLeadingSpace = allowLeadingSpace ?? this._allowLeadingSpace;
    this.offsetPx = this._isFollowing
      ? this._rightEdgeOffset()
      : this._clampOffset(anchoredOffsetPx ?? this.offsetPx);
  }

  resume(
    totalWorldWidthPx = this._totalWorldWidthPx,
    allowLeadingSpace = this._allowLeadingSpace,
  ): void {
    this._totalWorldWidthPx = nonNegative(totalWorldWidthPx);
    this._allowLeadingSpace = allowLeadingSpace;
    this._isFollowing = true;
    this.offsetPx = this._rightEdgeOffset();
  }

  freeze(): void {
    this._isFollowing = false;
  }

  scrollBy(deltaPx: number): void {
    this.freeze();
    this.offsetPx = this._clampOffset(this.offsetPx + deltaPx);
  }

  moveTo(offsetPx: number): void {
    this.freeze();
    this.offsetPx = this._clampOffset(offsetPx);
  }

  private _rightEdgeOffset(): number {
    const offset = this._totalWorldWidthPx - this.widthPx;
    return this._allowLeadingSpace ? offset : Math.max(0, offset);
  }

  private _clampOffset(offsetPx: number): number {
    return Math.min(
      Math.max(this.minimumOffsetPx, offsetPx),
      this.maximumOffsetPx,
    );
  }
}
