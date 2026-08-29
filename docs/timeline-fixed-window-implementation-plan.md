# Timeline Fixed-Window Implementation Plan

This plan introduces a fixed-width pixel viewport over the workflow timeline.
Expanded time uses a configurable density, collapsed idle segments retain a
fixed pixel width, and a running timeline moves smoothly to the left while
following its latest event.

The initial zoom density is one minute of expanded time across the timeline's
drawable width. Define it as:

```text
expandedPxPerMs = viewportWidthPx / expandedDurationPerViewportMs
```

where `expandedDurationPerViewportMs` initially equals `60_000`. Collapsed
segments add their fixed pixel widths independently of expanded duration. A
resize therefore changes pixels per millisecond while preserving the one-minute
zoom level; world coordinates and the followed or anchored viewport offset must
be recalculated together.

Zoom controls are intentionally deferred, but
`expandedDurationPerViewportMs` must remain configurable so they can be added
without redesigning the scale.

## Core Implementation

### 1. Characterize the Current Scale

Add missing unit tests for the existing timeline scale before refactoring it.

Cover:

- Projection and unprojection
- Collapsed idle gaps
- Zero-duration workflows
- Times outside the current scale
- Resize behavior

Completion criterion: existing behavior is locked down before production code
changes.

### 2. Introduce an Intrinsic World Scale

Change `timeline-scale.svelte.ts` so expanded segments use the configured zoom
density and collapsed segments retain their 48 px width. Expose the total
virtual width. The scale accepts the current drawable viewport width and
`expandedDurationPerViewportMs`, and applies the formula above. Pixel viewport
offset does not participate in this world-coordinate projection.

Completion criterion: unit tests prove that 60 seconds of expanded time occupies
one viewport width, every collapsed gap occupies 48 px, and resizing preserves
60 seconds per viewport while recalculating world coordinates deterministically.

### 3. Add a Pixel Viewport Model

Replace the unused time-bound viewport behavior with pixel-space state and
operations:

- `widthPx`
- `offsetPx`
- Follow the right edge
- Freeze and resume

Define the visible world interval as `[offsetPx, offsetPx + widthPx]` and clamp
followed offsets to `max(0, totalWorldWidthPx - widthPx)`. Freezing snapshots the
current offset; resizing a frozen viewport retains the same visible world anchor
rather than implicitly resuming follow mode.

Completion criterion: unit tests prove that short timelines start at offset
zero, long timelines follow their right edge, and frozen viewports do not move.

### 4. Add Projection and Clipping Primitives

Add pure helpers for:

- World-to-screen projection
- Visible-range intersection
- Clipping connectors at the left and right viewport edges

Completion criterion: fully outside, fully inside, entering-left, and
leaving-right cases are covered by unit tests without rendering Svelte.

### 5. Wire a Static One-Minute Window

Add explicit `full-duration` and `fixed-window` timeline display modes. Make
`full-duration` the safe default, pass `fixed-window` explicitly from the main
workflow timeline, and pass `full-duration` explicitly from `graph-widget.svelte`
for child-workflow previews. Initially update the fixed window in discrete
ticks; smooth animation belongs to a later deliverable.

Completion criterion: the main timeline displays the latest
one-minute-equivalent window, child-workflow previews retain their current
full-duration layout, and existing filters and sorting continue to work.

### 6. Calculate Group-Window Intersection

Derive each group's visible time span and filter out groups that do not intersect
the viewport. Treat every `group.isPending` group as ending at the live or frozen
clock, matching existing timeline segmentation. This includes pending
activities, Nexus operations, timers, and child workflows rather than only
groups with `pendingActivity` metadata.

Completion criterion: unit tests prove that old rows disappear, groups crossing
a boundary remain, and each supported kind of pending group remains visible
when appropriate.

### 7. Collapse Empty Rows

Build vertical positioning and virtualization from the visible groups rather
than every historical group. Close an open detail panel if its group leaves the
window. Before a focused row is removed or a pooled DOM slot is repointed to a
different group, move focus to a stable timeline container or control. A
focused element must never silently change its event identity as the window
advances.

Completion criterion: no blank historical rows remain and ascending and
descending ordering tests continue to pass. Tests also prove deterministic focus
behavior when a focused group leaves the window and when pooled rows are reused.

### 8. Clip Event-Row Geometry

Extract visible-row geometry from `timeline-graph-row.svelte`. Clip connectors
and suppress offscreen dots and labels.

Completion criterion: offscreen events do not pile up on the rails, while
boundary-crossing activity bars remain visible and clickable.

### 9. Make the Axis Viewport-Aware

Update `timeline-axis.svelte` to generate ticks from world coordinates and the
viewport offset.

Completion criterion: axis labels correspond to visible positions and remain
correct across collapsed segments.

### 10. Make the Workflow Row Viewport-Aware

Project and clip the workflow-level bar. For workflows younger than one minute,
keep the workflow start at the left and allow the bar to grow before scrolling
begins.

Completion criterion: running, short completed, and long completed workflows
have deterministic, tested geometry.

### 11. Window Collapsed-Idle Overlays

Horizontally window `timeline-collapsed-layer.svelte`. Clip collapse markers and
hit targets without changing their 48 px world width.

Completion criterion: idle-time toggles remain accessible and functional when
partially or fully inside the viewport.

### 12. Implement Follow and Freeze Lifecycle

Connect the viewport to auto-refresh:

- Running workflows follow the right edge
- Pausing freezes event polling, the clock, and pixel offset
- Resuming returns to the latest right edge
- Completed workflows anchor at their final edge

Completion criterion: integration tests cover running to pause to resume and
running to completed transitions.

### 13. Add Smooth Motion

Drive a root CSS pixel-offset variable with `requestAnimationFrame`. Recalculate
group membership and ticks less frequently, and do not rebuild the complete
timeline segment collection every frame.

Completion criterion: content moves smoothly, pause stops it immediately, and
work per frame is proportional to the visible row pool rather than total
history.

### 14. Verify Display-Mode Isolation

Audit every `TimelineGraph` call site and require an intentional display mode.
Keep `full-duration` as the component default so future embedded timelines do
not silently inherit live-window behavior.

Completion criterion: existing child-workflow mini timelines retain their
current layout and a component test proves that an omitted mode uses
`full-duration`.

## Final Validation

Add focused integration coverage for:

- New events entering from the right
- Old groups leaving the left and their rows disappearing
- Groups spanning either or both viewport boundaries
- Collapsed idle segments entering and leaving the view
- Auto-refresh pause and resume
- Workflow completion while following live
- Event filtering and ascending and descending sorting
- Keyboard and screen-reader access to visible events and collapse controls
- Focus behavior when a visible event leaves the window or a row slot is reused
- Resize behavior while retaining the one-minute zoom level
- The live `1,000 x 100 ms` workflow as a performance and browser probe

Each deliverable should pass its targeted tests and the standard validation:

```bash
pnpm check
pnpm lint
pnpm test -- --run
pnpm test:integration
```

Run targeted Playwright integration specs for the relevant intermediate
deliverables and the complete integration suite during final validation.

## Deferred Zoom Extension

The initial implementation should expose density as an
`expandedDurationPerViewportMs = 60_000` setting rather than hard-coding it in
projection calculations. A later extension can add zoom controls that change
this value without redesigning the scale or viewport. Changing it uses the same
atomic scale-and-offset recalculation required for resize.
