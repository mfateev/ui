import { describe, expect, it } from 'vitest';

import {
  getTimelineFrameBoundaryOffset,
  getTimelineRowEntryOffsets,
  MAX_ANIMATED_TIMELINE_GROUPS,
  shouldAnimateTimelineRowEntries,
} from './timeline-row-entry-motion';

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
  it('slides a batch in from above while preserving existing row positions', () => {
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
        ['new-2', -48],
        ['new-1', -48],
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
        ['new-2', -48],
        ['new-1', -48],
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
        ['new-2', -36],
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
    ).toEqual(new Map([['replacement', 0]]));
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
