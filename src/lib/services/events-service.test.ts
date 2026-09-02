import { describe, expect, it, vi } from 'vitest';

import { fetchCompleteRawHistoryOrThrow } from './events-service';
import {
  makeWorkflowCompleted,
  makeWorkflowStarted,
} from './test-helpers/synthetic-events';

const response = (body: unknown) =>
  ({
    json: async () => body,
    ok: true,
    status: 200,
    statusText: 'OK',
  }) as Response;

describe('fetchCompleteRawHistoryOrThrow', () => {
  it('deduplicates event IDs across every page and reaches the terminal token', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          history: { events: [makeWorkflowStarted(1)] },
          nextPageToken: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        response({
          history: {
            events: [makeWorkflowStarted(1), makeWorkflowCompleted(2)],
          },
        }),
      ) as unknown as typeof fetch;

    const history = await fetchCompleteRawHistoryOrThrow({
      namespace: 'default',
      workflowId: 'workflow',
      runId: 'run',
      request,
    });

    expect(history.events.map(({ eventId }) => eventId)).toEqual(['1', '2']);
    expect(history).toMatchObject({ pages: 2, duplicateEventIds: 1 });
    expect(request.mock.calls[1]?.[0]).toContain('next_page_token=page-2');
  });

  it('rejects a pagination token cycle instead of loading forever', async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        history: { events: [makeWorkflowStarted(1)] },
        nextPageToken: 'repeated',
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchCompleteRawHistoryOrThrow({
        namespace: 'default',
        workflowId: 'workflow',
        runId: 'run',
        request,
      }),
    ).rejects.toThrow(/repeated a page token/);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
