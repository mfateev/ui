import { describe, expect, it } from 'vitest';

import {
  clipConnectorToViewport,
  intersectPixelRanges,
  worldToScreen,
} from './viewport-geometry';

describe('worldToScreen', () => {
  it('projects world coordinates relative to the viewport offset', () => {
    expect(worldToScreen(260, 200)).toBe(60);
  });

  it('returns negative coordinates for points left of the viewport', () => {
    expect(worldToScreen(150, 200)).toBe(-50);
  });

  it('preserves fractional pixel precision', () => {
    expect(worldToScreen(250.75, 100.25)).toBe(150.5);
  });
});

describe('intersectPixelRanges', () => {
  const visibleRange = { startPx: 100, endPx: 300 };

  it('returns a fully visible range unchanged', () => {
    expect(
      intersectPixelRanges({ startPx: 150, endPx: 250 }, visibleRange),
    ).toEqual({ startPx: 150, endPx: 250 });
  });

  it('clips a range entering from the left', () => {
    expect(
      intersectPixelRanges({ startPx: 50, endPx: 150 }, visibleRange),
    ).toEqual({ startPx: 100, endPx: 150 });
  });

  it('clips a range leaving through the right', () => {
    expect(
      intersectPixelRanges({ startPx: 250, endPx: 350 }, visibleRange),
    ).toEqual({ startPx: 250, endPx: 300 });
  });

  it('clips a range spanning both viewport boundaries', () => {
    expect(
      intersectPixelRanges({ startPx: 50, endPx: 350 }, visibleRange),
    ).toEqual(visibleRange);
  });

  it('returns null for ranges fully outside either side', () => {
    expect(
      intersectPixelRanges({ startPx: 25, endPx: 75 }, visibleRange),
    ).toBeNull();
    expect(
      intersectPixelRanges({ startPx: 325, endPx: 375 }, visibleRange),
    ).toBeNull();
  });

  it('retains zero-width intersections at viewport edges', () => {
    expect(
      intersectPixelRanges({ startPx: 50, endPx: 100 }, visibleRange),
    ).toEqual({ startPx: 100, endPx: 100 });
    expect(
      intersectPixelRanges({ startPx: 300, endPx: 350 }, visibleRange),
    ).toEqual({ startPx: 300, endPx: 300 });
  });

  it('retains a visible point range', () => {
    expect(
      intersectPixelRanges({ startPx: 175, endPx: 175 }, visibleRange),
    ).toEqual({ startPx: 175, endPx: 175 });
  });
});

describe('clipConnectorToViewport', () => {
  const viewport = { offsetPx: 100, widthPx: 200 };

  it('returns null when the connector is fully outside the viewport', () => {
    expect(
      clipConnectorToViewport({ startPx: 25, endPx: 75 }, viewport),
    ).toBeNull();
    expect(
      clipConnectorToViewport({ startPx: 325, endPx: 375 }, viewport),
    ).toBeNull();
  });

  it('projects a fully visible connector into screen coordinates', () => {
    expect(
      clipConnectorToViewport({ startPx: 150, endPx: 250 }, viewport),
    ).toEqual({ startPx: 50, endPx: 150 });
  });

  it('clips a connector entering through the left edge', () => {
    expect(
      clipConnectorToViewport({ startPx: 50, endPx: 150 }, viewport),
    ).toEqual({ startPx: 0, endPx: 50 });
  });

  it('clips a connector leaving through the right edge', () => {
    expect(
      clipConnectorToViewport({ startPx: 250, endPx: 350 }, viewport),
    ).toEqual({ startPx: 150, endPx: 200 });
  });

  it('clips a connector spanning both edges to the viewport width', () => {
    expect(
      clipConnectorToViewport({ startPx: 50, endPx: 350 }, viewport),
    ).toEqual({ startPx: 0, endPx: 200 });
  });

  it('retains connectors touching an edge as zero-width geometry', () => {
    expect(
      clipConnectorToViewport({ startPx: 50, endPx: 100 }, viewport),
    ).toEqual({ startPx: 0, endPx: 0 });
    expect(
      clipConnectorToViewport({ startPx: 300, endPx: 350 }, viewport),
    ).toEqual({ startPx: 200, endPx: 200 });
  });
});
