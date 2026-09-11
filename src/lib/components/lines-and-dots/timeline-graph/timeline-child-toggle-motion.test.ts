import { describe, expect, it, vi } from 'vitest';

import {
  getTimelineChildControlPlacement,
  getTimelineChildToggleExitOffset,
  getTimelineChildToggleRowTops,
  isTimelineChildToggleOriginRow,
} from './timeline-child-toggle-motion';

describe('getTimelineChildControlPlacement', () => {
  it('marks controls clamped to either viewport edge as pinned', () => {
    expect(
      getTimelineChildControlPlacement({
        endX: 1080,
        canvasWidth: 1104,
        gutter: 32,
      }),
    ).toEqual({ x: 1052, fitsAfter: false, viewportPinned: true });
    expect(
      getTimelineChildControlPlacement({
        endX: 20,
        canvasWidth: 1104,
        gutter: 32,
      }),
    ).toEqual({ x: 32, fitsAfter: true, viewportPinned: true });
  });

  it('leaves controls anchored inside the viewport on world-layer motion', () => {
    expect(
      getTimelineChildControlPlacement({
        endX: 400,
        canvasWidth: 1104,
        gutter: 32,
      }),
    ).toEqual({ x: 380, fitsAfter: true, viewportPinned: false });
  });

  it('places expanded controls on the inside of the workflow frame', () => {
    expect(
      getTimelineChildControlPlacement({
        endX: 400,
        canvasWidth: 1104,
        gutter: 32,
        insideFrame: true,
      }),
    ).toEqual({ x: 400, fitsAfter: true, viewportPinned: false });
  });
});

const setTop = (element: HTMLElement, top: number) => {
  vi.spyOn(element, 'getClientRects').mockReturnValue([
    {} as DOMRect,
  ] as unknown as DOMRectList);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
  } as DOMRect);
};

describe('getTimelineChildToggleRowTops', () => {
  it('anchors frame motion to its timeline row instead of its full-canvas wrapper', () => {
    const container = document.createElement('div');
    const frame = document.createElement('div');
    frame.dataset.timelineFrameEntry = '';
    frame.dataset.timelineEntryKey = 'child-header';
    setTop(frame, 0);
    container.append(frame);

    const rowStack = document.createElement('ul');
    const row = document.createElement('li');
    row.dataset.timelineKey = 'child-header';
    setTop(row, 144);
    rowStack.append(row);
    container.append(rowStack);

    expect(getTimelineChildToggleRowTops(rowStack, 144)).toEqual(
      new Map([['child-header', 144]]),
    );
  });

  it('limits the snapshot to the rows nearest the toggled control', () => {
    const rowStack = document.createElement('ul');
    for (const [key, top] of [
      ['far', 0],
      ['near', 90],
      ['nearest', 101],
    ] as const) {
      const row = document.createElement('li');
      row.dataset.timelineKey = key;
      setTop(row, top);
      rowStack.append(row);
    }

    expect(getTimelineChildToggleRowTops(rowStack, 100, 2)).toEqual(
      new Map([
        ['nearest', 101],
        ['near', 90],
      ]),
    );
  });
});

describe('getTimelineChildToggleExitOffset', () => {
  it('keeps the collapsed child row fixed while its expansion opens below it', () => {
    expect(
      getTimelineChildToggleExitOffset({
        direction: 'expand',
        kind: 'row',
        top: 108,
        originY: 120,
        rowHeight: 24,
        offsetPx: 640,
      }),
    ).toBe(0);
  });

  it('continues moving other exiting entries with the displaced content', () => {
    expect(
      getTimelineChildToggleExitOffset({
        direction: 'expand',
        kind: 'row',
        top: 300,
        originY: 120,
        rowHeight: 24,
        offsetPx: 640,
      }),
    ).toBe(640);
    expect(
      getTimelineChildToggleExitOffset({
        direction: 'collapse',
        kind: 'frame',
        top: 300,
        originY: 120,
        rowHeight: 24,
        offsetPx: 640,
      }),
    ).toBe(-640);
  });
});

describe('isTimelineChildToggleOriginRow', () => {
  it('only identifies the row centered on the clicked child control', () => {
    expect(
      isTimelineChildToggleOriginRow({
        kind: 'row',
        top: 108,
        originY: 120,
        rowHeight: 24,
      }),
    ).toBe(true);
    expect(
      isTimelineChildToggleOriginRow({
        kind: 'row',
        top: 132,
        originY: 120,
        rowHeight: 24,
      }),
    ).toBe(false);
    expect(
      isTimelineChildToggleOriginRow({
        kind: 'frame',
        top: 108,
        originY: 120,
        rowHeight: 24,
      }),
    ).toBe(false);
  });
});
