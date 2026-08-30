# Workflow Containment Frames in the Timeline

## Status

Phase 1 design-ready.

Phase 1 represents the loaded workflow chain and each execution run as
containment frames around their action rows. Recursive child-workflow frames,
child-history loading, workflow-frame interaction, and collapse controls are
future enhancements and are not part of the initial implementation.

The design builds on the existing fixed horizontal time window and smooth
follow-live motion. It does not replace the timeline scale, viewport, event-row
geometry, row pooling, or lines-and-dots visual language.

An animated static prototype of the broader recursive concept is available at
[`prototypes/workflow-containment/option-c-horizontal-window.html`](../prototypes/workflow-containment/option-c-horizontal-window.html).
It uses a capture of the running Temporal UI as its page template. The prototype
is directional; Phase 1 is limited to the chain and run frames defined here.

## Problem

The timeline currently renders every workflow run as a horizontal row alongside
activities, timers, signals, and other actions. This makes a run appear to be
another action rather than the execution that owns and coordinates those
actions.

The timeline can also retain related runs produced by continue-as-new, retry,
reset, or cron transitions. Those runs currently share one row position while
their action groups are flattened into the timeline, so their ownership is not
visible.

The broader design should eventually support child workflows recursively, but
Phase 1 first establishes correct containment for the root workflow chain and
its runs.

## Phase 1 Model

Phase 1 has two containment levels:

```text
Workflow chain: <workflow ID>
├── Run: <run ID>
│   └── actions owned by that run
├── Run: <run ID>
│   └── actions owned by that run
└── Run: <run ID>
    └── actions owned by that run
```

The outer frame represents the related execution chain currently retained by
the timeline, not every execution that has ever reused the same workflow ID.
Only runs already identified by the chain session belong inside it.

Each run is a sibling inside the chain and contains only its own event groups.
A run is never nested inside its predecessor or successor.

When the timeline contains only one run, the coincident chain and run frames are
rendered as one run frame. This avoids a double border with identical horizontal
and vertical bounds. When two or more runs are retained, both the outer chain
frame and the sibling run frames are rendered.

## Visual Model

### Frame

Frames remain visually lighter than the actions they contain:

| Property             | Phase 1 treatment                                                           |
| -------------------- | --------------------------------------------------------------------------- |
| Border               | 1–2 px                                                                      |
| Corner radius        | Small, consistent with timeline dots and highlights                         |
| Background           | Transparent or a 2–4% status tint                                           |
| Running              | Status-colored dashed border                                                |
| Completed            | Solid completed-status border                                               |
| Failed or terminated | Solid failure-status border                                                 |
| Start and end        | Existing workflow dots at the top corners when the real boundary is visible |

The chain frame uses the active or final run's status. Each run frame uses that
run's own status. Status differences may distinguish sibling runs, but sibling
position communicates their relationship.

The frame background and border sit behind event bars, dots, labels, hit
targets, and open detail panels. Phase 1 frames use `pointer-events: none` and do
not change event-row clickability.

### Labels

Phase 1 preserves the current run label:

```text
<run ID>
```

When the outer chain frame is present, its label is the workflow ID. Run labels
remain unchanged; workflow type, summary, status, abbreviated IDs, tooltips, and
copy actions are deferred label enhancements.

Labels clamp to the visible fragment of their own frame. If a visible fragment
is too narrow for a useful label, the label is hidden rather than reduced to an
ambiguous fragment.

## Vertical Layout

### Run blocks

Rows belonging to one run form a contiguous vertical block. Runs are ordered by
start time using the selected timeline sort direction. Within each run, action
rows keep the selected sort direction.

The Phase 1 layout is therefore a shallow hierarchy rather than a recursive
tree:

1. Partition visible action groups by their existing `TimelineRun` ownership.
2. Order the run blocks by run start time.
3. Order each run's actions using the selected timeline sort direction.
4. Flatten the blocks for the existing constant-height row pool.
5. Derive each run frame's vertical bounds from the actual row positions of its
   flattened block.
6. Derive the chain frame's vertical bounds from all rendered run frames.

An open event-details panel remains part of the owning run's vertical span. The
panel's existing row displacement must also extend that run frame and the outer
chain frame.

### Minimum height

