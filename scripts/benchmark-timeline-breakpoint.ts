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

import {
  createTimelineStressFixture,
  type TimelineStressFixture,
} from '../tests/test-utilities/timeline-stress-fixture';

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
const preset = process.env.TIMELINE_BREAKPOINT_PRESET ?? 'full';
const quickPreset = preset === 'quick';
const massivePreset = preset === 'massive';
const virtualizationDisabled =
  process.env.TIMELINE_BREAKPOINT_DISABLE_VIRTUALIZATION === '1';
const requestedRowType = process.env.TIMELINE_BREAKPOINT_ROW_TYPE;
if (
  requestedRowType !== undefined &&
  requestedRowType !== 'marker' &&
  requestedRowType !== 'activity'
) {
  throw new Error(
    'TIMELINE_BREAKPOINT_ROW_TYPE must be "marker" or "activity".',
  );
}
const rowType =
  requestedRowType ?? (virtualizationDisabled ? 'activity' : 'marker');
if (!quickPreset && !massivePreset && preset !== 'full') {
  throw new Error(
    'TIMELINE_BREAKPOINT_PRESET must be "quick", "full", or "massive".',
  );
}
const runCount = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_RUNS',
  massivePreset ? 256 : quickPreset ? 16 : 32,
  256,
);
const maximumRows = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_ROWS',
  massivePreset ? 500_000 : quickPreset ? 24_000 : 50_000,
  500_000,
);
const rowsPerRun = Math.max(1, Math.floor(maximumRows / runCount));
const maximumZoomLevels = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_ZOOMS',
  quickPreset || massivePreset ? 1 : 10,
  12,
);
const maximumRuntimeMs = numberFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_RUNTIME_MS',
  massivePreset ? 240_000 : 120_000,
);
const maximumNodeRssBytes =
  numberFromEnvironment('TIMELINE_BREAKPOINT_MAX_NODE_RSS_MB', 1_500) *
  1024 *
  1024;
const maximumBrowserHeapBytes =
  numberFromEnvironment('TIMELINE_BREAKPOINT_MAX_BROWSER_HEAP_MB', 1_200) *
  1024 *
  1024;
const maximumRenderedElements = integerFromEnvironment(
  'TIMELINE_BREAKPOINT_MAX_RENDERED_ELEMENTS',
  200_000,
  1_000_000,
);
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
    (quickPreset
      ? '../.agent-artifacts/timeline-breakpoint-quick.json'
      : massivePreset
        ? '../.agent-artifacts/timeline-breakpoint-500k.json'
        : '../.agent-artifacts/timeline-breakpoint-benchmark.json'),
);
const cpuProfilePath = process.env.TIMELINE_BREAKPOINT_CPU_PROFILE
  ? resolve(process.env.TIMELINE_BREAKPOINT_CPU_PROFILE)
  : undefined;
const quickTargetDurationMs = 15 * 60_000;

const fixture = createTimelineStressFixture({
  runCount,
  rowsPerRun,
  runDurationMs: 60_000,
  startTimeMs: Date.now() - runCount * 60_000,
  rowType,
});
const scrollChurnFixture = createTimelineStressFixture({
  workflowId: 'timeline-scroll-churn-chain',
  runCount: 24,
  rowsPerRun: 10,
  runDurationMs: 60_000,
  startTimeMs: Date.now() - 24 * 60_000,
});

type TimelineDomStats = {
  logicalRows: number;
  logicalPoints: number;
  availableRows: number;
  presentationComplete: boolean;
  modelReady: boolean;
  sceneReady: boolean;
  entryPresentationPending: boolean;
  mountedRows: number;
  renderedLines: number;
  renderedElements: number;
  updateMs: number;
  updateP95Ms: number;
  updateSamples: number;
  updateSequence: number;
};

type RowPresentationSample = {
  atMs: number;
  presentedRows: number;
  availableRows: number;
  complete: boolean;
  sceneRevision: number;
};

type LongTaskSample = {
  startTime: number;
  duration: number;
};

