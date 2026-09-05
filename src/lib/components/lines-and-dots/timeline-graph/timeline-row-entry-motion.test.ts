import { describe, expect, it } from 'vitest';

import {
  getTimelineEntryAnimationStartTranslate,
  getTimelineFrameBoundaryOffset,
  getTimelineHorizontalEntryOffset,
  getTimelineRowEntryOffsets,
  MAX_ANIMATED_TIMELINE_GROUPS,
  shouldAnimateTimelineRowEntries,
} from './timeline-row-entry-motion';

describe('getTimelineEntryAnimationStartTranslate', () => {
  it('removes a stale horizontal offset from an interrupted row animation', () => {
    expect(
      getTimelineEntryAnimationStartTranslate({
        computedTranslate: '2410.1px -24px',
        frame: false,
      }),
    ).toBe('0px -24px');
  });

  it('preserves the current vertical row position', () => {
    expect(
      getTimelineEntryAnimationStartTranslate({
        computedTranslate: '0px -48px',
        frame: false,
      }),
    ).toBe('0px -48px');
  });

  it('preserves both axes for a frame entering from the right rail', () => {
    expect(
      getTimelineEntryAnimationStartTranslate({
        computedTranslate: '1400px -24px',
        frame: true,
      }),
    ).toBe('1400px -24px');
  });

  it('does not animate an element without a translate', () => {
    expect(
      getTimelineEntryAnimationStartTranslate({
        computedTranslate: 'none',
        frame: false,
      }),
    ).toBeUndefined();
  });
});

describe('getTimelineHorizontalEntryOffset', () => {
  it('slides a new live entry inward from the right rail', () => {
    expect(
      getTimelineHorizontalEntryOffset({
        isNew: true,
        active: true,
        entryStartPx: 100,
        rightRailPx: 1_500,
      }),
    ).toBe(1_400);
  });

  it('renders historical backfill in place even when its key is newly loaded', () => {
    expect(
      getTimelineHorizontalEntryOffset({
        isNew: true,
        active: false,
        entryStartPx: 100,
        rightRailPx: 1_500,
      }),
    ).toBe(0);
  });

  it('does not move an existing live entry', () => {
    expect(
      getTimelineHorizontalEntryOffset({
        isNew: false,
        active: true,
        entryStartPx: 100,
        rightRailPx: 1_500,
      }),
    ).toBe(0);
  });
});

describe('shouldAnimateTimelineRowEntries', () => {
  it('keeps entry motion for bounded histories and layouts', () => {
    expect(
      shouldAnimateTimelineRowEntries({
        totalGroupCount: MAX_ANIMATED_TIMELINE_GROUPS,
        layoutRowCount: MAX_ANIMATED_TIMELINE_GROUPS,
      }),
    ).toBe(true);
  });

  it('disables entry motion when the history or visible layout is large', () => {
    expect(
      shouldAnimateTimelineRowEntries({
        totalGroupCount: MAX_ANIMATED_TIMELINE_GROUPS + 1,
        layoutRowCount: 20,
      }),
    ).toBe(false);
    expect(
      shouldAnimateTimelineRowEntries({
        totalGroupCount: 20,
        layoutRowCount: MAX_ANIMATED_TIMELINE_GROUPS + 1,
      }),
    ).toBe(false);
  });
});

describe('getTimelineRowEntryOffsets', () => {
  it('keeps new rows at their final y while preserving existing row positions', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['existing-1', 'existing-2'],
        ['new-1', 'new-2', 'existing-1', 'existing-2'],
        24,
      ),
    ).toEqual(
      new Map([
        ['existing-2', -48],
        ['existing-1', -48],
      ]),
    );
  });

  it('does not move rows above a middle insertion', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['above-1', 'above-2', 'below-1', 'below-2'],
        ['above-1', 'above-2', 'new-1', 'new-2', 'below-1', 'below-2'],
        24,
      ),
    ).toEqual(
      new Map([
        ['below-2', -48],
        ['below-1', -48],
      ]),
    );
  });

  it('continues an interrupted entry from its current visual position', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['new-1', 'existing'],
        ['new-1', 'new-2', 'existing'],
        24,
        new Map([
          ['new-1', -12],
          ['existing', -12],
        ]),
      ),
    ).toEqual(
      new Map([
        ['existing', -36],
        ['new-1', -12],
      ]),
    );
  });

  it('holds existing rows in place while an earlier row is removed', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['removed', 'existing-1', 'existing-2'],
        ['existing-1', 'existing-2'],
        24,
      ),
    ).toEqual(
      new Map([
        ['existing-2', 24],
        ['existing-1', 24],
      ]),
    );
  });

  it('does not move rows when one row is replaced in the same position', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['replaced', 'existing'],
        ['replacement', 'existing'],
        24,
      ),
    ).toEqual(new Map());
  });

  it('expands replacement rows downward from the row they replace', () => {
    expect(
      getTimelineRowEntryOffsets(
        ['above', 'relationship', 'below'],
        ['above', 'spacing', 'header', 'child-row', 'below'],
        24,
      ),
    ).toEqual(new Map([['below', -48]]));
  });
});

describe('getTimelineFrameBoundaryOffset', () => {
  it('holds a growing frame bottom with the rows while its header stays fixed', () => {
    expect(
      getTimelineFrameBoundaryOffset({
        offsets: new Map([
          ['header', 0],
          ['last-row', -24],
        ]),
        topKey: 'header',
        bottomKey: 'last-row',
      }),
    ).toBe(-24);
  });

  it('subtracts frame translation so nested boundary motion stays absolute', () => {
    expect(
      getTimelineFrameBoundaryOffset({
        offsets: new Map([
          ['header', -48],
          ['last-row', -72],
        ]),
        topKey: 'header',
        bottomKey: 'last-row',
      }),
    ).toBe(-24);
  });
});
