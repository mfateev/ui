<script lang="ts">
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowExecution } from '$lib/types/workflows';
  import type { WorkflowStatus } from '$lib/types/workflows';
  import { isWorkflowDelayed } from '$lib/utilities/delayed-workflows';
  import { getWorkflowStatusLabel } from '$lib/utilities/get-status-label';

  import { GUTTER, RADIUS, ROW_HEIGHT } from './constants';
  import { dotBox, lineBox } from './primitives';
  import { dotColors, strokeColor } from '../colors';
  import { getWorkflowRowGeometry } from './workflow-row-geometry';

  interface Props {
    workflow: WorkflowExecution;
    canvasWidth: number;
    y: number;
    startWorldPx: number;
    endWorldPx: number;
    viewportOffsetPx: number;
    runId?: string;
    status?: WorkflowStatus;
    live?: boolean;
  }

  let {
    workflow,
    canvasWidth,
    y,
    startWorldPx,
    endWorldPx,
    viewportOffsetPx,
    runId = workflow.runId,
    status = workflow.status,
    live = workflow.isRunning || workflow.isPaused,
  }: Props = $props();

  const centerY = ROW_HEIGHT / 2;

  const geometry = $derived(
    getWorkflowRowGeometry({
      startWorldPx,
      endWorldPx,
      viewportOffsetPx,
      viewportWidthPx: canvasWidth - 2 * GUTTER,
      gutterPx: GUTTER,
      live,
    }),
  );
  const lineBounds = $derived(
    geometry.line
      ? lineBox(
          [geometry.line.startPx, centerY],
          [geometry.line.endPx, centerY],
        )
      : null,
  );
  const color = $derived(
    strokeColor({
      status,
      delayed: isWorkflowDelayed(workflow),
    }),
  );
  const colors = $derived(dotColors(status));
  const workflowIsLive = $derived(live);
  let labelWidth = $state(0);

  const startScreenPx = $derived(startWorldPx - viewportOffsetPx + GUTTER);
  const endScreenPx = $derived(endWorldPx - viewportOffsetPx + GUTTER);
  const labelIconOffset = 2 * RADIUS;
  const labelSafeInset = GUTTER + 1.5 * RADIUS;
  const labelLeft =
    'clamp(var(--workflow-label-attached-left), calc(var(--workflow-label-safe-inset) + var(--timeline-frame-offset, 0px)), var(--workflow-label-end-attached-left))';
  const labelAttachedLeft = $derived(startScreenPx + labelIconOffset);
  const labelEndAttachedLeft = $derived(
    endScreenPx - labelWidth - labelIconOffset,
  );

  const accessibleName = $derived(
    translate('workflows.chain-row-accessible-name', {
      workflowId: workflow.id,
      runId,
      status: getWorkflowStatusLabel(status),
    }),
  );

  const visibleDotPoints = $derived(
    [
      geometry.startDotPx,
      geometry.endDotPx === geometry.startDotPx ? null : geometry.endDotPx,
    ].filter((point): point is number => point !== null),
  );
</script>

<!-- Informational bar, not interactive → role="img"; pointer-events-none keeps
     the collapse toggles below clickable. -->
<div
  role="img"
  aria-label={accessibleName}
  title={runId}
  class="pointer-events-none absolute inset-x-0 outline-none"
  style:top="{y - centerY}px"
  style:height="{ROW_HEIGHT}px"
>
  {#if lineBounds}
    <div
      class="tl-line absolute"
      class:tl-line--dashed={workflowIsLive}
      class:tl-line--animate={workflowIsLive}
      class:tl-line--live={workflowIsLive}
      class:tl-line--viewport-clipped-start={workflowIsLive &&
        startWorldPx < viewportOffsetPx}
      style:left="{lineBounds.left}px"
      style:top="{lineBounds.top}px"
      style:width="{workflowIsLive ? canvasWidth : lineBounds.width}px"
      style:height="{lineBounds.height}px"
      style:--tl-line-color={color}
      style:--tl-live-committed-width="{lineBounds.width}px"
    ></div>
    <span
      class="workflow-run-label absolute z-10 inline-flex min-h-[var(--dot)] -translate-y-1/2 items-center truncate whitespace-nowrap rounded-full bg-[rgb(var(--color-surface-primary))] px-1.5 text-[13px] leading-none text-current"
      style:left={labelLeft}
      style:top={`${centerY}px`}
      style:max-width={`${Math.max(0, canvasWidth - 2 * labelSafeInset)}px`}
      style:--workflow-label-attached-left={`${labelAttachedLeft}px`}
      style:--workflow-label-safe-inset={`${labelSafeInset}px`}
      style:--workflow-label-end-attached-left={`${labelEndAttachedLeft}px`}
      title={runId}
      bind:clientWidth={labelWidth}
    >
      {runId}
    </span>
  {/if}
  {#each visibleDotPoints as pointX (pointX)}
    {@const dotBounds = dotBox(pointX, centerY)}
    <div
      class="absolute h-[var(--dot)] w-[var(--dot)] rounded-[var(--dot-r)] border-2 border-solid"
      style:left="{dotBounds.left}px"
      style:top="{dotBounds.top}px"
      style:border-color={colors.stroke}
      style:background={colors.fill}
    >
      <svg
        class="absolute left-1/2 top-1/2 h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 text-black"
        viewBox="0 0 24 24"><use href="#ti-workflow" /></svg
      >
    </div>
  {/each}
</div>
