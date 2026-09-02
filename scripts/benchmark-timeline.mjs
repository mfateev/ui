import { chromium } from '@playwright/test';

const baseUrl =
  process.env.TIMELINE_BENCHMARK_BASE_URL ?? 'http://localhost:3000';
const timelinePath =
  process.argv.slice(2).find((argument) => argument !== '--') ??
  process.env.TIMELINE_BENCHMARK_URL;
const outputPath = process.env.TIMELINE_BENCHMARK_OUTPUT;

if (!timelinePath) {
  throw new Error(
    'Pass a timeline path or set TIMELINE_BENCHMARK_URL, for example: pnpm perf:timeline -- /namespaces/default/workflows/<workflow-id>/<run-id>/timeline?follow_continues=on',
  );
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript(() => {
  window.__timelineBenchmarkLongTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__timelineBenchmarkLongTasks.push({
        duration: entry.duration,
        startTime: entry.startTime,
      });
    }
  }).observe({ entryTypes: ['longtask'] });
});

try {
  const timelineUrl = new URL(timelinePath, baseUrl);
  timelineUrl.searchParams.set('timeline_instrumentation', 'on');
  const url = timelineUrl.href;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const timeline = page.locator('#event-history-timeline-graph');
  await timeline.waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('[data-testid="timeline-performance-stats"]').waitFor();

  const clickZoomAndWait = async (button) => {
    const startedAt = performance.now();
    const previousSequence = await timeline.getAttribute(
      'data-update-sequence',
    );
    await button.click();
    await page
      .waitForFunction(
        (sequence) => {
          const element = document.querySelector(
            '#event-history-timeline-graph',
          );
          return Boolean(
            element?.getAttribute('data-update-sequence') &&
            element.getAttribute('data-update-sequence') !== sequence,
          );
        },
        previousSequence,
        { timeout: 5_000 },
      )
      .catch(() => undefined);
    await page.waitForTimeout(500);
    return performance.now() - startedAt;
  };

  const zoomIn = page.locator('[data-testid="timeline-zoom-in"]');
  let settleMs = 0;
  for (let step = 0; step < 20 && (await zoomIn.isEnabled()); step += 1) {
    settleMs = await clickZoomAndWait(zoomIn);
  }

  const results = [];
  const zoomOut = page.locator('[data-testid="timeline-zoom-out"]');

  for (let zoomStep = 0; zoomStep < 20; zoomStep += 1) {
    const measurementStartedAt = await page.evaluate(() => performance.now());

    const scroll = await page.evaluate(async () => {
      const timeline = document.querySelector('#event-history-timeline-graph');
      if (!(timeline instanceof HTMLElement))
        throw new Error('Timeline missing');
      let scrollParent = timeline.parentElement;
      while (scrollParent) {
        const style = getComputedStyle(scrollParent);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          scrollParent.scrollHeight > scrollParent.clientHeight
        ) {
          break;
        }
        scrollParent = scrollParent.parentElement;
      }
      const scrollingElement = scrollParent ?? document.scrollingElement;
      if (!(scrollingElement instanceof HTMLElement))
        throw new Error('Scrolling element missing');

      const usesWindow = scrollingElement === document.scrollingElement;
      const timelineTop = usesWindow
        ? timeline.getBoundingClientRect().top + window.scrollY
        : timeline.getBoundingClientRect().top -
          scrollingElement.getBoundingClientRect().top +
          scrollingElement.scrollTop;
      const viewportHeight = usesWindow
        ? window.innerHeight
        : scrollingElement.clientHeight;
      const documentMaximumTop = Math.max(
        0,
        scrollingElement.scrollHeight - viewportHeight,
      );
      const startTop = Math.min(timelineTop, documentMaximumTop);
      const maximumTop = Math.max(
        startTop,
        Math.min(
          timelineTop + timeline.offsetHeight - viewportHeight,
          documentMaximumTop,
        ),
      );
      const distance = maximumTop - startTop;
      const steps = Math.max(1, Math.min(90, Math.ceil(distance / 250)));
      const frameIntervals = [];
      let previousFrameTime = performance.now();
      const scrollTo = (top) => {
        if (usesWindow) {
          window.scrollTo({ top, behavior: 'instant' });
        } else {
          scrollingElement.scrollTo({ top, behavior: 'instant' });
        }
      };
      scrollTo(startTop);

      for (let step = 0; step <= steps; step += 1) {
        await new Promise((resolve) =>
          requestAnimationFrame((frameTime) => {
            frameIntervals.push(frameTime - previousFrameTime);
            previousFrameTime = frameTime;
            scrollTo(startTop + (distance * step) / steps);
            resolve();
          }),
        );
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      scrollTo(startTop);
      return {
        container:
          scrollingElement.id || scrollingElement.tagName.toLowerCase(),
        distance,
        frameIntervals,
        steps,
      };
    });
    await page.waitForTimeout(250);

    const metrics = await page.evaluate(
      ({ measurementStartedAt, scroll }) => {
        const readNumber = (element, name) =>
          Number(element?.dataset[name] ?? 0);
        const readPercentile = (values, quantile) => {
          if (values.length === 0) return 0;
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.ceil((sorted.length - 1) * quantile)] ?? 0;
        };
        const element = document.querySelector('#event-history-timeline-graph');
        const duration = document.querySelector(
          '[data-testid="timeline-window-duration"]',
        )?.textContent;
        const longTasks = window.__timelineBenchmarkLongTasks.filter(
          (task) => task.startTime >= measurementStartedAt,
        );
        return {
          duration: duration?.trim() ?? 'unknown',
          logicalRows: readNumber(element, 'logicalRowCount'),
          mountedRows: readNumber(element, 'mountedRowCount'),
          renderedLines: readNumber(element, 'renderedLineCount'),
          renderedElements: readNumber(element, 'renderedElementCount'),
          updateMs: readNumber(element, 'updateMs'),
          updateP95Ms: readNumber(element, 'updateP95Ms'),
          updateSamples: readNumber(element, 'updateSampleCount'),
          longestTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)),
          longTaskCount: longTasks.length,
          scrollContainer: scroll.container,
          scrollDistancePx: scroll.distance,
          scrollSteps: scroll.steps,
          scrollFrameP95Ms: readPercentile(scroll.frameIntervals, 0.95),
          scrollFrameMaximumMs: Math.max(0, ...scroll.frameIntervals),
          slowScrollFrames: scroll.frameIntervals.filter((value) => value > 34)
            .length,
        };
      },
      { measurementStartedAt, scroll },
    );
    metrics.zoomSettleMs = settleMs;
    metrics.healthy =
      metrics.updateP95Ms < 50 &&
      metrics.scrollFrameP95Ms < 34 &&
      metrics.longestTaskMs < 50;
    results.push(metrics);
    process.stdout.write(`${JSON.stringify(metrics)}\n`);

    if (!(await zoomOut.isEnabled())) break;
    settleMs = await clickZoomAndWait(zoomOut);
  }

  const report = {
    url,
    measuredAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    thresholds: {
      updateP95Ms: 50,
      scrollFrameP95Ms: 34,
      longestTaskMs: 50,
    },
    firstUnhealthy: results.find((result) => !result.healthy) ?? null,
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputPath, serialized);
  }
  process.stdout.write(serialized);
} finally {
  await browser.close();
}