type ScrollStats = {
  container: string;
  distancePx: number;
  frames: number;
  p95FrameMs: number;
  maximumFrameMs: number;
  slowFrames: number;
  blankFrames: number;
  minimumVisibleRows: number;
  blankFrameRatios: number[];
};

type LevelResult = TimelineDomStats &
  ScrollStats & {
    duration: string;
    durationMs: number;
    settleMs: number;
    settleTimedOut: boolean;
    compilationLongestTaskMs: number;
    compilationLongTasks: LongTaskSample[];
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
      logicalPoints: element.getAttribute('data-logical-point-count'),
      availableRows: element.getAttribute('data-available-row-count'),
      presentationComplete: element.getAttribute(
        'data-row-presentation-complete',
      ),
      modelReady: element.getAttribute('data-model-ready'),
      sceneReady: element.getAttribute('data-scene-ready'),
      entryPresentationPending: Boolean(
        element.querySelector(
          '.timeline-row-entry-pending, .timeline-frame-entry-pending, .timeline-rows-animating',
        ),
      ),
      mountedRows: element.getAttribute('data-mounted-row-count'),
      renderedLines: element.getAttribute('data-rendered-line-count'),
      renderedElements: element.getAttribute('data-rendered-element-count'),
      updateMs: element.getAttribute('data-update-ms'),
      updateP95Ms: element.getAttribute('data-update-p95-ms'),
      updateSamples: element.getAttribute('data-update-sample-count'),
      updateSequence: element.getAttribute('data-update-sequence'),
    }));
  return {
    logicalRows: Number(attributes.logicalRows ?? 0),
    logicalPoints: Number(attributes.logicalPoints ?? 0),
    availableRows: Number(attributes.availableRows ?? 0),
    presentationComplete: attributes.presentationComplete === 'true',
    modelReady: attributes.modelReady === 'true',
    sceneReady: attributes.sceneReady === 'true',
    entryPresentationPending: attributes.entryPresentationPending,
    mountedRows: Number(attributes.mountedRows ?? 0),
    renderedLines: Number(attributes.renderedLines ?? 0),
    renderedElements: Number(attributes.renderedElements ?? 0),
    updateMs: Number(attributes.updateMs ?? 0),
    updateP95Ms: Number(attributes.updateP95Ms ?? 0),
    updateSamples: Number(attributes.updateSamples ?? 0),
    updateSequence: Number(attributes.updateSequence ?? 0),
  };
};

