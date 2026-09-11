<script lang="ts">
  import { IconTemporalChildWorkflow } from '$lib/io/icon';

  type Props = {
    expanded: boolean;
  };

  let { expanded }: Props = $props();
</script>

<span class="relative inline-flex h-3.5 w-3.5" aria-hidden="true">
  <IconTemporalChildWorkflow class="h-3.5 w-3.5" />
  <span
    class="absolute -bottom-0.5 -right-0.5 flex h-2 w-2 items-center justify-center rounded-full border border-current bg-[rgb(var(--color-surface-primary))] text-[8px] font-bold leading-none"
    >{expanded ? '−' : '+'}</span
  >
</span>
