import { describe, expect, it } from 'vitest';

import { shouldMoveFocusToTimeline } from './timeline-focus';

describe('shouldMoveFocusToTimeline', () => {
  it('moves focus when the focused group leaves the window', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusedGroupId: 'old-group',
        focusedSlotIndex: 0,
        visibleGroupIds: new Set(['new-group']),
        slotGroupIds: ['new-group'],
      }),
    ).toBe(true);
  });

  it('moves focus before a pooled row is repointed', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusedGroupId: 'visible-group',
        focusedSlotIndex: 0,
        visibleGroupIds: new Set(['visible-group', 'replacement-group']),
        slotGroupIds: ['replacement-group'],
      }),
    ).toBe(true);
  });

  it('keeps focus when the slot retains the same group', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusedGroupId: 'visible-group',
        focusedSlotIndex: 1,
        visibleGroupIds: new Set(['visible-group']),
        slotGroupIds: [null, 'visible-group'],
      }),
    ).toBe(false);
  });

  it('does nothing when no pooled row owns focus', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusedGroupId: null,
        focusedSlotIndex: null,
        visibleGroupIds: new Set(),
        slotGroupIds: [],
      }),
    ).toBe(false);
  });
});
