import type {
  GetWorkflowExecutionHistoryResponse,
  HistoryEvent,
} from '$lib/types/events';
import { requestFromAPI } from '$lib/utilities/request-from-api';
import { routeForApi } from '$lib/utilities/route-for-api';

export type BidirectionalProgress = {
  ascEvents: number;
  descEvents: number;
  ascPages: number;
  descPages: number;
  elapsedMs: number;
  ascMaxId: number;
  descMinId: number;
  totalEstimated: number;
};

export type BidirectionalStats = {
  durationMs: number;
  totalEvents: number;
  overlap: number;
  ascPages: number;
  descPages: number;
  eventsPerSecond: number;
  winner: 'ascending' | 'descending' | 'tie';
};

export type PauseHandle = {
  /** Call to unblock the paused cursors and resume fetching the rest. */
  resume: () => void;
};

export type FetchBidirectionalParams = {
  namespace: string;
  workflowId: string;
  runId: string;
  signal?: AbortSignal;
  onProgress?: (p: BidirectionalProgress) => void;
  /** Fires after every page with that page's raw events and direction flag.
   *  Feed directly into processEvent() to resolve buffer Promises live. */
  onRawPage: (events: HistoryEvent[], isAscending: boolean) => void;
  /** Fires once with the raw events from the first descending page — the most
   *  recent events in the history. Use to call setFailedEvent() before the
   *  ascending cursor processes events that affect billableActions. */
  onFirstDescPage?: (events: HistoryEvent[]) => void;
  maximumPageSize?: number;
  /** After this many total pages (asc + desc combined), pause both cursors and
   *  call onPause with a handle whose resume() continues the fetch. */
  pauseAfterPages?: number;
  /** Called once when the pauseAfterPages threshold is reached. */
  onPause?: (handle: PauseHandle) => void;
  onInvariantViolation?: (reason: string) => void;
};

