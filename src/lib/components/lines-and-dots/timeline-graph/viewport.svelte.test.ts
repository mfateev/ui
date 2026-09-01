import { describe, expect, it } from 'vitest';

import { Viewport } from './viewport.svelte';

describe('Viewport', () => {
  it('starts short timelines at offset zero', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 600,
    });

    expect(viewport.offsetPx).toBe(0);
    expect(viewport.visibleRange).toEqual({ startPx: 0, endPx: 1_000 });
  });

  it('follows the right edge of long timelines', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 2_500,
    });

    expect(viewport.offsetPx).toBe(1_500);
    expect(viewport.visibleRange).toEqual({
      startPx: 1_500,
      endPx: 2_500,
    });
  });

  it('moves with the right edge while following', () => {
    const viewport = new Viewport({
      widthPx: 800,
      totalWorldWidthPx: 1_000,
    });

    viewport.setGeometry({ widthPx: 800, totalWorldWidthPx: 1_300 });

    expect(viewport.offsetPx).toBe(500);
    expect(viewport.isFollowing).toBe(true);
  });

  it('recalculates a followed offset when resized', () => {
    const viewport = new Viewport({
      widthPx: 800,
      totalWorldWidthPx: 1_600,
    });

    viewport.setGeometry({ widthPx: 1_000, totalWorldWidthPx: 1_600 });

    expect(viewport.offsetPx).toBe(600);
    expect(viewport.visibleRange).toEqual({
      startPx: 600,
      endPx: 1_600,
    });
  });

  it('freezes the current offset as the world grows', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 2_000,
    });

    viewport.freeze();
    viewport.setGeometry({ widthPx: 1_000, totalWorldWidthPx: 3_000 });

    expect(viewport.offsetPx).toBe(1_000);
    expect(viewport.isFollowing).toBe(false);
  });

  it('retains the frozen left-edge world anchor when resized', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 3_000,
    });

    viewport.freeze();
    viewport.setGeometry({
      widthPx: 1_200,
      totalWorldWidthPx: 3_000,
      anchoredOffsetPx: 1_800,
    });

    expect(viewport.offsetPx).toBe(1_800);
    expect(viewport.visibleRange).toEqual({
      startPx: 1_800,
      endPx: 3_000,
    });
  });

  it('retains an interior frozen anchor exactly when resized', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 3_000,
      offsetPx: 900,
      following: false,
    });

    viewport.setGeometry({
      widthPx: 1_200,
      totalWorldWidthPx: 3_000,
      anchoredOffsetPx: 900,
    });

    expect(viewport.offsetPx).toBe(900);
  });

  it('clamps a frozen offset when the available world becomes shorter', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 3_000,
    });

    viewport.freeze();
    viewport.setGeometry({ widthPx: 1_000, totalWorldWidthPx: 1_400 });

    expect(viewport.offsetPx).toBe(400);
  });

  it('resumes following at the latest right edge', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 2_000,
    });

    viewport.freeze();
    viewport.setGeometry({ widthPx: 1_000, totalWorldWidthPx: 3_000 });
    viewport.resume(3_000);

    expect(viewport.offsetPx).toBe(2_000);
    expect(viewport.isFollowing).toBe(true);
  });

  it('scrolls a frozen viewport backward and forward within its bounds', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 3_000,
    });

    viewport.scrollBy(-400);

    expect(viewport.offsetPx).toBe(1_600);
    expect(viewport.isFollowing).toBe(false);

    viewport.scrollBy(250);
    expect(viewport.offsetPx).toBe(1_850);

    viewport.scrollBy(1_000);
    expect(viewport.offsetPx).toBe(2_000);
  });

  it('moves directly to an offset and clamps it within the world', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 3_000,
    });

    viewport.moveTo(500);
    expect(viewport.offsetPx).toBe(500);
    expect(viewport.isFollowing).toBe(false);

    viewport.moveTo(-100);
    expect(viewport.offsetPx).toBe(0);

    viewport.moveTo(3_000);
    expect(viewport.offsetPx).toBe(2_000);
  });

  it('scrolls to a negative leading-space boundary', () => {
    const viewport = new Viewport({ widthPx: 1_000 });
    viewport.setGeometry({
      widthPx: 1_000,
      totalWorldWidthPx: 600,
      allowLeadingSpace: true,
    });

    expect(viewport.minimumOffsetPx).toBe(-400);
    expect(viewport.maximumOffsetPx).toBe(-400);

    viewport.scrollBy(-100);
    expect(viewport.offsetPx).toBe(-400);
  });

  it('atomically applies recalculated scale geometry to a frozen viewport', () => {
    const viewport = new Viewport({
      widthPx: 1_000,
      totalWorldWidthPx: 2_000,
    });

    viewport.freeze();
    viewport.setGeometry({
      widthPx: 1_500,
      totalWorldWidthPx: 4_000,
      anchoredOffsetPx: 2_000,
    });

    expect(viewport.widthPx).toBe(1_500);
    expect(viewport.totalWorldWidthPx).toBe(4_000);
    expect(viewport.offsetPx).toBe(2_000);
    expect(viewport.visibleRange).toEqual({
      startPx: 2_000,
      endPx: 3_500,
    });
  });

  it('clamps an atomic frozen offset to the visible world', () => {
    const viewport = new Viewport({
      widthPx: 500,
      totalWorldWidthPx: 2_000,
      offsetPx: 600,
      following: false,
    });

    viewport.setGeometry({
      widthPx: 1_000,
      totalWorldWidthPx: 1_200,
      anchoredOffsetPx: 900,
    });

    expect(viewport.offsetPx).toBe(200);
  });

  it('clamps negative dimensions and offsets to zero', () => {
    const viewport = new Viewport({
      widthPx: -100,
      totalWorldWidthPx: -200,
      offsetPx: -300,
      following: false,
    });

    expect(viewport.widthPx).toBe(0);
    expect(viewport.totalWorldWidthPx).toBe(0);
    expect(viewport.offsetPx).toBe(0);
    expect(viewport.visibleRange).toEqual({ startPx: 0, endPx: 0 });
  });
});
