import type { Timespan } from './timespan';

export type TimeSegmentKey = string;

export type TimelineDisplayMode = 'full-duration' | 'fixed-window';

export interface TimeSegment {
  kind: 'active' | 'inactive';
  timespan: Timespan;
}