export const fetchBidirectional = async ({
  namespace,
  workflowId,
  runId,
  signal,
  onProgress,
  onRawPage,
  onFirstDescPage,
  maximumPageSize,
  pauseAfterPages,
  onPause,
  onInvariantViolation,
}: FetchBidirectionalParams): Promise<BidirectionalStats> => {
  if (signal?.aborted) {
    return {
      durationMs: 0,
      totalEvents: 0,
      overlap: 0,
      ascPages: 0,
      descPages: 0,
      eventsPerSecond: 0,
      winner: 'tie',
    };
  }

  const t0 = performance.now();

  const ascCtrl = new AbortController();
  const descCtrl = new AbortController();
  let releasePause: (() => void) | null = null;
  const onAbort = () => {
    ascCtrl.abort();
    descCtrl.abort();
    releasePause?.();
  };
  signal?.addEventListener('abort', onAbort);

  let ascMaxId = 0;
  let descMinId = Infinity;
  let descMaxId = 0;
  let ascPages = 0;
  let descPages = 0;
  let observedPageSize = 0;
  let winnerChosen = false;
  let totalEvents = 0;
  let pauseFired = false;

  type CoveredRange = { minimum: number; maximum: number };
  let ascendingRange: CoveredRange | null = null;
  let descendingRange: CoveredRange | null = null;
  let fallbackSeen: Set<number> | null = null;
  let rawDeliveredCount = 0;

  const rangeSize = (range: CoveredRange | null): number =>
    range ? range.maximum - range.minimum + 1 : 0;

  const uniqueRangeSize = (): number => {
    if (!ascendingRange) return rangeSize(descendingRange);
    if (!descendingRange) return rangeSize(ascendingRange);
    const overlapStart = Math.max(
      ascendingRange.minimum,
      descendingRange.minimum,
    );
    const overlapEnd = Math.min(
      ascendingRange.maximum,
      descendingRange.maximum,
    );
    const overlap = Math.max(0, overlapEnd - overlapStart + 1);
    return rangeSize(ascendingRange) + rangeSize(descendingRange) - overlap;
  };

  const covered = (id: number): boolean =>
    Boolean(
      (ascendingRange &&
        id >= ascendingRange.minimum &&
        id <= ascendingRange.maximum) ||
      (descendingRange &&
        id >= descendingRange.minimum &&
        id <= descendingRange.maximum),
    );

  const addRangeToFallback = (
    seen: Set<number>,
    range: CoveredRange | null,
  ): void => {
    if (!range) return;
    for (let id = range.minimum; id <= range.maximum; id += 1) seen.add(id);
  };

  const enableFallback = (reason: string): Set<number> => {
    if (fallbackSeen) return fallbackSeen;
    fallbackSeen = new Set<number>();
    addRangeToFallback(fallbackSeen, ascendingRange);
    addRangeToFallback(fallbackSeen, descendingRange);
    onInvariantViolation?.(reason);
    return fallbackSeen;
  };

  const pageIsContiguous = (ids: number[], ascending: boolean): boolean => {
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return false;
    for (let index = 1; index < ids.length; index += 1) {
      if (ids[index] - ids[index - 1] !== (ascending ? 1 : -1)) return false;
    }
    return true;
  };

  const processPage = (
    events: HistoryEvent[],
    ascending: boolean,
  ): { fresh: HistoryEvent[]; accept: () => void } => {
    rawDeliveredCount += events.length;
    const ids = events.map((event) => Number(event.eventId));
    const currentRange = ascending ? ascendingRange : descendingRange;
    const pageMinimum = Math.min(...ids);
    const pageMaximum = Math.max(...ids);
    const connectsToCursor =
      !currentRange ||
      (pageMinimum <= currentRange.maximum + 1 &&
        pageMaximum >= currentRange.minimum - 1);

    if (!pageIsContiguous(ids, ascending) || !connectsToCursor) {
      const seen = enableFallback(
        `The ${ascending ? 'ascending' : 'descending'} history cursor returned a non-contiguous or incorrectly ordered page.`,
      );
      const accepted = new Set(seen);
      const fresh = events.filter((event) => {
        const id = Number(event.eventId);
        if (!Number.isSafeInteger(id) || accepted.has(id)) return false;
        accepted.add(id);
        return true;
      });
      return {
        fresh,
        accept: () => {
          fallbackSeen = accepted;
        },
      };
    }

    if (fallbackSeen) {
      const accepted = new Set(fallbackSeen);
      const fresh = events.filter((event) => {
        const id = Number(event.eventId);
        if (accepted.has(id)) return false;
        accepted.add(id);
        return true;
      });
      return {
        fresh,
        accept: () => {
          fallbackSeen = accepted;
        },
      };
    }

    const fresh = events.filter((event) => !covered(Number(event.eventId)));
    const nextRange = currentRange
      ? {
          minimum: Math.min(currentRange.minimum, pageMinimum),
          maximum: Math.max(currentRange.maximum, pageMaximum),
        }
      : { minimum: pageMinimum, maximum: pageMaximum };
    return {
      fresh,
      accept: () => {
        if (ascending) ascendingRange = nextRange;
        else descendingRange = nextRange;
      },
    };
  };

  const gap = () => Math.max(0, descMinId - ascMaxId - 1);

  // Pause latch: both cursor loops await this before each iteration.
  // When pauseAfterPages is reached, a new Promise is created here and
  // onPause is called. resume() resolves it, unblocking both loops.
  let pauseLatch: Promise<void> | null = null;

  const checkPause = async () => {
    if (pauseLatch) await pauseLatch;
  };

  const maybePause = () => {
    if (
      !pauseFired &&
      pauseAfterPages !== undefined &&
      onPause &&
      ascPages + descPages >= pauseAfterPages
    ) {
      pauseFired = true;
      pauseLatch = new Promise<void>((resolve) => {
        releasePause = () => {
          pauseLatch = null;
          releasePause = null;
          resolve();
        };
        onPause({
          resume: () => releasePause?.(),
        });
      });
    }
  };

  const reportProgress = () => {
    onProgress?.({
      ascEvents: ascMaxId,
      descEvents: totalEvents - descMinId + 1,
      ascPages,
      descPages,
      elapsedMs: performance.now() - t0,
      ascMaxId,
      descMinId: descMinId === Infinity ? 0 : descMinId,
      totalEstimated: descMaxId,
    });
  };

  type Token = string | undefined;

  const runAscending = async () => {
    const route = routeForApi('events.ascending', { namespace, workflowId });
    let token: Token;
    while (!ascCtrl.signal.aborted) {
      await checkPause();
      if (ascCtrl.signal.aborted) break;
      const g = gap();
      if (g <= 0) {
        descCtrl.abort();
        break;
      }
      if (observedPageSize > 0 && g <= observedPageSize && !winnerChosen) {
        winnerChosen = true;
        descCtrl.abort();
      }

      let response: GetWorkflowExecutionHistoryResponse | undefined;
      try {
        response = await requestFromAPI<GetWorkflowExecutionHistoryResponse>(
          route,
          {
            token,
            request: fetch,
            params: {
              'execution.runId': runId,
              waitNewEvent: 'false',
              ...(maximumPageSize && {
                maximumPageSize: String(maximumPageSize),
              }),
            },
            options: { signal: ascCtrl.signal },
          },
        );
      } catch {
        break;
      }

      const events = (response?.history?.events ?? []) as HistoryEvent[];
      if (!events.length) break;

      ascPages++;
      observedPageSize = Math.max(observedPageSize, events.length);

      for (const e of events) {
        const id = parseInt(e.eventId);
        if (id > ascMaxId) ascMaxId = id;
      }
      const processed = processPage(events, true);
      const { fresh } = processed;
      if (fresh.length) onRawPage(fresh, true);
      processed.accept();
      reportProgress();
      maybePause();

      if (!response?.nextPageToken || gap() <= 0) {
        descCtrl.abort();
        break;
      }
      token = response.nextPageToken as unknown as string;
    }
  };

  const runDescending = async () => {
    const route = routeForApi('events.descending', { namespace, workflowId });
    let token: Token;
    while (!descCtrl.signal.aborted) {
      await checkPause();
      if (descCtrl.signal.aborted) break;
      const g = gap();
      if (g <= 0) {
        ascCtrl.abort();
        break;
      }
      if (observedPageSize > 0 && g <= observedPageSize && !winnerChosen) {
        winnerChosen = true;
        ascCtrl.abort();
      }

      let response: GetWorkflowExecutionHistoryResponse | undefined;
      try {
        response = await requestFromAPI<GetWorkflowExecutionHistoryResponse>(
          route,
          {
            token,
            request: fetch,
            params: {
              'execution.runId': runId,
              waitNewEvent: 'false',
              ...(maximumPageSize && {
                maximumPageSize: String(maximumPageSize),
              }),
            },
            options: { signal: descCtrl.signal },
          },
        );
      } catch {
        break;
      }

      const events = (response?.history?.events ?? []) as HistoryEvent[];
      if (!events.length) break;

      descPages++;
      observedPageSize = Math.max(observedPageSize, events.length);

      for (const e of events) {
        const id = parseInt(e.eventId);
        if (id < descMinId) descMinId = id;
        if (id > descMaxId) {
          descMaxId = id;
          totalEvents = id;
        }
      }
      const processed = processPage(events, false);
      const { fresh } = processed;
      if (fresh.length) onRawPage(fresh, false);
      if (descPages === 1) onFirstDescPage?.(fresh);
      processed.accept();
      reportProgress();
      maybePause();

      if (!response?.nextPageToken || gap() <= 0) {
        ascCtrl.abort();
        break;
      }
      token = response.nextPageToken as unknown as string;
    }
  };

  await Promise.allSettled([runAscending(), runDescending()]);
  signal?.removeEventListener('abort', onAbort);

  const durationMs = performance.now() - t0;
  const total = (fallbackSeen as Set<number> | null)?.size ?? uniqueRangeSize();
  const overlap = Math.max(0, rawDeliveredCount - total);

  const winner: BidirectionalStats['winner'] =
    ascPages === descPages
      ? 'tie'
      : ascPages > descPages
        ? 'ascending'
        : 'descending';

  return {
    durationMs,
    totalEvents: total,
    overlap,
    ascPages,
    descPages,
    eventsPerSecond: Math.round(total / (durationMs / 1000)),
    winner,
  };
};
