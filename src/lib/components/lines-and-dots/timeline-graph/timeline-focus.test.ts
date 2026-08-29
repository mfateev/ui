import { describe, expect, it } from 'vitest';

import { shouldMoveFocusToTimeline } from './timeline-focus';

describe('shouldMoveFocusToTimeline', () => {
  it('moves focus when the focused group leaves the window', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusWithinTimeline: true,
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
        focusWithinTimeline: true,
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
        focusWithinTimeline: true,
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
        focusWithinTimeline: true,
        focusedGroupId: null,
        focusedSlotIndex: null,
        visibleGroupIds: new Set(),
        slotGroupIds: [],
      }),
    ).toBe(false);
  });

  it('does not steal focus after focus has left the timeline', () => {
    expect(
      shouldMoveFocusToTimeline({
        focusWithinTimeline: false,
        focusedGroupId: 'stale-group',
        focusedSlotIndex: 0,
        visibleGroupIds: new Set(['replacement-group']),
        slotGroupIds: ['replacement-group'],
      }),
    ).toBe(false);
  });
});
