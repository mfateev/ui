import { describe, expect, it } from 'vitest';

import { getWorkflowRowGeometry } from './workflow-row-geometry';

describe('getWorkflowRowGeometry', () => {
  it('renders only the real start marker for a running workflow', () => {
    expect(
      getWorkflowRowGeometry({
        startWorldPx: 0,
        endWorldPx: 40,
        viewportOffsetPx: 0,
        viewportWidthPx: 100,
        gutterPx: 20,
        live: true,
      }),
    ).toEqual({
      line: { startPx: 20, endPx: 60 },
      startDotPx: 20,
      endDotPx: null,
    });
  });

  it('renders a short completed workflow deterministically', () => {
    expect(
      getWorkflowRowGeometry({
        startWorldPx: 0,
        endWorldPx: 75,
        viewportOffsetPx: 0,
        viewportWidthPx: 100,
        gutterPx: 20,
      }),
    ).toEqual({
      line: { startPx: 20, endPx: 95 },
      startDotPx: 20,
      endDotPx: 95,
    });
  });

  it('clips a long completed workflow and retains its final dot', () => {
    expect(
      getWorkflowRowGeometry({
        startWorldPx: 0,
        endWorldPx: 250,
        viewportOffsetPx: 150,
        viewportWidthPx: 100,
        gutterPx: 20,
      }),
    ).toEqual({
      line: { startPx: 20, endPx: 120 },
      startDotPx: null,
      endDotPx: 120,
    });
  });

  it('returns no geometry for a workflow outside the visible world interval', () => {
    expect(
      getWorkflowRowGeometry({
        startWorldPx: 0,
        endWorldPx: 100,
        viewportOffsetPx: 150,
        viewportWidthPx: 100,
        gutterPx: 20,
      }),
    ).toEqual({ line: null, startDotPx: null, endDotPx: null });
  });
});