const waitForTimelineToSettle = async (
  page: Page,
  activeRequests: () => number,
  timeoutMs = 8_000,
): Promise<{
  stats: TimelineDomStats;
  settleMs: number;
  settleTimedOut: boolean;
}> => {
  const startedAt = performance.now();
  let lastSequence = -1;
  let stableSince = performance.now();
  let stats = await readTimelineStats(page);
  while (performance.now() - startedAt < timeoutMs) {
    stats = await readTimelineStats(page);
    const requests = activeRequests();
    if (
      stats.updateSequence !== lastSequence ||
      requests > 0 ||
      !stats.modelReady ||
      !stats.sceneReady ||
      !stats.presentationComplete ||
      stats.entryPresentationPending
    ) {
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

const scrollBrowserWindow = async (
  page: Page,
  { dynamicFrames = 0 }: { dynamicFrames?: number } = {},
): Promise<ScrollStats> =>
  page.evaluate(
    async ({ dynamicFrames }) => {
      const segmentedTimeline = document.querySelector<HTMLElement>(
        '#event-history-timeline-graph[data-segmented-scroll]',
      );
      const container =
        segmentedTimeline ??
        document.querySelector<HTMLElement>('#content-wrapper');
      const scrollTarget = container ?? document.scrollingElement;
      if (!scrollTarget)
        throw new Error('No browser scroll container was found.');
      const initialMaximumScroll = Math.max(
        0,
        scrollTarget.scrollHeight - scrollTarget.clientHeight,
      );
      const frameDurations: number[] = [];
      const positions = dynamicFrames
        ? Array.from({ length: dynamicFrames }, (_, index) => {
            const phase = (index % 24) / 12;
            return phase <= 1 ? phase : 2 - phase;
          })
        : Array.from({ length: 25 }, (_, index) => index / 24).concat(
            Array.from({ length: 24 }, (_, index) => (23 - index) / 24),
          );
      let blankFrames = 0;
      const blankFrameRatios: number[] = [];
      let minimumVisibleRows = Number.POSITIVE_INFINITY;
      for (const positionRatio of positions) {
        const maximumScroll = Math.max(
          0,
          scrollTarget.scrollHeight - scrollTarget.clientHeight,
        );
        scrollTarget.scrollTop = Math.round(maximumScroll * positionRatio);
        const frameStartedAt = performance.now();
        await new Promise<void>((resolveFrame) =>
          requestAnimationFrame((frameTime) => {
            frameDurations.push(frameTime - frameStartedAt);
            resolveFrame();
          }),
        );
        const timeline = document.querySelector<HTMLElement>(
          '#event-history-timeline-graph',
        );
        if (!timeline) continue;
        const timelineRect = timeline.getBoundingClientRect();
        const viewportRect = segmentedTimeline
          ? timelineRect
          : container
            ? container.getBoundingClientRect()
            : {
                top: 0,
                bottom: window.innerHeight,
              };
        const visibleTop = Math.max(timelineRect.top, viewportRect.top);
        const visibleBottom = Math.min(
          timelineRect.bottom,
          viewportRect.bottom,
        );
        if (
          visibleBottom - visibleTop < 24 ||
          Number(timeline.dataset.logicalRowCount ?? 0) === 0
        ) {
          continue;
        }
        const visibleRows = Array.from(
          timeline.querySelectorAll<HTMLElement>(
            'ul > li[data-timeline-entry-key]',
          ),
        ).filter((row) => {
          const style = getComputedStyle(row);
          const rect = row.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.bottom > visibleTop &&
            rect.top < visibleBottom
          );
        }).length;
        minimumVisibleRows = Math.min(minimumVisibleRows, visibleRows);
        if (visibleRows === 0) {
          blankFrames += 1;
          blankFrameRatios.push(positionRatio);
        }
        await new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => resolveFrame()),
        );
      }
      const sorted = [...frameDurations].sort((left, right) => left - right);
      const p95Index = Math.min(
        sorted.length - 1,
        Math.ceil(sorted.length * 0.95) - 1,
      );
      return {
        container: segmentedTimeline
          ? '#event-history-timeline-graph'
          : container
            ? '#content-wrapper'
            : 'document',
        distancePx: Math.max(
          initialMaximumScroll,
          scrollTarget.scrollHeight - scrollTarget.clientHeight,
        ),
        frames: frameDurations.length,
        p95FrameMs: sorted[p95Index] ?? 0,
        maximumFrameMs: Math.max(0, ...frameDurations),
        slowFrames: frameDurations.filter((duration) => duration > 34).length,
        blankFrames,
        minimumVisibleRows: Number.isFinite(minimumVisibleRows)
          ? minimumVisibleRows
          : 0,
        blankFrameRatios,
      };
    },
    { dynamicFrames },
  );

