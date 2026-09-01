export type TimelineWindowMode = 'following' | 'paused' | 'playing';

export interface TimelineWindowControls {
  mode: TimelineWindowMode;
  atBeginning: boolean;
  atCurrent: boolean;
  windowStartTimeMs: number;
  windowEndTimeMs: number;
  windowDurationMs: number;
  pause: () => void;
  resume: () => void;
  jumpToBeginning: () => void;
  jumpToCurrent: () => void;
  moveToTime: (startTimeMs: number) => void;
}
