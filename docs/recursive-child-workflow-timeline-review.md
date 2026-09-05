# Recursive Child Workflow Timeline Review

## Follow-up Review: Child Workflow Rendering

Reviewed on 2026-09-05 after the immutable presentation, child interaction,
animation, and unified containment iterations. The earlier findings documented
below remain resolved. This follow-up found additional correctness risks and
overlapping implementations in the current rendering path.

### 1. High: Child refreshes can reuse stale presentation rows

`RecursiveWorkflowSession.commitLoaded` updates an existing child node in place
and replaces its runs during live refresh. The edge remains in the `loaded`
state. The timeline presentation identity, however, includes only each edge's
key, expansion, and load-state. Its per-row cache revision includes only the
chunk bounds and the keys of the first and last rows.

A `loaded` to `loaded` child refresh therefore does not necessarily invalidate
a cached row. The same issue applies when a child description updates
`edge.execution` while the edge remains `idle`. If the row stays at the same
ordinal with the same key, the cache can retain the old `TimelineGroupEntry`
and its old group object. Pending or completed state, event count, resolved
status, and row details can remain stale until an unrelated filter, topology,
or scene change causes invalidation.

Relevant locations:

- `src/lib/services/recursive-workflow-session.svelte.ts:681`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:1074`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:2271`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-presentation-chunks.ts:32`

Recommendation: give child workflow nodes or runs an explicit content revision
and include it in the presentation scene identity or row revision key. Cover
both `loaded` to `loaded` live refresh and `idle` description enrichment with a
component-level regression test.

### 2. High: A failed staged expansion can leave a child permanently collapsed

The animated child expansion path stages every collapsed edge whose state is
not `loaded`. It calls `RecursiveWorkflowSession.load` without first expanding
the edge, waits for a terminal load state, and toggles the edge only if loading
succeeds.

`load` accepts only `idle` and `evicted` edges. An existing `error` edge is
therefore a no-op. A new request that fails also leaves the edge collapsed. In
both cases the animation waiter exits without toggling the edge, and the inline
retry row remains inaccessible because child-state rows are not emitted for
collapsed edges. Subsequent expansion clicks repeat the same no-op path. The
reduced-motion path does not stage the load and consequently behaves
differently.

Relevant locations:

- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:1505`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:1557`
- `src/lib/services/recursive-workflow-session.svelte.ts:250`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-containment-layout.ts:454`

Recommendation: replace the separate `load` and later `toggle` operations with
one explicit expansion transition. Expansion should expose the loading and
error states immediately, and animation should observe that state rather than
owning it. At minimum, stage only `idle` and `evicted` states and expand an
errored edge so its retry UI becomes reachable.

### 3. Medium: Viewport observation and LRU state have no production owner

The session has an `observeEdges` API, a `visibleEdgeKeys` set,
`lastVisibleAt` timestamps, and visibility-aware eviction ordering. The
containment module also exports `getObservedTimelineEdgeKeys`. There is no
production caller for either observation API. The session instead starts eager
topology resolution in its constructor.

As a result, every edge is treated as invisible and retains a zero visibility
timestamp. Capacity eviction described as least-recently-used falls back to
depth, expansion, and traversal order and can evict a currently visible sibling
instead of an offscreen edge. The eager and observed loading paths are
overlapping implementations with different policies.

Relevant locations:

