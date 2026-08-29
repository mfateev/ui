<script lang="ts">
  import { translate } from '$lib/i18n/translate';
  import type { WorkflowExecution } from '$lib/types/workflows';
  import type { WorkflowStatus } from '$lib/types/workflows';
  import { isWorkflowDelayed } from '$lib/utilities/delayed-workflows';
  import { getWorkflowStatusLabel } from '$lib/utilities/get-status-label';

  import { GUTTER, ROW_HEIGHT } from './constants';
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

  const accessibleName = $derived(
    translate('workflows.chain-row-accessible-name', {
      workflowId: workflow.id,
      runId,
      status: getWorkflowStatusLabel(status),
    }),
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
    {#if lineBounds.width >= 160}
      <span
        class="absolute max-w-36 -translate-x-1/2 truncate rounded bg-primary/80 px-1 font-mono text-xs text-secondary"
        style:left={`${lineBounds.left + lineBounds.width / 2}px`}
        style:top={`${centerY - 22}px`}
        title={runId}
      >
        {runId}
      </span>
    {/if}
  {/if}
  {#each [geometry.startDotPx, geometry.endDotPx].filter((point) => point !== null) as pointX, pointIndex (pointIndex)}
    {@const dotBounds = dotBox(pointX, centerY)}
    <div
      class="absolute h-[var(--dot)] w-[var(--dot)] rounded-[var(--dot-r)] border-2 border-solid"
      class:timeline-live-edge-anchor={workflowIsLive &&
        pointX === geometry.endDotPx}
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
