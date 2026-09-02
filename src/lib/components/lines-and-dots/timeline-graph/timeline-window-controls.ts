export type TimelineWindowMode = 'following' | 'paused' | 'playing';
export type TimelineWindowResizeAnchor = 'start' | 'end';

export const TIMELINE_WINDOW_DURATIONS_MS = [
  1_000,
  5_000,
  15_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export function getTimelineWindowZoomDuration(
  durationMs: number,
  direction: 'in' | 'out',
): number {
  if (direction === 'in') {
    return (
      [...TIMELINE_WINDOW_DURATIONS_MS]
        .reverse()
        .find((duration) => duration < durationMs) ??
      TIMELINE_WINDOW_DURATIONS_MS[0]
    );
  }

  return (
    TIMELINE_WINDOW_DURATIONS_MS.find((duration) => duration > durationMs) ??
    TIMELINE_WINDOW_DURATIONS_MS.at(-1)!
  );
}

export function clampTimelineWindowDuration(durationMs: number): number {
  return Math.min(
    Math.max(durationMs, TIMELINE_WINDOW_DURATIONS_MS[0]),
    TIMELINE_WINDOW_DURATIONS_MS.at(-1)!,
  );
}

export function getTimelineWindowModeAfterManualPosition(
  mode: TimelineWindowMode,
): TimelineWindowMode {
  return mode === 'paused' ? 'paused' : 'playing';
}

export function formatTimelineWindowDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function getTimelineWindowTimeRange({
  following,
  frozenAnchorTimeMs,
  durationMs,
  followingEndTimeMs,
}: {
  following: boolean;
  frozenAnchorTimeMs: number | null;
  durationMs: number;
  followingEndTimeMs: number;
}): { startTimeMs: number; endTimeMs: number } {
  if (!following && frozenAnchorTimeMs !== null) {
    return {
      startTimeMs: frozenAnchorTimeMs,
      endTimeMs: frozenAnchorTimeMs + durationMs,
    };
  }

  return {
    startTimeMs: followingEndTimeMs - durationMs,
    endTimeMs: followingEndTimeMs,
  };
}

export function timelineWindowIsAtEnd(
  windowEndTimeMs: number,
  availableEndTimeMs: number,
  toleranceMs = 0.5,
): boolean {
  return windowEndTimeMs >= availableEndTimeMs - toleranceMs;
}

export interface TimelineWindowControls {
  mode: TimelineWindowMode;
  atBeginning: boolean;
  atCurrent: boolean;
  atFullDuration: boolean;
  windowStartTimeMs: number;
  windowEndTimeMs: number;
  windowDurationMs: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  pause: () => void;
  resume: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToFullDuration: () => void;
  resize: (
    startTimeMs: number,
    endTimeMs: number,
    anchor: TimelineWindowResizeAnchor,
  ) => void;
  jumpToBeginning: () => void;
  jumpToCurrent: () => void;
  moveToTime: (startTimeMs: number) => void;
}
