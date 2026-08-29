import { afterEach, describe, expect, test, vi } from 'vitest';

import { base } from '$app/paths';

import {
  fetchAllWorkflows,
  fetchLatestWorkflowExecutionIdentity,
  fetchWorkflowForRunId,
} from './workflow-service';
import { getApiOrigin } from '../utilities/get-api-origin';
import { requestFromAPI } from '../utilities/request-from-api';

vi.mock('../utilities/request-from-api', () => ({
  requestFromAPI: vi.fn().mockImplementation(
    () =>
      new Promise((resolve) =>
        resolve({
          executions: [],
          nextPageToken: '',
        }),
      ),
  ),
}));

const origin = getApiOrigin();

describe('workflow service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchAllWorkflows', () => {
    test('preserves queries with "%"', async () => {
      await fetchAllWorkflows('test', {
        query: 'WorkflowType LIKE "cron%"',
      });

      expect(requestFromAPI).toHaveBeenCalledOnce();
      expect(requestFromAPI).toHaveBeenCalledWith(
        `${origin}${base}/api/v1/namespaces/test/workflows`,
        {
          handleError: expect.any(Function),
          onError: expect.any(Function),
          params: {
            query: 'WorkflowType LIKE "cron%"',
          },
          request: expect.any(Function),
        },
      );
    });
  });

  describe('fetchLatestWorkflowExecutionIdentity', () => {
    test('uses the bounded latest identity endpoint', async () => {
      vi.mocked(requestFromAPI).mockResolvedValueOnce({
        workflowId: 'workflow-id',
        runId: 'run-2',
        firstExecutionRunId: 'run-1',
      });

      const result = await fetchLatestWorkflowExecutionIdentity({
        namespace: 'test',
        workflowId: 'workflow-id',
      });

      expect(result.identity?.firstExecutionRunId).toBe('run-1');
      expect(requestFromAPI).toHaveBeenCalledWith(
        `${origin}${base}/api/v1/namespaces/test/workflows/workflow-id/latest-execution`,
        {
          notifyOnError: false,
          request: expect.any(Function),
        },
      );
    });
  });

  describe('fetchWorkflowForRunId', () => {
    test('is called with the correct params', async () => {
      const workflowId = 'temporal.test%';
      await fetchWorkflowForRunId({ namespace: 'test', workflowId });

      expect(requestFromAPI).toHaveBeenCalledOnce();
      expect(requestFromAPI).toHaveBeenCalledWith(
        `${origin}${base}/api/v1/namespaces/test/workflows`,
        {
          params: {
            query: `WorkflowId="${workflowId}"`,
            pageSize: '1',
          },
          request: expect.any(Function),
        },
      );
    });
  });
});
