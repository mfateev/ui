import { expect, test } from '@playwright/test';

import {
  makeActivityCompleted,
  makeActivityScheduled,
  makeActivityStarted,
  makeWorkflowStarted,
} from '$src/lib/services/test-helpers/synthetic-events';
import { mockWorkflowApis } from '~/test-utilities/mock-apis';
import {
  EVENT_HISTORY_API,
  EVENT_HISTORY_API_REVERSE,
} from '~/test-utilities/mocks/event-history';
import { mockWorkflow } from '~/test-utilities/mocks/workflow';

// Regression for: a running group's timeline bar/label stayed "in progress"
// after it completed, until reload. The completion arrives via the live poll,
// which used to extend the group in place — the row pool keys on group identity,
// so a stable reference meant no re-render. The buffer now copy-on-writes the
// group, handing the row a fresh reference. The accessible name
// ("Event <type>: <classification>") is the robust, non-brittle proxy for the
// recolor — with the bug it stays non-Completed.

const { workflowId, runId } = mockWorkflow.workflowExecutionInfo.execution;
const timelineUrl = `/namespaces/default/workflows/${workflowId}/${runId}/timeline`;

// Activity scheduled + started, not yet completed.
const liveEventTime = new Date(Date.now() - 2_000).toISOString();
const atLiveTime = <T extends { eventTime: string }>(event: T): T => ({
  ...event,
  eventTime: liveEventTime,
});
const inProgress = [
  atLiveTime(makeWorkflowStarted(1)),
  atLiveTime(makeActivityScheduled(2, 'DeployNetwork')),
  atLiveTime(makeActivityStarted(3, 2)),
];
const completion = atLiveTime(makeActivityCompleted(4, 2, 3));

const historyPage = (events: unknown[]) => ({
  history: { events },
  rawHistory: [],
  nextPageToken: null,
  archived: false,
});

const runningWorkflow = {
  ...mockWorkflow,
  workflowExecutionInfo: {
    ...mockWorkflow.workflowExecutionInfo,
    status: 'Running',
    closeTime: null,
  },
  // Keep the activity out of pendingActivities so its in-progress state comes
  // purely from its classification (Started), isolating the recolor path.
  pendingActivities: [],
  pendingChildren: [],
};

test.describe('Timeline live completion', () => {
  test('recolors/relabels a group to Completed when the completion arrives live', async ({
    page,
  }) => {
    await mockWorkflowApis(page, runningWorkflow);

    // The stale-color bug only shows once the in-progress bar is already on
    // screen and the completion then lands on the rendered group. The live poll
    // starts before the initial fetch, so the completion is held until the test
    // has observed that state — a fixed delay would race initial render.
    let releaseCompletion: () => void;
    const completionHeld = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });

    // The live poll long-polls the ascending history route with
    // waitNewEvent=true; deliver the completion on the first such request and
    // nothing thereafter. The initial (non-waitNewEvent) fetch stays in-progress.
    let completionDelivered = false;
    await page.route(EVENT_HISTORY_API, async (route) => {
      if (route.request().url().includes('waitNewEvent=true')) {
        if (!completionDelivered) {
          await completionHeld;
          if (completionDelivered) {
            return route.fulfill({ json: historyPage([]) });
          }
          completionDelivered = true;
          return route.fulfill({ json: historyPage([completion]) });
        }
        return route.fulfill({ json: historyPage([]) });
      }
      return route.fulfill({ json: historyPage(inProgress) });
    });
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...inProgress].reverse()) }),
    );

    await page.goto(timelineUrl);

    // Row renders in progress first (Started, not Completed)...
    const completedButton = page.getByRole('button', {
      name: 'Event DeployNetwork: Completed',
    });
    await expect(
      page.getByRole('button', { name: /^Event DeployNetwork:/ }),
    ).toBeVisible();
    await expect(completedButton).toHaveCount(0);

    // ...then flips to Completed once the live completion arrives — no reload.
    releaseCompletion();
    await expect(completedButton).toBeVisible();
  });

  test('freezes the viewport while paused and follows the latest edge after resume', async ({
    page,
  }) => {
    await mockWorkflowApis(page, runningWorkflow);
    await page.route(EVENT_HISTORY_API, async (route) => {
      if (route.request().url().includes('waitNewEvent=true')) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({ json: historyPage([]) });
      }
      return route.fulfill({ json: historyPage(inProgress) });
    });
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...inProgress].reverse()) }),
    );

    await page.goto(timelineUrl);
    await expect(
      page.getByRole('button', { name: /^Event DeployNetwork:/ }),
    ).toBeVisible();

    const timeline = page.locator('#event-history-timeline-graph');
    const viewportOffset = async () =>
      Number(await timeline.getAttribute('data-viewport-offset'));
    const initialOffset = await viewportOffset();
    await expect
      .poll(viewportOffset, { timeout: 3_000 })
      .toBeGreaterThan(initialOffset);

    const frameOffsets = await timeline.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const offsets: number[] = [];
          const sample = () => {
            offsets.push(Number((element as HTMLElement).dataset.frameOffset));
            if (offsets.length === 4) resolve(offsets);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    expect(new Set(frameOffsets).size).toBeGreaterThan(1);

    const liveEdgePositions = await timeline.evaluate(
      (element) =>
        new Promise<{ anchors: number[]; extensions: number[] }>((resolve) => {
          const anchors: number[] = [];
          const extensions: number[] = [];
          const sample = () => {
            const anchor = element.querySelector('.timeline-live-edge-anchor');
            const extension = element.querySelector('.tl-live-edge-extension');
            if (anchor && extension) {
              anchors.push(anchor.getBoundingClientRect().right);
              extensions.push(extension.getBoundingClientRect().right);
            }
            if (anchors.length === 8) resolve({ anchors, extensions });
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    const range = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    expect(range(liveEdgePositions.anchors)).toBeLessThan(1);
    expect(range(liveEdgePositions.extensions)).toBeLessThan(1);

    await page.getByTestId('pause').click();
    await expect(timeline).toHaveAttribute('data-live-paused', 'true');
    await expect(timeline).toHaveAttribute('data-viewport-following', 'false');
    const frozenOffset = await viewportOffset();
    const frozenFrameOffset = await timeline.getAttribute('data-frame-offset');
    await page.waitForTimeout(1_200);
    expect(await viewportOffset()).toBe(frozenOffset);
    await expect(timeline).toHaveAttribute(
      'data-frame-offset',
      frozenFrameOffset ?? '0',
    );

    await page.getByTestId('pause').click();
    await expect(timeline).toHaveAttribute('data-live-paused', 'false');
    await expect(timeline).toHaveAttribute('data-viewport-following', 'true');
    await expect
      .poll(viewportOffset, { timeout: 3_000 })
      .toBeGreaterThan(frozenOffset);
  });
});
