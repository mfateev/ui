interface ViewportGeometry {
  widthPx: number;
  totalWorldWidthPx: number;
  offsetPx?: number;
}

interface ViewportInit extends Partial<ViewportGeometry> {
  following?: boolean;
}

const nonNegative = (value: number): number => Math.max(0, value);

export class Viewport {
  widthPx = $state(0);
  offsetPx = $state(0);

  private _totalWorldWidthPx = $state(0);
  private _isFollowing = $state(true);

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

  setWidth(widthPx: number): void {
    this.setGeometry({
      widthPx,
      totalWorldWidthPx: this._totalWorldWidthPx,
    });
  }

  setTotalWorldWidth(totalWorldWidthPx: number): void {
    this.setGeometry({
      widthPx: this.widthPx,
      totalWorldWidthPx,
    });
  }

  setGeometry({
    widthPx,
    totalWorldWidthPx,
    offsetPx,
  }: ViewportGeometry): void {
    this.widthPx = nonNegative(widthPx);
    this._totalWorldWidthPx = nonNegative(totalWorldWidthPx);
    this.offsetPx = this._isFollowing
      ? this._rightEdgeOffset()
      : this._clampOffset(offsetPx ?? this.offsetPx);
  }

  followRightEdge(totalWorldWidthPx = this._totalWorldWidthPx): void {
    this._totalWorldWidthPx = nonNegative(totalWorldWidthPx);
    this._isFollowing = true;
    this.offsetPx = this._rightEdgeOffset();
  }

  freeze(): void {
    this._isFollowing = false;
  }

  resume(totalWorldWidthPx = this._totalWorldWidthPx): void {
    this.followRightEdge(totalWorldWidthPx);
  }

  private _rightEdgeOffset(): number {
    return Math.max(0, this._totalWorldWidthPx - this.widthPx);
  }

  private _clampOffset(offsetPx: number): number {
    return Math.min(nonNegative(offsetPx), this._rightEdgeOffset());
  }
}