A run whose duration intersects the horizontal viewport remains visible even
when no owned action row is visible. It receives a compact empty block with a
minimum height of one `ROW_HEIGHT`.

The single-run frame and the multi-run outer chain frame also have a minimum
height of one `ROW_HEIGHT`. Empty blocks participate in sorting and timeline
height calculations so frames never overlap adjacent run blocks.

Temporary row-height retention used by the live fixed-window timeline remains
authoritative for the overall canvas height. Retained trailing space is not
assigned to a run frame after that run leaves the viewport; doing so would
visually transfer ownership. Frame spans use the current shallow layout, while
the canvas may temporarily retain unframed trailing space to prevent a vertical
jump.

No independent vertical scrolling region is introduced. The page continues to
scroll the timeline, and the existing row pool continues to mount only the
visible action rows.

## Horizontal Fixed-Window Behavior

The current timeline projects events into an intrinsic world coordinate system
and displays a fixed-width pixel viewport. While following a running workflow,
the visible world interval advances to keep the latest time at the right edge.
A request-animation-frame compositor offset moves timeline geometry smoothly to
the left between committed viewport updates.

Frames participate in that existing model and do not maintain a separate clock.

### Run geometry

Each run frame has a world-coordinate time range:

```text
runWorldStart = run start time projected to world pixels
runWorldEnd   = run close time, or the live edge while running
```

Its visible horizontal range is the intersection of the run range and viewport
range. Top and bottom edges are clipped to that intersection. A vertical side
and workflow dot are drawn only when the corresponding real run boundary is
inside the viewport. The viewport rail is never rendered as a run boundary.

### Chain geometry

The chain frame begins at the first run in the related execution chain and ends
at the last retained run. Its live end follows the active run.

Retention can remove predecessor runs. When the true first run is not retained:

- the chain's visible top and bottom edges extend to the left clip boundary;
- no start side or start dot is drawn; and
- the earliest retained run must not be presented as the chain's real start.

The chain's end side and end dot are drawn only when the final boundary is real
and visible. A running chain uses the same live dashed treatment as a running
run.

### Follow, pause, and completion

The existing viewport lifecycle remains authoritative:

- Following live advances frame geometry with the viewport.
- Pausing auto-refresh freezes the clock, viewport offset, frame motion, and
  live frame ends.
- Resuming returns to the latest right edge.
- Completing the active run anchors the viewport at its final edge unless the
  chain session hands off to a successor run.
- A successor run becomes a new sibling block; it does not reset or nest the
  retained predecessor frames.

## Filtering and Visibility

Event filters apply to action rows, not frame identity.

- A run frame is rendered when its duration intersects the horizontal viewport,
  whether or not any owned action row passes the current filters.
- A run with no visible action rows uses the one-row minimum empty block.
- A completed run frame and its empty block leave the layout together when the
  run duration no longer intersects the horizontal viewport.
- The outer chain frame remains while at least one retained run frame intersects
  the viewport.
- Filtering must not cause a row to move into a different run frame.

## Interaction and Accessibility

Phase 1 frames are informational and noninteractive.

- Frame backgrounds, borders, dots, and labels use `pointer-events: none`.
- Event bars and dots remain the only timeline selection targets.
- Existing event-group details, focus retention, and row-pool focus transfer are
  unchanged.
- Each rendered frame exposes a stable nonfocusable accessible identity with
  its workflow ID or run ID, status, and running or completed state.
- Frame semantics must not add every border segment or dot as a separate screen
  reader item.
- Reduced-motion preferences continue to disable nonessential entry animation.
  The viewport may still update discretely.

Interactive workflow details, canonical navigation, hover and focus styling,
copy actions, and frame-specific focus transfer are deferred.

## Implementation Direction

### Reuse

Phase 1 reuses the current timeline machinery:

- `TimelineRun` and its existing stable `timelineKey` ownership
- `timeline-scale.svelte.ts` for time-to-world projection
- `viewport.svelte.ts` for the fixed visible range and follow/freeze lifecycle
- `timeline-motion.ts` and `--timeline-frame-offset` for smooth leftward motion
- `viewport-geometry.ts` for range intersection and screen projection
- `timeline-positioning.ts` for actual row Y positions
- `timeline-row-height-retention.ts` for live height stability
- Existing status and dot colors
- Existing timeline icon definitions
- Existing row pooling and event focus transfer

