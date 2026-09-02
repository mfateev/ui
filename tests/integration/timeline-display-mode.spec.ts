import { expect, test } from '@playwright/test';

import { mockWorkflowApis } from '~/test-utilities/mock-apis';
import { mockWorkflow } from '~/test-utilities/mocks/workflow';

const { workflowId, runId } = mockWorkflow.workflowExecutionInfo.execution;
const timelineUrl = `/namespaces/default/workflows/${workflowId}/${runId}/timeline`;

test.describe('Timeline display mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkflowApis(page);
  });

  test('fits full duration within the sliding-window view', async ({
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
    await expect(page.getByTestId('timeline-chain-overview')).toBeVisible();
    await expect(zoomControls.locator(':scope > *')).toHaveCount(4);
    expect(
      await zoomControls
        .locator(':scope > *')
        .evaluateAll((controls) =>
          controls.map((control) => control.getAttribute('data-testid')),
        ),
    ).toEqual([
      'timeline-full-duration',
      'timeline-zoom-out',
      'timeline-window-duration',
      'timeline-zoom-in',
    ]);

    await fullDuration.click();

    await expect(page).not.toHaveURL(/timeline_mode/);
    await expect(fixedWindow).toHaveAttribute('aria-pressed', 'true');
    await expect(fullDuration).toHaveAttribute('aria-pressed', 'true');
    await expect(timeline).toHaveAttribute('data-display-mode', 'fixed-window');
    await expect(page.getByTestId('timeline-chain-overview')).toBeVisible();

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
});
