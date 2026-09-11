import { expect, test } from '@playwright/test';

import { mockWorkflowApis } from '~/test-utilities/mock-apis';
import { mockWorkflow } from '~/test-utilities/mocks/workflow';

const { workflowId, runId } = mockWorkflow.workflowExecutionInfo.execution;
const timelineUrl = `/namespaces/default/workflows/${workflowId}/${runId}/timeline`;
const hourLongWorkflow = {
  ...mockWorkflow,
  workflowExecutionInfo: {
    ...mockWorkflow.workflowExecutionInfo,
    closeTime: '2022-04-28T06:30:19.427247101Z',
    executionTime: '2022-04-28T05:30:19.427247101Z',
    startTime: '2022-04-28T05:30:19.427247101Z',
    status: 'Completed',
  },
  pendingActivities: [],
};

test.describe('Timeline display mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkflowApis(page, hourLongWorkflow);
  });

  test('keeps full duration separate from the sliding-window view', async ({
    page,
  }) => {
    await page.goto(timelineUrl);

    const timeline = page.getByRole('region', { name: 'Timeline' });
    const fixedWindow = page.getByTestId('timeline-fixed-window');
    const fullDuration = page.getByTestId('timeline-full-duration');
    const classic = page.getByTestId('timeline-classic');
    const zoomControls = page.getByTestId('timeline-zoom-controls');

    await expect(fixedWindow).toHaveAttribute('aria-pressed', 'true');
    await expect(classic).toHaveAttribute('aria-pressed', 'false');
    await expect(timeline).toHaveAttribute('data-display-mode', 'fixed-window');
    await expect(page.locator('[data-chain-load-generation]')).toHaveAttribute(
      'data-chain-load-generation',
      '1',
    );
    await expect(page.getByTestId('timeline-chain-overview')).toBeVisible();
    const overviewTrack = page
      .getByTestId('timeline-chain-overview')
      .getByRole('group');
    const overviewWindow = page.getByTestId('timeline-window-position');
    const trackBox = await overviewTrack.boundingBox();
    const windowBox = await overviewWindow.boundingBox();
    expect(trackBox).not.toBeNull();
    expect(windowBox).not.toBeNull();
    expect((windowBox?.width ?? 0) / (trackBox?.width ?? 1)).toBeLessThan(0.02);
    expect(windowBox?.x ?? 0).toBeGreaterThanOrEqual((trackBox?.x ?? 0) - 1);
    expect((windowBox?.x ?? 0) + (windowBox?.width ?? 0)).toBeLessThanOrEqual(
      (trackBox?.x ?? 0) + (trackBox?.width ?? 0) + 1,
    );
    const startHandleBox = await page
      .getByTestId('timeline-window-resize-start')
      .boundingBox();
    const endHandleBox = await page
      .getByTestId('timeline-window-resize-end')
      .boundingBox();
    expect(startHandleBox?.width).toBe(24);
    expect(endHandleBox?.width).toBe(24);
    expect(
      (startHandleBox?.x ?? 0) + (startHandleBox?.width ?? 0),
    ).toBeLessThanOrEqual((windowBox?.x ?? 0) + 1);
    expect(endHandleBox?.x ?? 0).toBeGreaterThanOrEqual(
      (windowBox?.x ?? 0) + (windowBox?.width ?? 0) - 1,
    );
    await expect(zoomControls.locator(':scope > *')).toHaveCount(3);
    expect(
      await zoomControls
        .locator(':scope > *')
        .evaluateAll((controls) =>
          controls.map((control) => control.getAttribute('data-testid')),
        ),
    ).toEqual([
      'timeline-zoom-out',
      'timeline-window-duration',
      'timeline-zoom-in',
    ]);

    await fullDuration.click();

    await expect(page).toHaveURL(/timeline_mode=full-duration/);
    await expect(fixedWindow).toHaveAttribute('aria-pressed', 'false');
    await expect(fullDuration).toHaveAttribute('aria-pressed', 'true');
    await expect(timeline).toHaveAttribute(
      'data-display-mode',
      'full-duration',
    );
    await expect(page.getByTestId('timeline-chain-overview')).toBeVisible();
    await expect(page.getByTestId('timeline-window-position')).toBeHidden();
    await expect(zoomControls).toBeHidden();
    expect(
      await timeline.evaluate((element) => ({
        renderIds: new Set(
          [...element.querySelectorAll('[data-render-id]')].map((layer) =>
            layer.getAttribute('data-render-id'),
          ),
        ).size,
        projectionRevisions: new Set(
          [...element.querySelectorAll('[data-projection-revision]')].map(
            (layer) => layer.getAttribute('data-projection-revision'),
          ),
        ).size,
        presentationRevisions: new Set(
          [...element.querySelectorAll('[data-presentation-revision]')].map(
            (layer) => layer.getAttribute('data-presentation-revision'),
          ),
        ).size,
      })),
    ).toEqual({
      renderIds: 1,
      projectionRevisions: 1,
      presentationRevisions: 1,
    });

    await classic.click();

    await expect(page).toHaveURL(/timeline_mode=classic/);
    await expect(classic).toHaveAttribute('aria-pressed', 'true');
    await expect(timeline).toHaveAttribute('data-display-mode', 'classic');

    await page.reload();
    await expect(classic).toHaveAttribute('aria-pressed', 'true');

    await fixedWindow.click();

    await expect(page).not.toHaveURL(/timeline_mode/);
    await expect(timeline).toHaveAttribute('data-display-mode', 'fixed-window');
  });

  test('ends the sliding-window drag when movement reports a released pointer', async ({
    page,
  }) => {
    await page.goto(timelineUrl);

    const track = page
      .getByTestId('timeline-chain-overview')
      .getByRole('group');
    const position = page.getByTestId('timeline-window-position');
    const move = page.getByTestId('timeline-window-move');
    await move.scrollIntoViewIfNeeded();
    await expect(move).toBeVisible();

    const trackBox = await track.boundingBox();
    const moveBox = await move.boundingBox();
    expect(trackBox).not.toBeNull();
    expect(moveBox).not.toBeNull();

    await track.evaluate((element) => {
      element.addEventListener(
        'pointerdown',
        (event) => {
          element.setAttribute('data-test-pointer-id', `${event.pointerId}`);
        },
        { capture: true, once: true },
      );
    });
    await page.mouse.move(
      (moveBox?.x ?? 0) + (moveBox?.width ?? 0) / 2,
      (moveBox?.y ?? 0) + (moveBox?.height ?? 0) / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      (trackBox?.x ?? 0) + 4,
      (trackBox?.y ?? 0) + (trackBox?.height ?? 0) / 2,
      { steps: 4 },
    );

    const pointerId = Number(await track.getAttribute('data-test-pointer-id'));
    const draggedBox = await position.boundingBox();
    expect(draggedBox?.x).toBeLessThan(moveBox?.x ?? 0);
    await track.dispatchEvent('pointermove', {
      bubbles: true,
      buttons: 0,
      clientX: (trackBox?.x ?? 0) + 4,
      clientY: (trackBox?.y ?? 0) + (trackBox?.height ?? 0) / 2,
      pointerId,
    });
    await page.mouse.up();

    await expect(position).toHaveAttribute(
      'style',
      /var\(--overview-window-left/,
    );
    const committedBox = await position.boundingBox();
    expect(committedBox?.width).toBeCloseTo(draggedBox?.width ?? 0, 0);

    await page.mouse.move(
      (trackBox?.x ?? 0) + (trackBox?.width ?? 0) - 4,
      (trackBox?.y ?? 0) + (trackBox?.height ?? 0) / 2,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const afterMoveBox = await position.boundingBox();
    expect(afterMoveBox?.x).toBeCloseTo(committedBox?.x ?? 0, 0);
    expect(afterMoveBox?.width).toBeCloseTo(committedBox?.width ?? 0, 0);
  });

  test('resizes the sliding window below the former visual minimum', async ({
    page,
  }) => {
    await page.goto(timelineUrl);

    const position = page.getByTestId('timeline-window-position');
    const startHandle = page.getByTestId('timeline-window-resize-start');
    await startHandle.scrollIntoViewIfNeeded();
    await expect(startHandle).toBeVisible();
    const initialBox = await position.boundingBox();
    const handleBox = await startHandle.boundingBox();
    expect(initialBox).not.toBeNull();
    expect(handleBox).not.toBeNull();

    const handleDragX = (handleBox?.x ?? 0) + 4;
    const handleCenterY = (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2;
    await page.mouse.move(handleDragX, handleCenterY);
    await page.mouse.down();
    await page.mouse.move(handleDragX + 10, handleCenterY, { steps: 4 });
    await page.mouse.up();

    await expect
      .poll(async () => (await position.boundingBox())?.width ?? 0)
      .toBeLessThan((initialBox?.width ?? 0) * 0.75);
  });
});