- `src/lib/services/recursive-workflow-session.svelte.ts:104`
- `src/lib/services/recursive-workflow-session.svelte.ts:143`
- `src/lib/services/recursive-workflow-session.svelte.ts:186`
- `src/lib/services/recursive-workflow-session.svelte.ts:483`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-containment-layout.ts:125`

Recommendation: choose one loading policy. If topology remains eager, remove
the unused observation-driven loading behavior and provide a smaller, explicit
visibility signal only for eviction ranking. If loading should be
viewport-driven, wire the mounted presentation rows into `observeEdges` and
remove unconditional eager resolution.

### 4. Medium: Topology resolution descends through collapsed parents

`resolveTopology` requires an edge itself to be expanded before enqueueing it,
but recursively visits every fully loaded edge regardless of expansion. A
collapsed loaded parent can therefore cause its still-expanded, unloaded
descendants to fetch during a later root synchronization or load commit.

This performs invisible work, consumes descendant history and node budgets,
and can cause unrelated visible branches to be evicted.

Relevant location:

- `src/lib/services/recursive-workflow-session.svelte.ts:216`

Recommendation: recurse into a loaded child only when its incoming edge is
expanded. Retaining already loaded descendant state does not require initiating
new descendant requests below a collapsed ancestor.

### 5. Medium: Child history pagination duplicates shared loading logic without

its safeguards

`loadChildWorkflow` implements a separate ascending-history pagination loop.
It appends converted pages directly and does not deduplicate event IDs or detect
a repeated page token. `fetchCompleteRawHistoryOrThrow`, used by the immutable
timeline loader, already implements both protections.

Overlapping server pages can duplicate child events and groups. A repeated page
token can issue requests until the child event limit is exhausted and then
misreport the response as a legitimate truncation.

Relevant locations:

- `src/lib/services/child-workflow-loader.ts:153`
- `src/lib/services/events-service.ts:234`

Recommendation: extract a shared bounded-history pagination primitive that
supports cancellation, request injection, event limits, event-ID
deduplication, and repeated-token detection. Use it from both child and root
timeline loading.

### Additional duplication and drift

- `timeline-graph.svelte` duplicates the complete chain-frame and run-frame
  invocation blocks for background and foreground paint layers. The separate
  layers are necessary for stacking, but their iteration, key derivation,
  animation offsets, and most props should be owned by one frame-layer
  component or snippet. Relevant locations:
  `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:2699`
  and
  `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:2795`.
- The timeline repeatedly walks the same recursive node tree to build incoming
  child headers, runs, child execution states, group entries, rendered groups,
  active ranges, pending end times, and counts. A single recursive scene
  projection could own these indexes and remove repeated scans and lookup
  conventions.
- `getGroupForEdge`, `setEdgeExpansion`, `evictEdge`, and `canRetryEdge` in
  `recursive-timeline-model.ts` have no production callers. The unused helpers
  obscure which layer owns mutation.
- The design says loading, truncation, cycles, depth limits, and eviction render
  as inline child-state rows, while the containment layout explicitly
  suppresses safety-limited edges and their state rows. The tests currently
  encode the suppression. The intended user experience should be decided and
  the design, tests, state component, and layout made consistent.

### Recommended cleanup order

1. Correct presentation-cache invalidation for child content changes.
2. Replace staged `load` plus `toggle` with one failure-safe expansion action.
3. Select and enforce one topology loading policy.
4. Stop topology traversal at collapsed parent edges.
5. Consolidate bounded history pagination.
6. Extract shared recursive scene indexes and frame-layer rendering.
7. Remove dead helpers and reconcile safety-limit documentation and tests.

### Validation and coverage gap

The full Vitest suite passed during this review: 280 test files and 3,438 tests
passed, with two tests skipped. Existing unit coverage does not exercise a
failed animated child expansion or presentation-cache invalidation during a
`loaded` to `loaded` child refresh. Those scenarios need component or browser
coverage because the defects arise at the boundary between session state, DOM
animation, and the presentation cache.

## Resolution

Addressed in the follow-up cleanup commit:

- Live refreshes mutate existing child nodes and preserve nested edge state.
- Cache aliases and retained-data accounting are rebuilt from attached nodes.
- The obsolete shallow containment layout and `run-gap` type were removed.
- Frame spacing moved to a pure, tested vertical-layout helper.
- Timeline run-key construction now uses one shared helper.
- Dead fixture code was removed and the overlapping design documents were
  consolidated into `recursive-child-workflow-timeline-design.md`.

## Findings

### 1. High: Live refresh replaces child nodes and resets nested UI state

`recursive-workflow-session.svelte.ts` creates a fresh node during every refresh
in `commitLoaded`. `createNode` initializes an empty child-edge map, so
descendant collapse, error, and loading state is lost. Loaded descendants may
reattach from the cache, but controls reset and long polls churn.

The current tests refresh only a single-level child, so this behavior is not
covered.

Relevant locations:

- `src/lib/services/recursive-workflow-session.svelte.ts:233`
- `src/lib/services/recursive-workflow-session.svelte.ts:494`

### 2. Medium: Continue-As-New cache aliases accumulate and become stale

`commitLoaded` stores a node under every successor run key, but later refreshes
only update the newest key and the original edge key. Intermediate aliases
remain mapped to old node versions indefinitely. Long Continue-As-New chains
therefore grow `loadedByExecutionKey` beyond the configured run-retention
limit.

The eviction path deletes only one alias and lacks shared-node ownership
accounting.

Relevant locations:

- `src/lib/services/recursive-workflow-session.svelte.ts:190`
- `src/lib/services/recursive-workflow-session.svelte.ts:524`

### 3. Medium: The old containment implementation is dead and duplicated

`getTimelineContainmentLayout` has no production caller; only tests use it. The
recursive implementation duplicates its ordering, pending-gap, row, and span
logic.

The dead version still inserts `run-gap` rows, contradicting the current design
in which consecutive run boxes touch. Retaining both implementations also
forces optional compatibility fields throughout the shared row and span types.

Relevant locations:

- `src/lib/components/lines-and-dots/timeline-graph/timeline-containment-layout.ts:147`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-containment-layout.ts:268`

