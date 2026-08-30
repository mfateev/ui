import { describe, expect, it } from 'vitest';

import { getTimelineRowEntryOffsets } from './timeline-row-entry-motion';

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
