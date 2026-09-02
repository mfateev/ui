import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  type CDPSession,
  chromium,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

import { createTimelineStressFixture } from '../tests/test-utilities/timeline-stress-fixture';

const numberFromEnvironment = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
};

const integerFromEnvironment = (
  name: string,
  fallback: number,
  maximum: number,
): number =>
  Math.min(maximum, Math.floor(numberFromEnvironment(name, fallback)));

const baseUrl =
  process.env.TIMELINE_BREAKPOINT_BASE_URL ?? 'http://localhost:3000';
const runCount = integerFromEnvironment('TIMELINE_BREAKPOINT_RUNS', 32, 32);
const maximumRows = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_ROWS',
  50_000,
  50_000,
);
const rowsPerRun = Math.max(1, Math.floor(maximumRows / runCount));
const maximumZoomLevels = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_ZOOMS',
  10,
  12,
);
const maximumRuntimeMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_RUNTIME_MS',
  120_000,
);
const maximumNodeRssBytes =
  numberFromEnvironment('TIMELINE_BREAKPOINT_MAX_NODE_RSS_MB', 1_500) *
  1024 *
  1024;
const maximumBrowserHeapBytes =
  numberFromEnvironment('TIMELINE_BREAKPOINT_MAX_BROWSER_HEAP_MB', 1_200) *
  1024 *
  1024;
const updateP95LimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_UPDATE_P95_MS',
  50,
);
const scrollP95LimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_SCROLL_P95_MS',
  34,
);
const longTaskLimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_LONG_TASK_MS',
  50,
);
const hardUpdateP95LimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_HARD_UPDATE_P95_MS',
  500,
);
const hardScrollP95LimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_HARD_SCROLL_P95_MS',
  250,
);
const hardLongTaskLimitMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_HARD_LONG_TASK_MS',
  1_000,
);
const outputPath = resolve(
  process.env.TIMELINE_BREAKPOINT_OUTPUT ??
    '../.agent-artifacts/timeline-breakpoint-benchmark.json',
);

const fixture = createTimelineStressFixture({
  runCount,
  rowsPerRun,
  runDurationMs: 60_000,
  startTimeMs: Date.now() - runCount * 60_000,
});

type TimelineDomStats = {
  logicalRows: number;
  mountedRows: number;
  renderedLines: number;
  renderedElements: number;
  updateMs: number;
  updateP95Ms: number;
  updateSamples: number;
  updateSequence: number;
};

type ScrollStats = {
  container: string;
  distancePx: number;
  frames: number;
  p95FrameMs: number;
  maximumFrameMs: number;
  slowFrames: number;
};

type LevelResult = TimelineDomStats &
  ScrollStats & {
    duration: string;
    durationMs: number;
    settleMs: number;
    settleTimedOut: boolean;
    longestTaskMs: number;
    browserHeapBytes: number;
    nodeRssBytes: number;
    degradedReasons: string[];
    breakpointReasons: string[];
  };

const browserHeapUsed = async (session: CDPSession): Promise<number> => {
  await session.send('HeapProfiler.collectGarbage');
  const response = (await session.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  return (
    response.metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? 0
  );
};

const waitForButtonEnabled = async (
  button: Locator,
  timeoutMs: number,
): Promise<void> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (await button.isEnabled()) return;
    await button.page().waitForTimeout(50);
  }
  throw new Error(`Button was not enabled within ${timeoutMs} ms.`);
};

const waitForTextChange = async (
  locator: Locator,
  previousValue: string,
  timeoutMs: number,
): Promise<void> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if ((await locator.textContent())?.trim() !== previousValue) return;
    await locator.page().waitForTimeout(25);
  }
  throw new Error(`Text did not change within ${timeoutMs} ms.`);
};

const readTimelineStats = async (page: Page): Promise<TimelineDomStats> => {
  const attributes = await page
    .locator('#event-history-timeline-graph')
    .evaluate((element) => ({
      logicalRows: element.getAttribute('data-logical-row-count'),
      mountedRows: element.getAttribute('data-mounted-row-count'),
      renderedLines: element.getAttribute('data-rendered-line-count'),
      renderedElements: element.getAttribute('data-rendered-element-count'),
      updateMs: element.getAttribute('data-update-ms'),
      updateP95Ms: element.getAttribute('data-update-p95-ms'),
      updateSamples: element.getAttribute('data-update-sample-count'),
      updateSequence: element.getAttribute('data-update-sequence'),
    }));
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, Number(value ?? 0)]),
  ) as TimelineDomStats;
};