### 4. Medium: Frame-spacing behavior is concentrated in ad hoc component logic

`timeline-graph.svelte` mixes first-run detection, top and bottom padding,
child-depth inset, retained root height, and child-only padding. These are the
invariants that caused repeated visual regressions, but they are not covered
together by a pure geometry test.

This logic should become a small frame-layout helper with tests for adjoining
runs, workflow padding, nested padding, and activity-border clearance.

Relevant location:

- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:940`

### 5. Low: Timeline run-key construction is duplicated

The `timelineRunKey` helper exists, but the same string format is manually
rebuilt in two other files. A future key-format change could silently disconnect
spans and frames.

Relevant locations:

- `src/lib/components/lines-and-dots/timeline-graph/timeline-containment-layout.ts:121`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-frame-visibility.ts:112`
- `src/lib/components/lines-and-dots/timeline-graph/timeline-graph.svelte:954`

### 6. Low: Stale and dead fixture and documentation material remains

- `BatchedContinueAsNewGrandchildWorkflow` has no caller after the child
  workflow became recursive.
- `double` and `delayedDouble` use duplicate activity-proxy configuration.
- The three new design documents overlap and still describe recursive children
  as future work or `graph-widget.svelte` as current, although that component
  was deleted.
- Diagnostic screenshots under `prototypes/` are untracked and should be
  intentionally included or excluded before committing.

Relevant locations:

- `temporal/workflows.ts:22`
- `temporal/workflows.ts:90`
- `docs/nested-workflow-frames-design.md`
- `docs/recursive-child-workflow-timeline-plan.md`
- `docs/workflow-containment-frames-implementation-plan.md`

## Live Rendering Follow-up

The one-second disappearance in the recorded Continue-As-New workflow was a
presentation-layer defect. Each live refresh mounted new rows and frames with
`visibility: hidden`, then waited 1.1 seconds before starting the entry motion.
Because the live clock refreshed every second, the hidden interval repeated
continuously and made run boxes blink out.

The timeline now keeps the committed row/frame scene visible while a structural
update settles in a back buffer. Identical refreshes update that pending scene
without restarting its swap timer. Once loading is quiet, the complete scene is
committed atomically and the existing row-entry motion runs against it. Direct
child expand/collapse interactions flush the buffer so controls remain
responsive.

## Validation Results

- `pnpm check`: zero errors and 65 existing warnings.
- `pnpm lint`: zero errors and 62 existing warnings.
- Full test run: 281 test files and 3,444 tests passed; two tests were skipped.
- The streamed-activity browser regression passed on desktop and mobile and
  observed zero hidden timeline rows or frames throughout the swap.
- A live Continue-As-New workflow probe completed without browser, console, or
  request errors while row and run-frame counts advanced.
- `git diff --check` passed.

## Recommended Cleanup Order

1. Preserve nested state across live refreshes.
2. Correct cache alias ownership and eviction.
3. Remove the obsolete shallow containment implementation.
4. Extract and test the frame vertical-layout rules.
5. Consolidate key generation.
6. Remove dead fixture code and reconcile documentation and prototype assets.
