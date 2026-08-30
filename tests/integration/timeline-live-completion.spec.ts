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
  test('keeps rows in event order instead of hoisting pending activities', async ({
    page,
  }) => {
    const orderedHistory = [
      atLiveTime(makeWorkflowStarted(1)),
      atLiveTime(makeActivityScheduled(2, 'LongRunning')),
      atLiveTime(makeActivityStarted(3, 2)),
      atLiveTime(makeActivityScheduled(4, 'AlreadyCompleted')),
      atLiveTime(makeActivityStarted(5, 4)),
      atLiveTime(makeActivityCompleted(6, 4, 5)),
    ];
    const workflowWithPendingActivity = {
      ...runningWorkflow,
      pendingActivities: [
        {
          ...mockWorkflow.pendingActivities[0],
          activityId: '2',
          activityType: { name: 'LongRunning' },
        },
      ],
    };

    await mockWorkflowApis(page, workflowWithPendingActivity);
    await page.route(EVENT_HISTORY_API, (route) =>
      route.fulfill({ json: historyPage(orderedHistory) }),
    );
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...orderedHistory].reverse()) }),
    );

    await page.goto(`${timelineUrl}?sort=descending`);

    const completed = page.getByRole('button', {
      name: 'Event AlreadyCompleted: Completed',
    });
    const running = page.getByRole('button', {
      name: /^Event LongRunning:/,
    });
    await expect(completed).toBeVisible();
    await expect(running).toBeVisible();

    const completedBox = await completed.boundingBox();
    const runningBox = await running.boundingBox();
    expect(completedBox?.y).toBeLessThan(runningBox?.y ?? 0);
  });

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

  test('slides existing rows aside for a streamed activity', async ({
    page,
  }) => {
    await mockWorkflowApis(page, runningWorkflow);
    const appendedActivity = [
      atLiveTime(makeActivityScheduled(4, 'VerifyNetwork')),
      atLiveTime(makeActivityStarted(5, 4)),
    ];
    let releaseActivity: () => void;
    const activityHeld = new Promise<void>((resolve) => {
      releaseActivity = resolve;
    });
    let activityDelivered = false;

    await page.route(EVENT_HISTORY_API, async (route) => {
      if (route.request().url().includes('waitNewEvent=true')) {
        if (!activityDelivered) {
          await activityHeld;
          activityDelivered = true;
          return route.fulfill({ json: historyPage(appendedActivity) });
        }
        return route.fulfill({ json: historyPage([]) });
      }
      return route.fulfill({ json: historyPage(inProgress) });
    });
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...inProgress].reverse()) }),
    );

    await page.goto(`${timelineUrl}?sort=descending`);
    const existing = page.getByRole('button', {
      name: /^Event DeployNetwork:/,
    });
    await expect(existing).toBeVisible();
    const rowStack = existing.locator('xpath=ancestor::ul');
    await expect(rowStack).not.toHaveClass(/timeline-rows-entering/);
    const initialY = (await existing.boundingBox())?.y;

    const insertionPositions = existing.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const positions: number[] = [];
          const rowStack = element.closest('ul');
          let sawEntry = false;
          const sample = () => {
            positions.push(element.getBoundingClientRect().y);
            if (rowStack?.classList.contains('timeline-rows-entering')) {
              sawEntry = true;
            } else if (sawEntry) {
              resolve(positions);
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );

    releaseActivity();
    const appended = page.getByRole('button', {
      name: /^Event VerifyNetwork:/,
    });
    await expect(appended).toBeAttached();
    await expect(rowStack).toHaveClass(/timeline-rows-entering/);
    await expect(
      page
        .locator(
          '#event-history-timeline-graph [data-timeline-bottom-entry-offset="-24"]',
        )
        .first(),
    ).toBeAttached();
    const movingY = (await existing.boundingBox())?.y;
    await expect(appended).toBeVisible();
    await expect(rowStack).not.toHaveClass(/timeline-rows-entering/);
    const positions = await insertionPositions;

    const finalExistingY = (await existing.boundingBox())?.y;
    for (let index = 1; index < positions.length; index++) {
      expect(positions[index] - positions[index - 1]).toBeGreaterThanOrEqual(
        -1,
      );
    }
    expect(movingY).toBeLessThan(finalExistingY ?? 0);
    expect(finalExistingY).toBeGreaterThan(initialY ?? 0);
    expect((await appended.boundingBox())?.y).toBeLessThan(finalExistingY ?? 0);
  });

  test('keeps a long activity label visible while running and after completion', async ({
    page,
  }) => {
    const oldEventTime = new Date(Date.now() - 120_000).toISOString();
    const oldInProgress = inProgress.map((event) => ({
      ...event,
      eventTime: oldEventTime,
    }));
    const workflowWithPendingActivity = {
      ...runningWorkflow,
      pendingActivities: [
        {
          ...mockWorkflow.pendingActivities[0],
          activityId: '2',
          activityType: { name: 'DeployNetwork' },
        },
      ],
    };

    let releaseCompletion: () => void;
    const completionHeld = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    let completionDelivered = false;

    await mockWorkflowApis(page, workflowWithPendingActivity);
    await page.route(EVENT_HISTORY_API, async (route) => {
      if (route.request().url().includes('waitNewEvent=true')) {
        if (!completionDelivered) {
          await completionHeld;
          completionDelivered = true;
          return route.fulfill({ json: historyPage([completion]) });
        }
        return route.fulfill({ json: historyPage([]) });
      }
      return route.fulfill({ json: historyPage(oldInProgress) });
    });
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...oldInProgress].reverse()) }),
    );

    await page.goto(timelineUrl);

    const timeline = page.locator('#event-history-timeline-graph');
    const label = timeline.locator('.timeline-running-label');
    await expect(label).toBeVisible();

    const positions = await timeline.evaluate(
      (element) =>
        new Promise<{
          labelLeft: number[];
          labelRight: number;
          leftBoundary: number;
          rightBoundary: number;
        }>((resolve) => {
          const rails = element.querySelectorAll<HTMLElement>(
            '.timeline-height-rail',
          );
          const runningLabel = element.querySelector<HTMLElement>(
            '.timeline-running-label',
          );
          if (!runningLabel || rails.length !== 2) {
            throw new Error('Expected a running label and two timeline rails');
          }

          const labelLeft: number[] = [];
          const sample = () => {
            labelLeft.push(runningLabel.getBoundingClientRect().left);
            if (labelLeft.length < 8) return requestAnimationFrame(sample);

            resolve({
              labelLeft,
              labelRight: runningLabel.getBoundingClientRect().right,
              leftBoundary: rails[0].getBoundingClientRect().right,
              rightBoundary: rails[1].getBoundingClientRect().left,
            });
          };
          requestAnimationFrame(sample);
        }),
    );
    expect(
      Math.max(...positions.labelLeft) - Math.min(...positions.labelLeft),
    ).toBeLessThan(1);
    const visibleLabelWidth =
      Math.min(positions.labelRight, positions.rightBoundary) -
      Math.max(Math.min(...positions.labelLeft), positions.leftBoundary);
    expect(visibleLabelWidth).toBeGreaterThan(100);
    expect(positions.labelRight).toBeLessThan(positions.rightBoundary);

    releaseCompletion();
    await expect(
      page.getByRole('button', { name: 'Event DeployNetwork: Completed' }),
    ).toBeVisible();
    await expect(timeline.locator('.timeline-clamped-label')).toBeVisible();
  });

  test('constrains the workflow label while it enters, pins, and exits', async ({
    page,
  }) => {
    await mockWorkflowApis(page, runningWorkflow);
    await page.route(EVENT_HISTORY_API, (route) =>
      route.fulfill({
        json: historyPage(
          route.request().url().includes('waitNewEvent=true') ? [] : inProgress,
        ),
      }),
    );
    await page.route(EVENT_HISTORY_API_REVERSE, (route) =>
      route.fulfill({ json: historyPage([...inProgress].reverse()) }),
    );

    await page.goto(timelineUrl);

    const timeline = page.locator('#event-history-timeline-graph');
    const label = timeline.locator('.workflow-run-label');
    await timeline.scrollIntoViewIfNeeded();
    await expect(label).toBeVisible();
    await page.getByTestId('pause').click();
    await expect(timeline).toHaveAttribute('data-live-paused', 'true');

    const positions = await timeline.evaluate(async (element) => {
      const workflowLabel = element.querySelector<HTMLElement>(
        '.workflow-run-label',
      );
      const liveLine = element.querySelector<HTMLElement>('.tl-line--live');
      if (!workflowLabel || !liveLine) {
        throw new Error('Expected a workflow label and live workflow line');
      }

      const styles = getComputedStyle(workflowLabel);
      const numberProperty = (name: string) =>
        Number.parseFloat(styles.getPropertyValue(name));
      const originalEndAttachedLeft = numberProperty(
        '--workflow-label-end-attached-left',
      );
      const committedWidth = Number.parseFloat(
        getComputedStyle(liveLine).getPropertyValue(
          '--tl-live-committed-width',
        ),
      );
      const endScreenPx = liveLine.offsetLeft + committedWidth;
      const exitGap =
        endScreenPx - (originalEndAttachedLeft + workflowLabel.offsetWidth);

      const attachedLeft = 100;
      const safeInset = 150;
      const endAttachedLeft = 300;
      workflowLabel.style.setProperty(
        '--workflow-label-attached-left',
        `${attachedLeft}px`,
      );
      workflowLabel.style.setProperty(
        '--workflow-label-safe-inset',
        `${safeInset}px`,
      );
      workflowLabel.style.setProperty(
        '--workflow-label-end-attached-left',
        `${endAttachedLeft}px`,
      );
      const atFrameOffset = async (frameOffset: number) => {
        element.style.setProperty(
          '--timeline-frame-offset',
          `${frameOffset}px`,
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return workflowLabel.offsetLeft;
      };

      const attached = await atFrameOffset(-100);
      const pinnedTarget = 200;
      const pinned = await atFrameOffset(50);
      const exiting = await atFrameOffset(200);
      element.style.setProperty('--timeline-frame-offset', '0px');

      return {
        attached,
        attachedLeft,
        pinned,
        pinnedTarget,
        exiting,
        endAttachedLeft,
        exitGap,
      };
    });

    expect(positions.attached).toBeCloseTo(positions.attachedLeft, 0);
    expect(positions.pinned).toBeCloseTo(positions.pinnedTarget, 0);
    expect(positions.exiting).toBeCloseTo(positions.endAttachedLeft, 0);
    expect(positions.exitGap).toBeGreaterThan(0);
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
    await timeline.scrollIntoViewIfNeeded();
    const clipping = await timeline.evaluate((element) => {
      const clip = element.querySelector<HTMLElement>(
        '.timeline-viewport-clip',
      );
      const rails = element.querySelectorAll<HTMLElement>(
        '.timeline-height-rail',
      );
      if (!clip || rails.length !== 2) return null;

      const clipRect = clip.getBoundingClientRect();
      const left = rails[0].getBoundingClientRect();
      const right = rails[1].getBoundingClientRect();
      const clipPath = getComputedStyle(clip).clipPath;
      const horizontalInset = Number.parseFloat(
        clipPath.match(/^inset\([^ ]+ ([^ )]+)/)?.[1] ?? 'NaN',
      );

      return {
        clipPath,
        leftBoundaryDelta: Math.abs(
          clipRect.left + horizontalInset - left.right,
        ),
        rightBoundaryDelta: Math.abs(
          clipRect.right - horizontalInset - right.left,
        ),
      };
    });
    expect(clipping?.clipPath).toMatch(/^inset\(/);
    expect(clipping?.leftBoundaryDelta).toBeLessThan(0.5);
    expect(clipping?.rightBoundaryDelta).toBeLessThan(0.5);

    const viewportOffset = async () =>
      Number(await timeline.getAttribute('data-viewport-offset'));
    const axisWorldTicks = async () =>
      page
        .locator('[data-timeline-axis-world-px]')
        .evaluateAll((ticks) =>
          ticks.map((tick) =>
            Number(tick.getAttribute('data-timeline-axis-world-px')),
          ),
        );
    const initialOffset = await viewportOffset();
    const initialAxisWorldTicks = await axisWorldTicks();
    await expect
      .poll(viewportOffset, { timeout: 3_000 })
      .toBeGreaterThan(initialOffset);
    const advancedAxisWorldTicks = await axisWorldTicks();
    expect(
      initialAxisWorldTicks.filter((tick) =>
        advancedAxisWorldTicks.includes(tick),
      ).length,
    ).toBeGreaterThan(0);

    const frameOffsets = await timeline.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const offsets: number[] = [];
          const sample = () => {
            offsets.push(
              Number.parseFloat(
                getComputedStyle(element).getPropertyValue(
                  '--timeline-frame-offset',
                ),
              ),
            );
            if (offsets.length === 4) resolve(offsets);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    expect(new Set(frameOffsets).size).toBeGreaterThan(1);

    const liveEdgePositions = await timeline.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const extensions: number[] = [];
          const sample = () => {
            const liveLine = element.querySelector('.tl-line--live');
            if (liveLine) {
              const committedWidth = Number.parseFloat(
                getComputedStyle(liveLine).getPropertyValue(
                  '--tl-live-committed-width',
                ),
              );
              const extensionWidth = Number.parseFloat(
                getComputedStyle(element).getPropertyValue(
                  '--timeline-live-edge-extension',
                ),
              );
              extensions.push(
                liveLine.getBoundingClientRect().left +
                  committedWidth +
                  extensionWidth,
              );
            }
            if (extensions.length === 8) resolve(extensions);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    const range = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    expect(range(liveEdgePositions)).toBeLessThan(1);

    const clippedPatternCommitDelta = await timeline.evaluate(
      (element) =>
        new Promise<number>((resolve) => {
          let previous:
            | { viewportOffset: number; patternOrigin: number }
            | undefined;
          const sample = () => {
            const line = element.querySelector(
              '.tl-line--viewport-clipped-start',
            );
            if (line) {
              const pseudo = getComputedStyle(line, '::after');
              const translateX = Number.parseFloat(pseudo.translate) || 0;
              const current = {
                viewportOffset: Number(
                  element.getAttribute('data-viewport-offset'),
                ),
                patternOrigin: line.getBoundingClientRect().left + translateX,
              };
              if (
                previous &&
                Math.abs(current.viewportOffset - previous.viewportOffset) > 1
              ) {
                resolve(
                  Math.abs(current.patternOrigin - previous.patternOrigin),
                );
                return;
              }
              previous = current;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    expect(clippedPatternCommitDelta).toBeLessThan(1);

    await page.getByTestId('pause').click();
    await expect(timeline).toHaveAttribute('data-live-paused', 'true');
    await expect(timeline).toHaveAttribute('data-viewport-following', 'false');
    const frozenOffset = await viewportOffset();
    const frozenFrameOffset = await timeline.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--timeline-frame-offset'),
    );
    await page.waitForTimeout(1_200);
    expect(await viewportOffset()).toBe(frozenOffset);
    expect(
      await timeline.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--timeline-frame-offset'),
      ),
    ).toBe(frozenFrameOffset);

    await page.getByTestId('pause').click();
    await expect(timeline).toHaveAttribute('data-live-paused', 'false');
    await expect(timeline).toHaveAttribute('data-viewport-following', 'true');
    await expect
      .poll(viewportOffset, { timeout: 3_000 })
      .toBeGreaterThan(frozenOffset);
  });
});