const waitForTimelineToSettle = async (
  page: Page,
  activeRequests: () => number,
): Promise<{
  stats: TimelineDomStats;
  settleMs: number;
  settleTimedOut: boolean;
}> => {
  const startedAt = performance.now();
  let lastSequence = -1;
  let stableSince = performance.now();
  let stats = await readTimelineStats(page);
  while (performance.now() - startedAt < 8_000) {
    stats = await readTimelineStats(page);
    if (stats.updateSequence !== lastSequence || activeRequests() > 0) {
      lastSequence = stats.updateSequence;
      stableSince = performance.now();
    } else if (performance.now() - stableSince >= 350) {
      return {
        stats,
        settleMs: performance.now() - startedAt,
        settleTimedOut: false,
      };
    }
    await page.waitForTimeout(50);
  }
  return {
    stats,
    settleMs: performance.now() - startedAt,
    settleTimedOut: true,
  };
};

const scrollBrowserWindow = async (page: Page): Promise<ScrollStats> =>
  page.evaluate(async () => {
    const container = document.querySelector<HTMLElement>('#content-wrapper');
    const scrollTarget = container ?? document.scrollingElement;
    if (!scrollTarget)
      throw new Error('No browser scroll container was found.');
    const maximumScroll = Math.max(
      0,
      scrollTarget.scrollHeight - scrollTarget.clientHeight,
    );
    const frameDurations: number[] = [];
    const positions = Array.from({ length: 25 }, (_, index) =>
      Math.round((maximumScroll * index) / 24),
    );
    positions.push(...positions.slice(0, -1).reverse());
    let previousFrameTime = performance.now();
    for (const position of positions) {
      scrollTarget.scrollTop = position;
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame((frameTime) => {
          frameDurations.push(frameTime - previousFrameTime);
          previousFrameTime = frameTime;
          resolveFrame();
        }),
      );
    }
    const sorted = [...frameDurations].sort((left, right) => left - right);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.ceil(sorted.length * 0.95) - 1,
    );
    return {
      container: container ? '#content-wrapper' : 'document',
      distancePx: maximumScroll,
      frames: frameDurations.length,
      p95FrameMs: sorted[p95Index] ?? 0,
      maximumFrameMs: Math.max(0, ...frameDurations),
      slowFrames: frameDurations.filter((duration) => duration > 34).length,
    };
  });

const fulfillHistory = async (route: Route): Promise<void> => {
  const url = new URL(route.request().url());
  const runId = url.searchParams.get('execution.runId');
  if (!runId) throw new Error(`History request has no run ID: ${url}`);
  const maximumPageSize = Number(
    url.searchParams.get('maximumPageSize') ?? 1_000,
  );
  const page = fixture.historyPage(
    runId,
    url.pathname.endsWith('/history-reverse') ? 'descending' : 'ascending',
    maximumPageSize,
    url.searchParams.get('nextPageToken'),
  );
  await route.fulfill({
    json: {
      history: { events: page.events },
      rawHistory: [],
      nextPageToken: page.nextPageToken,
      archived: false,
    },
  });
};

