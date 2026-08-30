import { describe, expect, it } from 'vitest';

import {
  getWorkflowChainVerticalBounds,
  getWorkflowFrameGeometry,
  getWorkflowFrameVerticalBounds,
} from './workflow-frame-geometry';

const geometry = (
  overrides: Partial<Parameters<typeof getWorkflowFrameGeometry>[0]> = {},
) =>
  getWorkflowFrameGeometry({
    startWorldPx: 0,
    endWorldPx: 75,
    viewportOffsetPx: 0,
    viewportWidthPx: 100,
    gutterPx: 20,
    topPx: 30,
    bottomPx: 90,
    startBoundaryKnown: true,
    endBoundaryKnown: true,
    labelInsetPx: 8,
    ...overrides,
  });

describe('getWorkflowFrameGeometry', () => {
  it('clips horizontally without inventing a start boundary', () => {
    expect(
      geometry({
        startWorldPx: 0,
        endWorldPx: 250,
        viewportOffsetPx: 150,
      }),
    ).toMatchObject({
      horizontal: { startPx: 20, endPx: 120 },
      drawStartSide: false,
      drawEndSide: true,
      startDotPx: null,
      endDotPx: 120,
    });
  });

  it('suppresses a visible boundary when it is not known', () => {
    expect(geometry({ startBoundaryKnown: false })).toMatchObject({
      drawStartSide: false,
      startDotPx: null,
    });
  });

  it('uses actual vertical coordinates and enforces a one-row minimum', () => {
    expect(geometry({ topPx: 120, bottomPx: 120 })).toMatchObject({
      topPx: 120,
      bottomPx: 144,
    });
    expect(geometry({ topPx: 40, bottomPx: 143 })).toMatchObject({
      topPx: 40,
      bottomPx: 143,
    });
  });

  it('returns the usable label width of the clipped fragment', () => {
    expect(geometry()).toMatchObject({
      labelStartPx: 28,
      labelMaxWidthPx: 59,
    });
  });

  it('renders one boundary dot when both boundaries project to one pixel', () => {
    expect(geometry({ startWorldPx: 25, endWorldPx: 25 })).toMatchObject({
      startDotPx: 45,
      endDotPx: null,
    });
  });

  it('returns no paint for a frame outside the viewport', () => {
    expect(
      geometry({ startWorldPx: 0, endWorldPx: 100, viewportOffsetPx: 150 }),
    ).toMatchObject({
      horizontal: null,
      drawStartSide: false,
      drawEndSide: false,
      labelMaxWidthPx: 0,
    });
  });
});

describe('getWorkflowFrameVerticalBounds', () => {
  it('pads the frame away from its first and last content rows', () => {
    expect(
      getWorkflowFrameVerticalBounds({
        rowStart: 0,
        rowEnd: 1,
        activeRowIndex: -1,
        panelHeight: 0,
        paddingPx: 9,
      }),
    ).toEqual({ topPx: 27, bottomPx: 69 });
  });

  it('keeps padding outside an expanded details panel', () => {
    expect(
      getWorkflowFrameVerticalBounds({
        rowStart: 0,
        rowEnd: 2,
        activeRowIndex: 0,
        panelHeight: 100,
        paddingPx: 9,
      }),
    ).toEqual({ topPx: 27, bottomPx: 193 });
  });
});

describe('getWorkflowChainVerticalBounds', () => {
  it.each([
    { depth: 0, expectedPaddingPx: 33 },
    { depth: 1, expectedPaddingPx: 27 },
    { depth: 4, expectedPaddingPx: 9 },
  ])(
    'uses equal top and bottom internal padding at depth $depth',
    ({ depth, expectedPaddingPx }) => {
      const workflow = getWorkflowChainVerticalBounds({
        topPx: 100,
        bottomPx: 500,
        depth,
      });

      expect(133 - workflow.topPx).toBe(expectedPaddingPx);
      expect(workflow.bottomPx - 500).toBe(expectedPaddingPx);
    },
  );
});