const fulfillHistory = async (
  route: Route,
  targetFixture: TimelineStressFixture,
): Promise<void> => {
  const url = new URL(route.request().url());
  const runId = url.searchParams.get('execution.runId');
  if (!runId) throw new Error(`History request has no run ID: ${url}`);
  const maximumPageSize = Number(
    url.searchParams.get('maximumPageSize') ?? 1_000,
  );
  const page = targetFixture.historyPage(
    runId,
    url.pathname.endsWith('/history-reverse') ? 'descending' : 'ascending',
    maximumPageSize,
    url.searchParams.get('nextPageToken') ??
      url.searchParams.get('next_page_token'),
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

const installFixtureRoutes = async (
  page: Page,
  targetFixture: TimelineStressFixture,
  delayMs = 0,
): Promise<void> => {
  const delay = async (): Promise<void> => {
    if (delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  };
  await page.route(
    new RegExp(
      `/api/v1/namespaces/[^/]+/workflows/${targetFixture.workflowId}/history(?:-reverse)?\\?`,
    ),
    async (route) => {
      await delay();
      await fulfillHistory(route, targetFixture);
    },
  );
  await page.route(
    new RegExp(
      `/api/v1/namespaces/[^/]+/workflows/${targetFixture.workflowId}/latest-execution(?:\\?.*)?$`,
    ),
    async (route) => {
      await delay();
      await route.fulfill({
        json: {
          workflowId: targetFixture.workflowId,
          runId: targetFixture.currentRunId,
          firstExecutionRunId: targetFixture.firstRunId,
        },
      });
    },
  );
  await page.route(
    new RegExp(
      `/api/v1/namespaces/[^/]+/workflows/${targetFixture.workflowId}(?:\\?.*)?$`,
    ),
    async (route) => {
      await delay();
      const url = new URL(route.request().url());
      const runId =
        url.searchParams.get('execution.runId') ?? targetFixture.currentRunId;
      await route.fulfill({ json: targetFixture.workflowResponse(runId) });
    },
  );
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
  let cpuProfilerRunning = false;
  let cpuProfilePerformanceNow = 0;
  let layoutChurnScroll: ScrollStats | null = null;
  const benchmarkWorkflowIds = [
    fixture.workflowId,
    scrollChurnFixture.workflowId,
  ];

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
    if (
      !benchmarkWorkflowIds.some((workflowId) =>
        request.url().includes(`/workflows/${workflowId}`),
      )
    ) {
      return;
    }
    activeApiRequests += 1;
    peakApiRequests = Math.max(peakApiRequests, activeApiRequests);
  });
  const finishRequest = (url: string) => {
    if (
      !benchmarkWorkflowIds.some((workflowId) =>
        url.includes(`/workflows/${workflowId}`),
      )
    ) {
      return;
    }
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
    await installFixtureRoutes(page, fixture);
    await installFixtureRoutes(page, scrollChurnFixture, 20);
    await page.addInitScript(() => {
      const longTasks: LongTaskSample[] = [];
      Object.defineProperty(window, '__timelineBreakpointLongTasks', {
        configurable: true,
        value: longTasks,
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ entryTypes: ['longtask'] });
    });
    await page.addInitScript(`
      Object.defineProperty(window, '__timelineRowPresentationSamples', {
        configurable: true,
        value: [],
      });
      let lastRowPresentation = '';
      new MutationObserver(() => {
        const timeline = document.querySelector(
          '#event-history-timeline-graph',
        );
        if (!timeline) return;
        const sample = {
          atMs: performance.now(),
          presentedRows: Number(timeline.dataset.logicalRowCount || 0),
          availableRows: Number(timeline.dataset.availableRowCount || 0),
          complete: timeline.dataset.rowPresentationComplete === 'true',
          sceneRevision: Number(timeline.dataset.sceneRevision || 0),
        };
        const key = [
          sample.presentedRows,
          sample.availableRows,
          sample.complete,
          sample.sceneRevision,
        ].join(':');
        if (key === lastRowPresentation) return;
        lastRowPresentation = key;
        window.__timelineRowPresentationSamples.push(sample);
      }).observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: [
          'data-logical-row-count',
          'data-available-row-count',
          'data-row-presentation-complete',
          'data-scene-revision',
        ],
      });
    `);

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    await session.send('HeapProfiler.enable');
    const scrollChurnUrl = `${baseUrl}/namespaces/default/workflows/${scrollChurnFixture.workflowId}/${scrollChurnFixture.firstRunId}/timeline?follow_continues=on`;
    await page.goto(scrollChurnUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page
      .getByRole('region', { name: 'Timeline' })
      .waitFor({ timeout: 20_000 });
    const scrollChurnFullDuration = page.getByTestId('timeline-full-duration');
    await scrollChurnFullDuration.waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    await waitForButtonEnabled(scrollChurnFullDuration, 20_000);
    await scrollChurnFullDuration.click();
    await page
      .locator('#event-history-timeline-graph ul > li[data-timeline-entry-key]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    await waitForTimelineToSettle(page, () => activeApiRequests);
    layoutChurnScroll = await scrollBrowserWindow(page, {
      dynamicFrames: 90,
    });
    console.log(
      `live layout scroll | p95 ${layoutChurnScroll.p95FrameMs.toFixed(1)} ms | blank frames ${layoutChurnScroll.blankFrames}`,
    );

    const timelineUrl = `${baseUrl}/namespaces/default/workflows/${fixture.workflowId}/${fixture.firstRunId}/timeline?follow_continues=on&timeline_instrumentation=on${virtualizationDisabled ? '&timeline_virtualization=off' : ''}`;
    await page.goto(timelineUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page
      .getByRole('region', { name: 'Timeline' })
      .waitFor({ timeout: 20_000 });
    const fullDuration = page.getByTestId('timeline-full-duration');
    await fullDuration.waitFor({ state: 'visible', timeout: 20_000 });
    await waitForButtonEnabled(fullDuration, 20_000);

    const zoomIn = page.getByTestId('timeline-zoom-in');
    for (
      let attempt = 0;
      attempt < 12 && (await zoomIn.isEnabled());
      attempt += 1
    ) {
      await zoomIn.click();
    }

    if (cpuProfilePath) {
      await session.send('Profiler.enable');
      cpuProfilePerformanceNow = await page.evaluate(() => performance.now());
      await session.send('Profiler.start');
      cpuProfilerRunning = true;
    }

    const zoomOut = page.getByTestId('timeline-zoom-out');
    const durationLabel = page.getByTestId('timeline-window-duration');
    if (massivePreset) {
      await fullDuration.click();
      await page.waitForTimeout(25);
    } else if (quickPreset) {
      const timeline = page.getByRole('region', { name: 'Timeline' });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const durationMs = Number(
          await timeline.getAttribute('data-window-duration-ms'),
        );
        if (durationMs >= quickTargetDurationMs) break;
        if (!(await zoomOut.isEnabled())) break;
        const previousDuration =
          (await durationLabel.textContent())?.trim() ?? '';
        await zoomOut.click();
        await waitForTextChange(durationLabel, previousDuration, 3_000);
        await page.waitForTimeout(25);
      }
    }
    for (let level = 0; level < maximumZoomLevels; level += 1) {
      if (performance.now() - startedAt >= maximumRuntimeMs) {
        stoppedByGuard = `runtime exceeded ${maximumRuntimeMs} ms`;
        break;
      }

      await page.evaluate(() => {
        const values = (
          window as typeof window & {
            __timelineBreakpointLongTasks: LongTaskSample[];
          }
        ).__timelineBreakpointLongTasks;
        values.length = 0;
      });
      const { stats, settleMs, settleTimedOut } = await waitForTimelineToSettle(
        page,
        () => activeApiRequests,
        massivePreset ? maximumRuntimeMs : 8_000,
      );
      const compilationLongTasks = await page.evaluate(() => {
        const values = (
          window as typeof window & {
            __timelineBreakpointLongTasks: LongTaskSample[];
          }
        ).__timelineBreakpointLongTasks;
        const samples = [...values];
        values.length = 0;
        return samples;
      });
      const compilationLongestTaskMs = Math.max(
        0,
        ...compilationLongTasks.map(({ duration }) => duration),
      );
      const scroll = settleTimedOut
        ? {
            container: '#content-wrapper',
            distancePx: 0,
            frames: 0,
            p95FrameMs: 0,
            maximumFrameMs: 0,
            slowFrames: 0,
            blankFrames: 0,
            minimumVisibleRows: 0,
            blankFrameRatios: [],
          }
        : await scrollBrowserWindow(page);
      const longestTaskMs = await page.evaluate(() =>
        Math.max(
          0,
          ...(
            window as typeof window & {
              __timelineBreakpointLongTasks: LongTaskSample[];
            }
          ).__timelineBreakpointLongTasks.map(({ duration }) => duration),
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
      if (compilationLongestTaskMs >= longTaskLimitMs) {
        degradedReasons.push(
          `compilation task ${compilationLongestTaskMs.toFixed(1)} ms`,
        );
      }
      const breakpointReasons: string[] = [];
      if (settleTimedOut) {
        breakpointReasons.push(
          `timeline did not settle within ${massivePreset ? maximumRuntimeMs / 1_000 : 8} seconds`,
        );
      }
      if (stats.updateP95Ms >= hardUpdateP95LimitMs) {
        breakpointReasons.push(`update p95 ${stats.updateP95Ms.toFixed(1)} ms`);
      }
      if (scroll.p95FrameMs >= hardScrollP95LimitMs) {
        breakpointReasons.push(
          `scroll frame p95 ${scroll.p95FrameMs.toFixed(1)} ms`,
        );
      }
      if (scroll.blankFrames > 0) {
        breakpointReasons.push(`${scroll.blankFrames} blank scroll frames`);
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
        compilationLongestTaskMs,
        compilationLongTasks,
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
        `${duration.padStart(4)} | ${String(stats.logicalPoints).padStart(6)} points / ${String(stats.logicalRows).padStart(6)} rows | update p95 ${stats.updateP95Ms.toFixed(1).padStart(5)} ms | scroll p95 ${scroll.p95FrameMs.toFixed(1).padStart(5)} ms | heap ${(browserHeapBytes / 1024 / 1024).toFixed(0).padStart(4)} MB${breakpointReasons.length ? ` | BREAK: ${breakpointReasons.join(', ')}` : degradedReasons.length ? ` | degraded: ${degradedReasons.join(', ')}` : ''}`,
      );

      if (breakpointReasons.length) {
        breakpoint = result;
        break;
      }
      if (browserHeapBytes >= maximumBrowserHeapBytes) {
        stoppedByGuard = `browser heap reached ${(browserHeapBytes / 1024 / 1024).toFixed(0)} MB`;
        break;
      }
      if (stats.renderedElements >= maximumRenderedElements) {
        stoppedByGuard = `rendered DOM reached ${stats.renderedElements} elements`;
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

    if (cpuProfilePath && cpuProfilerRunning) {
      const { profile } = (await session.send('Profiler.stop')) as {
        profile: Record<string, unknown>;
      };
      profile.timelinePerformanceNowAtStart = cpuProfilePerformanceNow;
      cpuProfilerRunning = false;
      await mkdir(dirname(cpuProfilePath), { recursive: true });
      await writeFile(cpuProfilePath, JSON.stringify(profile));
      console.log(`CPU profile: ${cpuProfilePath}`);
    }

    const report = {
      preset,
      virtualizationDisabled,
      generated: {
        runs: fixture.runs.length,
        rowsPerRun,
        totalRows: fixture.totalRows,
        rowType: fixture.runs[0].rowType,
      },
      limits: {
        maximumRows,
        maximumZoomLevels,
        maximumRuntimeMs,
        maximumNodeRssBytes,
        maximumBrowserHeapBytes,
        maximumRenderedElements,
        updateP95LimitMs,
        scrollP95LimitMs,
        longTaskLimitMs,
        hardUpdateP95LimitMs,
        hardScrollP95LimitMs,
        hardLongTaskLimitMs,
      },
      peakApiRequests,
      rowPresentationSamples: await page.evaluate(
        () =>
          (
            window as typeof window & {
              __timelineRowPresentationSamples: RowPresentationSample[];
            }
          ).__timelineRowPresentationSamples,
      ),
      layoutChurnScroll,
      layoutChurnBreakpoint:
        layoutChurnScroll && layoutChurnScroll.blankFrames > 0
          ? `${layoutChurnScroll.blankFrames} blank scroll frames`
          : null,
      firstDegraded,
      breakpoint,
      stoppedByGuard,
      maximumTestedRows: Math.max(
        0,
        ...results.map(({ logicalRows }) => logicalRows),
      ),
      maximumTestedPoints: Math.max(
        0,
        ...results.map(({ logicalPoints }) => logicalPoints),
      ),
      elapsedMs: performance.now() - startedAt,
      errors,
      results,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${outputPath}`);
    const screenshotPath = outputPath.replace(/\.json$/, '.png');
    await page.screenshot({ path: screenshotPath });
    console.log(
      `${breakpoint || stoppedByGuard ? 'Breakpoint' : 'Final'} screenshot: ${screenshotPath}`,
    );
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
