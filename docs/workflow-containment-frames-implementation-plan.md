# Workflow Containment Frames: Phase 1 Implementation Plan

This plan implements the Phase 1 design in
[`nested-workflow-frames-design.md`](nested-workflow-frames-design.md): one frame
for a single run, or an outer workflow-chain frame containing sibling run
frames when the timeline retains multiple related runs.

Recursive child-workflow frames, child-history loading, workflow-frame
interaction, and collapse controls are out of scope.

## Invariants

The implementation must preserve these existing timeline properties:

- `TimelineRun` and `timelineKey` remain the source of run ownership.
- Event payloads remain owned by the existing grouped-event buffers.
- Action rows remain constant-height and vertically pooled.
- The fixed-window scale, viewport, pause/resume lifecycle, and compositor
  motion remain authoritative.
- Event rows and event-details panels retain their current interaction and focus
  behavior.
- Frame layers remain noninteractive and cannot block event or idle-collapse
  hit targets.
- Full-duration embedded timelines continue to work.

## 1. Lock Down Current Run Ownership

Add focused tests around the existing `timelineRuns` projection before changing
rendering.

Cover:

- A single active run maps every action group to its active run ID.
- Retained and active groups keep distinct `timelineKey` values even when their
  group IDs match.
- Retained runs stay ordered before the active run in ascending mode.
- Reverse sorting reverses run-block order and row order without changing group
  ownership.
- A successor handoff leaves the predecessor as a retained sibling.

Prefer extracting the current `timelineGroupEntries` construction from
`timeline-graph.svelte` into a pure helper if that makes the ownership tests
independent of Svelte rendering.

Completion criterion: tests establish that every rendered group has exactly one
run owner and that handoff never relabels predecessor groups.

## 2. Apply Event Filters Uniformly Per Run

Make the graph receive unfiltered active groups and apply event-type and status
filters to run-owned timeline entries in one place.

Today the active run's event-type filtering happens in
`workflow-timeline-layout.svelte`, while retained runs arrive with their full
group lists. That split would make retained and active frame contents disagree.

Implement these derived stages in `timeline-graph.svelte`, or in pure helpers
used by it:

```text
all run-owned entries
→ event-type filtered entries
→ status filtered entries
→ horizontally visible entries
```

Do not filter `TimelineRun` identity itself. A run whose duration intersects the
viewport remains available to the containment layout even when all its groups
are filtered out.

Completion criterion: the same filter hides equivalent active and retained
groups, while both runs retain their correct frame identity and minimum height.

## 3. Introduce a Shallow Containment Layout

Add a pure `timeline-containment-layout.ts` module with unit tests. It should
produce a flat action-row order plus frame spans; it must not create recursive
workflow structures or copy event payloads.

Suggested input:

```ts
type ContainmentLayoutInput = {
  runs: TimelineRun[];
  visibleEntries: TimelineGroupEntry[];
  participatingRunIds: ReadonlySet<string>;
  reverseSort: boolean;
  pendingGroupCount: number;
  descMinId: number;
};
```

Suggested output:

```ts
type TimelineLayoutRow =
  | { kind: 'group'; key: string; entry: TimelineGroupEntry }
  | { kind: 'empty-run'; key: string; runId: string };

type TimelineRunSpan = {
  runId: string;
  rowStart: number;
  rowEnd: number;
  empty: boolean;
};

type TimelineContainmentLayout = {
  rows: TimelineLayoutRow[];
  runSpans: TimelineRunSpan[];
  chainSpan: { rowStart: number; rowEnd: number } | null;
};
```

Requirements:

- `participatingRunIds` contains the runs whose duration intersects the
  viewport; other loaded runs consume no vertical space.
- Runs are ordered by start time in the selected direction.
- Group rows remain locally ordered inside their run.
- A participating run with no visible group receives exactly one
  `empty-run` row.
- Empty rows consume layout height but never mount `TimelineGraphRow`.
- Pending-history space belongs to the active run and cannot split or inflate a
  retained run frame.
