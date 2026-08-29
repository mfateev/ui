import { describe, expect, it } from 'vitest';

import { TimelineMotion } from './timeline-motion';

const frame = (
  motion: TimelineMotion,
  overrides: Partial<Parameters<TimelineMotion['nextFrame']>[0]> = {},
) =>
  motion.nextFrame({
    nowMs: 1_000,
    committedOffsetPx: 100,
    expandedPxPerMs: 0.01,
    animate: true,
    freeze: false,
    ...overrides,
  });

describe('TimelineMotion', () => {
  it('advances a compositor offset smoothly between committed ticks', () => {
    const motion = new TimelineMotion();

    expect(frame(motion)).toBe(0);
    expect(frame(motion, { nowMs: 1_250 })).toBe(2.5);
    expect(frame(motion, { nowMs: 1_500 })).toBe(5);
  });

  it('rebases when the coarse viewport offset advances', () => {
    const motion = new TimelineMotion();
    frame(motion);
    frame(motion, { nowMs: 1_500 });

    expect(frame(motion, { nowMs: 1_500, committedOffsetPx: 105 })).toBe(0);
    expect(frame(motion, { nowMs: 1_750, committedOffsetPx: 105 })).toBe(2.5);
  });

  it('preserves the effective visual offset across an uneven coarse update', () => {
    const motion = new TimelineMotion();
    frame(motion);
    expect(frame(motion, { nowMs: 1_500 })).toBe(5);

    const rebased = frame(motion, {
      nowMs: 1_500,
      committedOffsetPx: 108,
    });
    expect(rebased).toBe(-3);
    expect(108 + rebased).toBe(105);
    expect(frame(motion, { nowMs: 1_750, committedOffsetPx: 108 })).toBe(-0.5);
  });

  it('holds the current frame offset while paused', () => {
    const motion = new TimelineMotion();
    frame(motion);
    expect(frame(motion, { nowMs: 1_500 })).toBe(5);

    expect(frame(motion, { nowMs: 2_000, animate: false, freeze: true })).toBe(
      5,
    );
  });

  it('clears motion for completed and full-duration timelines', () => {
    const motion = new TimelineMotion();
    frame(motion);
    frame(motion, { nowMs: 1_500 });

    expect(frame(motion, { nowMs: 1_500, animate: false })).toBe(0);
  });
});