const main = async (): Promise<void> => {
  const startedAt = performance.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--renderer-process-limit=2'],
  });
  const context = await browser.newContext({
    viewport: { width: 1_920, height: 1_080 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const results: LevelResult[] = [];
  let activeApiRequests = 0;
  let peakApiRequests = 0;
  let firstDegraded: LevelResult | null = null;
  let breakpoint: LevelResult | null = null;
  let stoppedByGuard: string | null = null;

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('request', (request) => {
    if (!request.url().includes(`/workflows/${fixture.workflowId}`)) return;
    activeApiRequests += 1;
    peakApiRequests = Math.max(peakApiRequests, activeApiRequests);
  });
  const finishRequest = (url: string) => {
    if (!url.includes(`/workflows/${fixture.workflowId}`)) return;
    activeApiRequests = Math.max(0, activeApiRequests - 1);
  };
  page.on('requestfinished', (request) => finishRequest(request.url()));
  page.on('requestfailed', (request) => finishRequest(request.url()));

  try {
    await page.route('https://newsfeed.temporal.io/**', async (route) => {
      await route.fulfill({
        json: { server_time: new Date().toISOString(), items: [] },
      });
    });
    await page.route(
      new RegExp(
        `/api/v1/namespaces/[^/]+/workflows/${fixture.workflowId}/history(?:-reverse)?\\?`,
      ),
      fulfillHistory,
    );
    await page.route(
      new RegExp(
        `/api/v1/namespaces/[^/]+/workflows/${fixture.workflowId}/latest-execution(?:\\?.*)?$`,
      ),
      async (route) => {
        await route.fulfill({
          json: {
            workflowId: fixture.workflowId,
            runId: fixture.currentRunId,
            firstExecutionRunId: fixture.firstRunId,
          },
        });
      },
    );
    await page.route(
      new RegExp(
        `/api/v1/namespaces/[^/]+/workflows/${fixture.workflowId}(?:\\?.*)?$`,
      ),
      async (route) => {
        const url = new URL(route.request().url());
        const runId =
          url.searchParams.get('execution.runId') ?? fixture.currentRunId;
        await route.fulfill({ json: fixture.workflowResponse(runId) });
      },
    );
    await page.addInitScript(() => {
      const longTasks: number[] = [];
      Object.defineProperty(window, '__timelineBreakpointLongTasks', {
        configurable: true,
        value: longTasks,
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      }).observe({ entryTypes: ['longtask'] });
    });

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    await session.send('HeapProfiler.enable');
    const timelineUrl = `${baseUrl}/namespaces/default/workflows/${fixture.workflowId}/${fixture.firstRunId}/timeline?follow_continues=on`;
    await page.goto(timelineUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page
      .getByRole('region', { name: 'Timeline' })
      .waitFor({ timeout: 20_000 });
    await page
      .getByTestId('timeline-full-duration')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await waitForButtonEnabled(
      page.getByTestId('timeline-full-duration'),
      20_000,
    );

    const zoomIn = page.getByTestId('timeline-zoom-in');
    for (
      let attempt = 0;
      attempt < 12 && (await zoomIn.isEnabled());
      attempt += 1
    ) {
      await zoomIn.click();
    }

    const zoomOut = page.getByTestId('timeline-zoom-out');
    const durationLabel = page.getByTestId('timeline-window-duration');
    for (let level = 0; level < maximumZoomLevels; level += 1) {
      if (performance.now() - startedAt >= maximumRuntimeMs) {
        stoppedByGuard = `runtime exceeded ${maximumRuntimeMs} ms`;
        break;
      }

      await page.evaluate(() => {
        const values = (
          window as typeof window & {
            __timelineBreakpointLongTasks: number[];
          }
        ).__timelineBreakpointLongTasks;
        values.length = 0;
      });
      const { stats, settleMs, settleTimedOut } = await waitForTimelineToSettle(
        page,
        () => activeApiRequests,
      );
      const scroll = settleTimedOut
        ? {
            container: '#content-wrapper',
            distancePx: 0,
            frames: 0,
            p95FrameMs: 0,
            maximumFrameMs: 0,
            slowFrames: 0,
          }
        : await scrollBrowserWindow(page);
      const longestTaskMs = await page.evaluate(() =>
        Math.max(
          0,
          ...(
            window as typeof window & {
              __timelineBreakpointLongTasks: number[];
            }
          ).__timelineBreakpointLongTasks,
        ),
      );
      const browserHeapBytes = await browserHeapUsed(session);
      const nodeRssBytes = process.memoryUsage().rss;
      const duration = (await durationLabel.textContent())?.trim() ?? 'unknown';
      const durationMs = Number(
        await page
          .getByRole('region', { name: 'Timeline' })
          .getAttribute('data-window-duration-ms'),
      );
      const degradedReasons: string[] = [];
      if (stats.updateP95Ms >= updateP95LimitMs) {
        degradedReasons.push(`update p95 ${stats.updateP95Ms.toFixed(1)} ms`);
      }
      if (scroll.p95FrameMs >= scrollP95LimitMs) {
        degradedReasons.push(
          `scroll frame p95 ${scroll.p95FrameMs.toFixed(1)} ms`,
        );
      }
      if (longestTaskMs >= longTaskLimitMs) {
        degradedReasons.push(`long task ${longestTaskMs.toFixed(1)} ms`);
      }
      const breakpointReasons: string[] = [];
      if (settleTimedOut) {
        breakpointReasons.push('timeline did not settle within 8 seconds');
      }
      if (stats.updateP95Ms >= hardUpdateP95LimitMs) {
        breakpointReasons.push(`update p95 ${stats.updateP95Ms.toFixed(1)} ms`);
      }
      if (scroll.p95FrameMs >= hardScrollP95LimitMs) {
        breakpointReasons.push(
          `scroll frame p95 ${scroll.p95FrameMs.toFixed(1)} ms`,
        );
      }
      if (longestTaskMs >= hardLongTaskLimitMs) {
        breakpointReasons.push(`long task ${longestTaskMs.toFixed(1)} ms`);
      }
      const result: LevelResult = {
        duration,
        durationMs,
        ...stats,
        settleMs,
        settleTimedOut,
        ...scroll,
        longestTaskMs,
        browserHeapBytes,
        nodeRssBytes,
        degradedReasons,
        breakpointReasons,
      };
      results.push(result);
      firstDegraded ??= degradedReasons.length ? result : null;
      console.log(
        `${duration.padStart(4)} | ${String(stats.logicalRows).padStart(6)} rows | update p95 ${stats.updateP95Ms.toFixed(1).padStart(5)} ms | scroll p95 ${scroll.p95FrameMs.toFixed(1).padStart(5)} ms | heap ${(browserHeapBytes / 1024 / 1024).toFixed(0).padStart(4)} MB${breakpointReasons.length ? ` | BREAK: ${breakpointReasons.join(', ')}` : degradedReasons.length ? ` | degraded: ${degradedReasons.join(', ')}` : ''}`,
      );

      if (breakpointReasons.length) {
        breakpoint = result;
        break;
      }
      if (browserHeapBytes >= maximumBrowserHeapBytes) {
        stoppedByGuard = `browser heap reached ${(browserHeapBytes / 1024 / 1024).toFixed(0)} MB`;
        break;
      }
      if (nodeRssBytes >= maximumNodeRssBytes) {
        stoppedByGuard = `Node RSS reached ${(nodeRssBytes / 1024 / 1024).toFixed(0)} MB`;
        break;
      }
      if (!(await zoomOut.isEnabled())) break;
      const previousDuration = duration;
      await zoomOut.click();
      await waitForTextChange(durationLabel, previousDuration, 3_000);
      await page.waitForTimeout(200);
    }

    const report = {
      generated: {
        runs: fixture.runs.length,
        rowsPerRun,
        totalRows: fixture.totalRows,
      },
      limits: {
        maximumRows,
        maximumZoomLevels,
        maximumRuntimeMs,
        maximumNodeRssBytes,
        maximumBrowserHeapBytes,
        updateP95LimitMs,
        scrollP95LimitMs,
        longTaskLimitMs,
        hardUpdateP95LimitMs,
        hardScrollP95LimitMs,
        hardLongTaskLimitMs,
      },
      peakApiRequests,
      firstDegraded,
      breakpoint,
      stoppedByGuard,
      maximumTestedRows: Math.max(
        0,
        ...results.map(({ logicalRows }) => logicalRows),
      ),
      elapsedMs: performance.now() - startedAt,
      errors,
      results,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${outputPath}`);
    if (stoppedByGuard) console.log(`Stopped safely: ${stoppedByGuard}`);
    if (!breakpoint && !stoppedByGuard) {
      console.log(
        `No breakpoint found through ${report.maximumTestedRows} visible rows.`,
      );
    }
  } catch (error) {
    const body = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    console.error(`Benchmark failed at ${page.url()}`);
    if (body) console.error(body.slice(0, 2_000));
    if (errors.length) console.error(errors.join('\n'));
    throw error;
  } finally {
    await browser.close();
  }
};

await main();
