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
      null,
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
});