### Replace the workflow row

`workflow-row.svelte` currently renders every retained run as a line at the same
Y position. Split that responsibility into:

1. Pure frame-range geometry for clipped horizontal sides and dots.
2. Pure shallow layout metadata for chain and sibling run vertical spans.
3. A background frame renderer behind the row pool.
4. A noninteractive label and border layer above the background but below action
   hit targets.

The existing workflow-row geometry tests are the starting coverage for
horizontal clipping. New tests cover chain boundary knowledge, vertical bounds,
minimum-height empty blocks, reverse sort, detail-panel displacement, and
multiple sibling runs.

### Phase 1 layout metadata

A suitable shallow model is:

```ts
type TimelineContainmentFrame = {
  kind: 'chain' | 'run';
  key: string;
  label: string;
  status: WorkflowStatus;
  runId?: string;
  startTimeMs: number;
  endTimeMs: number;
  startBoundaryKnown: boolean;
  endBoundaryKnown: boolean;
  rowStart: number;
  rowEnd: number;
  empty: boolean;
};
```

This metadata references existing groups and run entries; it does not copy
event payloads or introduce another event-history owner.

## Deferred Recursive Child Workflows

A future phase may render a child workflow with the same run-frame component and
place its actions recursively inside its parent workflow's frame. Root and child
workflow executions should have no intrinsic visual difference.

That phase must separately define:

- Whether the parent's child-workflow event group remains alongside the child
  frame or is represented by the frame.
- Recursive flattening and virtualization semantics.
- Bounded child-history buffers, traversal, polling, eviction, and cancellation.
- Partial loading, visibility-query capability, authorization, and error states.
- Workflow-frame interaction and focus behavior.
- Density controls and optional subtree collapse.

None of those concerns should be introduced into the Phase 1 chain/run layout.

## Incremental Delivery

### Phase 1: Root chain and run frames

- Replace the current workflow lines with one run frame for a single run.
- Render an outer workflow-chain frame and sibling run frames when multiple runs
  are retained.
- Preserve run-ID labels and add the workflow-ID chain label.
- Add minimum-height empty run blocks.
- Keep frames informational and noninteractive.
- Implement fixed-window clipping, label clamping, pause/resume, successor-run
  handoff, filtering, and status styling.
- Preserve constant-height action-row pooling and large-history performance.

### Future: Recursive child frames

- Resolve child event-group representation.
- Introduce a bounded recursive execution and layout model.
- Load child histories and connect their live lifecycles.
- Add workflow-frame interaction, navigation, accessibility, and optional
  density controls.

## Phase 1 Test Matrix

At minimum, automated coverage includes:

- Single run renders one frame rather than coincident chain and run frames
- Multiple related runs render sibling run frames inside one chain frame
- Continue-as-new, retry, reset, and cron successor handoff
- Each run frame contains only rows owned by that run
- Ascending and descending run-block and local-row ordering
- Running and completed frames younger and older than the visible window
- Completed retained run clipped left and leaving left
- Unknown chain start after retention does not render a false side or dot
- Active run completion while following live
- Status colors for completed, failed, continued-as-new, canceled, timed out,
  terminated, paused, and running
- Run-ID and workflow-ID label clamping and hiding in narrow fragments
- A run with no visible actions receives one minimum-height block
- Event filtering preserves run identity and minimum frame height
- Open event details extend the owning run and chain frame
- Pause, resume, reduced motion, and successor-run entry
- Frame layers do not block action hit targets
- Row pooling and vertical page virtualization remain bounded
- Large histories and the maximum retained run count do not regress performance

## Decision Summary

Phase 1 introduces a shallow containment model:

- The loaded related execution chain is the outer workflow-ID containment.
- Individual runs are sibling run-ID containments.
- Each run contains only its own actions.
- A single run uses one frame rather than two coincident frames.
- Every visible frame has at least one row of height.
- Labels remain workflow ID for the chain and the current run ID for runs.
- Frames are informational and noninteractive.
- Recursive child workflows and their data lifecycle are deferred.

The Phase 1 design succeeds if users can understand, without a legend, which
actions belong to each retained run and which runs form the currently loaded
workflow chain.
