import { describe, expect, it } from 'vitest';

import type { EventGroup } from '$lib/models/event-groups/event-groups';

import { buildTimeSegments } from './build-time-segments';
import { Timespan } from './timespan';

const T0 = Date.UTC(2022, 0, 1);

const pendingGroup = {
  initialEvent: { eventTime: new Date(T0 + 10).toISOString() },
  lastEvent: { eventTime: new Date(T0 + 20).toISOString() },
  isPending: true,
} as unknown as EventGroup;

describe('buildTimeSegments', () => {
  it('uses a retained run boundary instead of extending pending work to now', () => {
    const segments = buildTimeSegments({
      workflowTimespan: new Timespan(T0, T0 + 100),
      eventGroups: [pendingGroup],
      getEventGroupEndMs: () => T0 + 40,
    });

    expect(
      segments.map(({ kind, timespan }) => [kind, timespan.endTimeMs - T0]),
    ).toEqual([
      ['inactive', 10],
      ['active', 40],
      ['inactive', 100],
    ]);
  });
});