- Existing scalar row-height retention may preserve trailing canvas space, but
  that space is not assigned to a run span after its rows leave the viewport.
  Do not visually transfer retained height to another run.
- The output uses stable keys based on run ID and existing `timelineKey` values.

Generalize `timeline-positioning.ts` only as much as necessary to position the
new flat row union and the pending-history gap. Keep closed-form window lookup;
do not replace it with a scan over all rows during scroll.

Completion criterion: pure tests cover one run, multiple runs, empty runs,
ascending and descending order, cursor gaps, duplicate group IDs across runs,
and stable output keys.

## 4. Add Run and Chain Visibility Metadata

Add a pure helper that converts `TimelineRun[]` and the viewport range into the
frame candidates consumed by the shallow layout.

For each run, derive:

- Projected start and end world pixels
- Whether its duration intersects the viewport
- Whether it is live
- Its own status and run-ID label
- Whether its start and end are real boundaries

For the chain, derive:

- Workflow-ID label
- Status from the active or final run
- Start at the real first run when retained
- End at the active or final retained run
- Live state from the active run
- `startBoundaryKnown = false` when the earliest rendered run is not the known
  first run in the chain

Pass the known chain-start run ID explicitly from `WorkflowRunContext.chainRunId`
to `TimelineGraph`; do not infer it from the earliest retained run. If the true
start is not retained, project the visible chain fragment from the viewport's
left edge and suppress its start side and dot.

Completion criterion: tests cover a complete chain, a retention-truncated
chain, a running successor, completed chains, and runs fully outside either side
of the viewport.

## 5. Replace Workflow-Row Geometry with Frame Geometry

Evolve `workflow-row-geometry.ts` into a pure frame geometry module. Preserve
the existing horizontal clipping behavior while adding vertical bounds and
boundary-knowledge flags.

Suggested result:

```ts
type WorkflowFrameGeometry = {
  horizontal: { startPx: number; endPx: number } | null;
  topPx: number;
  bottomPx: number;
  drawStartSide: boolean;
  drawEndSide: boolean;
  startDotPx: number | null;
  endDotPx: number | null;
  labelStartPx: number;
  labelMaxWidthPx: number;
};
```

The geometry must:

- Intersect frame time ranges with the horizontal viewport.
- Draw vertical sides and dots only for real, visible boundaries.
- Use actual row Y coordinates rather than assuming `rowIndex * ROW_HEIGHT`.
- Include event-details panel displacement in the owning run and chain bottoms.
- Enforce one `ROW_HEIGHT` minimum vertical span.
- Expose enough information to hide labels below a tested useful-width
  threshold.

Retain or migrate the current `workflow-row-geometry.test.ts` cases so existing
clipping behavior cannot regress.

Completion criterion: pure tests cover horizontal clipping, unknown chain
starts, minimum height, detail-panel displacement, narrow labels, and reverse
sort Y bounds.

## 6. Build Noninteractive Frame Layers

Replace `workflow-row.svelte` with a reusable `workflow-frame.svelte`, plus a
small layer component if needed to separate background and foreground paint.

Render:

- Transparent or lightly tinted frame backgrounds below collapsed-idle
  overlays and event rows
- Borders, labels, and dots above backgrounds but below action hit targets
- One accessible frame identity rather than separate accessible border pieces

All frame DOM uses `pointer-events: none`. Do not add buttons, workflow detail
panels, hover state, focus state, navigation, or copy actions.

Vertically intersect frame paint with the existing visible page band before
creating large background surfaces. A frame spanning thousands of rows must not
force the browser to rasterize a full-height tinted rectangle. Only draw a real
top or bottom edge when that edge is in the mounted band; clipped vertical sides
may continue through the band.

Completion criterion: component tests prove correct roles and labels, one versus
multiple frame rendering, noninteractive layers, and no action-target occlusion.

## 7. Integrate the Layout with Row Pooling

