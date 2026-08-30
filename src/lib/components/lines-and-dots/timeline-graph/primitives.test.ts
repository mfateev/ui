import { describe, expect, it } from 'vitest';

import { alignedDotBox } from './primitives';

describe('alignedDotBox', () => {
  it('aligns the first marker left edge to its start time', () => {
    expect(alignedDotBox(100, 20, 'start')).toEqual({ left: 100, top: 10 });
  });

  it('keeps intermediate markers centered on their event time', () => {
    expect(alignedDotBox(100, 20, 'center')).toEqual({ left: 90, top: 10 });
  });

  it('aligns the completion marker right edge to its completion time', () => {
    expect(alignedDotBox(100, 20, 'end')).toEqual({ left: 80, top: 10 });
  });
});