Update `timeline-graph.svelte` to use the shallow layout as the source for:

- Total layout height
- Closed-form visible row bounds
- Pooled action-row slots
- Run frame vertical spans
- Outer chain frame vertical span
- Event-details panel displacement

Continue using `TimelineRowHeightRetention` for the outer canvas height. Frame
spans come from the current containment layout, so any temporarily retained
trailing height remains unframed.

The row pool may point only group rows at `TimelineGraphRow`; `empty-run` rows
reserve height without mounting an event component. Focus bookkeeping continues
to track group timeline keys, never empty rows or frames.

Remove the existing loop that renders every `WorkflowRow` at `y={ROW_HEIGHT}`.

Rendering rules:

- A loaded chain with one run: render one run frame and no separate chain frame.
- A loaded chain with two or more related runs: render the outer chain frame
  whenever at least one run participates, plus one frame for each participating
  run. Loaded runs outside the viewport do not receive vertical blocks.
- Zero participating runs: render no frame and preserve the timeline's existing
  empty/loading treatment.
- A participating run with zero visible groups: render its one-row empty block
  and frame.

Completion criterion: integration tests prove sibling frames remain aligned
while the page scrolls and pooled row slots are reused.

## 8. Preserve Live Motion and Chain Handoff

Place all horizontal frame geometry in the existing timeline motion layer and
consume `--timeline-frame-offset`. Running frame ends consume the same live-edge
extension as existing running workflow lines.

Verify these transitions:

- Follow-live motion moves actions and their run frames together.
- Pause freezes viewport movement and running frame ends.
- Resume returns both to the latest edge.
- Active-run completion solidifies the run frame.
- Successor commit changes the former active run into a retained sibling and
  creates the new live sibling without carrying a stale compositor offset.
- A retention prune removes a run block and recomputes the outer chain's known
  start without a false boundary.

Do not add another timer, animation loop, or Svelte state update per animation
frame.

Completion criterion: viewport and motion tests cover freeze/resume, completion,
handoff, and retention pruning with frame metadata.

## 9. Styling and Visual Validation

Use existing workflow status colors, dots, and `#ti-workflow` icon definitions.
Start with the existing border thickness, dash cadence, surface color, radius,
and 13 px run-label typography. Add only the minimum new tokens or utilities
needed for a rectangular frame.

Validate at least:

- Light and dark themes
- One short run
- One long running run clipped on the left
- Multiple runs with different statuses
- Empty filtered runs
- Narrow visible frame fragments
- Open event details inside a run
- Maximum retained-run count
- Ascending and descending sort

Use the real browser probe on a concrete workflow timeline route and inspect its
screenshot, console errors, uncaught exceptions, and failed requests.

Completion criterion: frame hierarchy is legible without reducing event-label
contrast or event hit areas.

## 10. Final Validation

Run targeted unit and component tests during each step, then run:

```bash
pnpm check
pnpm lint
pnpm test -- --run
pnpm test:integration
node scripts/agent-probe.mjs <concrete-workflow-timeline-route>
```

Also exercise the existing large live-history workflow or equivalent fixture to
confirm:

- DOM row count remains bounded by the pool size.
- Frame count is bounded by retained run count, not event count.
- Scroll window calculation remains closed-form.
- Follow-live animation does not add per-frame Svelte recomputation.
- No full-height frame surface is rasterized outside the visible vertical band.

## Suggested Commit Sequence

1. Add ownership/filtering helpers and characterization tests.
2. Add shallow containment layout and positioning tests.
3. Add frame visibility and pure geometry.
4. Add the noninteractive frame renderer.
5. Integrate single-run frames with the existing pool.
6. Add multi-run chain and sibling frames.
7. Add empty-run blocks and detail-panel span handling.
8. Complete live handoff, retention, accessibility, and browser validation.

Every commit should keep the timeline usable and pass its targeted tests. Avoid
landing recursive child-workflow scaffolding in Phase 1; the shallow run model
is intentionally the complete abstraction for this delivery.
