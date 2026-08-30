# Recursive Child Workflows in the Timeline

## Status and Scope

Implementation-ready follow-up to Phase 1 workflow containment frames.

The current branch already has the shallow building blocks this work must
extend:

- `workflow-timeline-layout.svelte` projects the root chain context into
  `TimelineRun[]`.
- `timeline-run-entries.ts` preserves run ownership and stable
  `<runId>:<groupId>` timeline keys.
- `timeline-containment-layout.ts` produces constant-height flat rows and run
  spans for the virtualized row pool.
- `timeline-frame-visibility.ts`, `workflow-frame-geometry.ts`, and
  `workflow-frame.svelte` render chain and run frames through the shared
  viewport and motion layer.
- `timeline-graph.svelte` owns the only time scale, viewport, animation loop,
  vertical visible-band sampler, row pool, and details-panel displacement.
- `group-details-row.svelte` currently embeds `graph-widget.svelte` for a
  started child workflow. That nested graph is the behavior being replaced.

This plan covers recursive child discovery, bounded loading, flattening,
rendering, subtree controls, and live child chains. It does not redesign event
details, add interaction to frame surfaces, change the horizontal fixed-window
model, or replace the root `WorkflowRunContext` history stream.

## Goal

Render the timeline as one recursive containment tree rather than a parent
timeline with embedded child mini-timelines. Every child workflow uses the same
workflow-chain and run-frame rendering policy as the root workflow.

The current implementation fetches child history only after opening the parent
event details and displays it in a separate scroll box through
`timeline-graph/graph-widget.svelte`. This plan replaces that presentation with
inline recursive containment in the main timeline.

## Architectural Boundaries

Use one root-owned workflow-tree session and keep its responsibilities separate
from layout and rendering:

```text
root WorkflowRunContext + grouped-event buffer
                 |
                 v
recursive workflow-tree session
  - node/edge state
  - request queue, budgets, cancellation, polling
                 |
                 v
pure recursive containment layout
  - flat rows
  - workflow spans
  - run spans
                 |
                 v
the existing TimelineGraph viewport, row pool, frame layers, and details panel
```

The root node remains a projection of the existing live root chain; do not copy
or re-fetch its event history. Loaded descendants own independent workflow and
grouped-history snapshots inside the tree session. Layout receives immutable
snapshots from that session and must not start network requests. Rendering emits
visibility observations for child-edge anchors; the session uses those
observations to schedule bounded work.

### Planned file ownership

| Area                                                     | Planned files                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Child reference extraction                               | New `timeline-child-reference.ts` and tests beside the timeline graph                                         |
| Tree types, keys, transitions, budgets                   | New `recursive-timeline-model.ts` and tests                                                                   |
| Exact-run Describe and bounded history pagination        | New `child-workflow-loader.ts` under `src/lib/services/`, with service tests                                  |
| Queueing, deduplication, cancellation, eviction, polling | New `recursive-workflow-session.svelte.ts` under `src/lib/services/`, with pure helpers split out when useful |
| Recursive flat layout                                    | Generalize `timeline-containment-layout.ts` and its existing tests; do not add recursive Svelte row trees     |
| Frame candidates                                         | Generalize `timeline-frame-visibility.ts` and reuse `workflow-frame-geometry.ts` and `workflow-frame.svelte`  |
| Anchor/state row UI                                      | New `timeline-child-edge-row.svelte`, mounted through the existing row pool                                   |
| Integration                                              | `timeline-graph.svelte`, with only the minimum root projection changes in `workflow-timeline-layout.svelte`   |
| User-facing state and control text                       | Add typed English keys under `src/lib/i18n/locales/en/`; do not hard-code labels in timeline components       |
| Mini-timeline removal                                    | `group-details-row.svelte`; delete `graph-widget.svelte` after all call sites and tests are gone              |

Names are directional, but ownership boundaries are requirements. In
particular, do not place request orchestration inside a pooled row component:
pooled components are repointed during scroll and cannot safely own fetch
lifecycle.

## Recommended Structure

```text
Root workflow chain
└── Root run
    ├── Activity
    ├── Child-workflow relationship row
    ├── Child workflow chain
    │   └── Child run
    │       ├── Activity
    │       └── Grandchild workflow chain
    │           └── Grandchild run
    └── Timer
```

## Rendering Decisions

- A child frame uses the same `WorkflowFrame` component, status styling,
  clipping, labels, dots, and single-run or multi-run rules as the root.
- Root and child workflows have no intrinsic visual differences.
- Keep the parent-owned child-workflow event row immediately before the nested
  frame. This preserves access to initiation and completion details and provides
  a natural loading, error, and collapse control.
- If the child has not started or has no run ID, render only the existing event
  row.
- All workflows share one horizontal time scale and viewport. Do not nest
  another `TimelineGraph` or introduce child scroll boxes.
- Parent run frames include the complete vertical span of their child subtrees.
- Filters affect action rows, not workflow identity. A filtered child retains a
  minimum-height frame.
- The recursive tree is bounded by node, history, depth, and concurrent-request
  limits.

## 1. Introduce a Recursive Timeline Model

Add a pure model representing workflow chains, runs, action entries, and child
edges:

```ts
type TimelineWorkflowNode = {
  key: string;
  namespace: string;
  workflowId: string;
  firstRunId: string;
  workflow: WorkflowExecution;
  runs: TimelineRun[];
  childrenByGroupKey: Map<string, TimelineChildEdge>;
};

type TimelineChildEdge = {
  key: string;
  parentGroupKey: string;
  reference: ChildWorkflowReference;
  expansion: 'expanded' | 'collapsed';
  load: TimelineChildLoadState;
};

type TimelineChildLoadState =
  | { state: 'idle' }
  | { state: 'loading'; requestKey: string }
  | {
      state: 'loaded';
      node: TimelineWorkflowNode;
      truncation?: TimelineTruncation;
    }
  | {
      state: 'error';
      kind: 'unavailable' | 'unauthorized' | 'network' | 'malformed';
      reason: string;
      retryable: boolean;
    }
  | { state: 'truncated'; truncation: TimelineTruncation }
  | { state: 'evicted' };

type TimelineTruncation = {
  reason:
    | 'cycle'
    | 'depth-limit'
    | 'node-limit'
    | 'event-limit'
    | 'group-limit'
    | 'run-limit';
};
```

Define and test key factories rather than assembling identifiers at call sites:

```text
execution key = namespace + workflow ID + first run ID
group key     = execution key + owning run ID + existing timelineKey
edge key      = parent execution key + parent group key + child execution key
frame key     = execution key + chain/run frame kind + run ID when applicable
```

The parent group key in this model is the full run-qualified `timelineKey`, not
the bare `EventGroup.id`. This keeps duplicate event IDs in sibling runs and
reused workflow IDs in separate ancestry branches distinct. Cycle detection
uses the execution keys on the current ancestry path, while request
deduplication uses the child execution key across the whole session.

Expansion is orthogonal to loading so a loaded node can be collapsed without
discarding it. Eviction returns the edge to an explicit reloadable state rather
than overloading `idle` or `error`. Store references to the existing groups in
`TimelineRun`; do not clone event payloads into edges or layout rows.

Completion criteria:

- Every action and child edge has exactly one workflow and run owner.
- Reused workflow IDs and event IDs cannot collide across runs or ancestry.
- The model represents loading, loaded, failed, unavailable, unauthorized,
  collapsed, truncated, and evicted subtrees without copying event payloads.
- State-transition tests cover collapse while loaded, eviction and reload,
  retryable and terminal failures, and truncation before and during a load.

## 2. Extract Child References from Grouped History

Add a pure helper that recognizes `ChildWorkflowExecutionStarted` and returns
the exact namespace, workflow ID, and run ID reference.

Use the history event as the authoritative discovery source. Do not depend on
`fetchAllChildWorkflows()` for traversal: visibility-based child queries may be
unsupported, and the current helper converts query failures into an empty
result.

Requirements:

- Prefer `ChildWorkflowExecutionStarted.attributes.namespace`; if absent, read
  the matching initiation event's namespace, then fall back to the current
  namespace.
- Take workflow and run IDs from the started event's `workflowExecution`. Both
  are required before an edge is loadable.
- Pair the started event with its existing grouped child-workflow event.
- Leave initiated, pending, canceled-before-start, and start-failed groups as
  ordinary event rows.
- Preserve the parent event group's existing `timelineKey` for selection and
  event details.

Completion criteria:

- Tests cover same-namespace and cross-namespace references, missing run IDs,
  start failures, malformed attributes, and duplicate child workflow IDs.

## 3. Replace the Mini-Timeline with a Shared Recursive Loader

Create one workflow-tree session owned by the root timeline. It should:

- Fetch the exact child Describe response and history.
- Group child events using the same grouping path as the root.
- Discover grandchildren from fetched child history.
- Deduplicate requests by execution key.
- Abort requests when the page changes or a subtree is evicted.
- Limit concurrent child requests.
- Apply total node, event, retained-run, and recursion-depth budgets.
- Expose explicit loading, unavailable, unauthorized, truncated, and retry
  states.

Implement exact-run history pagination specifically for this use case. The
existing generic `paginated()` helper always follows the next-page token and
has no stop result, so it is not sufficient for a hard retained-history budget.
The new loader must request pages directly, pass its `AbortSignal` through
`requestFromAPI` fetch options, convert each page before appending it, and stop
before accepting a page that would exceed the remaining event budget. Return
the accepted partial history and truncation metadata together. Group accepted
events with `groupEvents(..., 'ascending', workflow.pendingActivities)` so root
and child event semantics stay aligned.

Classify Describe and history failures once in the service layer:

- HTTP 401 or 403: `unauthorized`, terminal until an explicit retry.
- HTTP 404 or a missing exact run: `unavailable`, terminal until an explicit
  retry.
- Abort caused by disposal or eviction: no error transition.
- Decode or structurally invalid identity/history: `malformed`, terminal.
- Other transport and 5xx failures: `network`, retryable with user-triggered
  retry in the first increment; automatic retry may be added with live polling.

Every discovered started-child edge contributes a stable structural anchor to
the flattened layout. Normally the relationship event row is that anchor. If
event filtering hides the relationship event, a compact non-event subtree row
occupies the same keyed anchor. The layout row uses the child edge's key across
both presentations, while the event presentation continues to use the parent
group's existing `timelineKey` for selection and details. Direct children begin
loading when this anchor enters the timeline's vertical overscan. Descendants
use the same rule once their parent history has loaded. Filtering therefore
cannot prevent discovery, loading, retry, or expansion of a child workflow.

Safety limits apply before the first recursive loader ships. Check depth and
node budgets before enqueueing a request, and enforce event and retained-run
budgets while consuming paginated responses. Do not call an unbounded
`fetchAllEvents()` and truncate only after it has fetched the complete history.
A bounded child-history fetch must stop pagination, abort any remaining work,
and return the partial node with explicit truncation metadata when its remaining
budget is exhausted.

Do not instantiate a `TimelineGraph` per child. Child sessions own workflow and
history data, but the root timeline remains the sole owner of the viewport,
scale, motion loop, row pool, and frame layers.

Initial safety limits:

- Maximum depth: 10
- Maximum loaded workflow nodes, including the root: 100
- Maximum concurrent child requests: 4
- Maximum retained descendant runs: 200
- Maximum retained descendant groups: 10,000
- Maximum retained descendant events: 50,000
- Per-node caps reuse `DEFAULT_CHAIN_RETENTION_LIMITS`: 20 completed runs,
  2,000 completed groups, and 10,000 completed events

Centralize these defaults in `recursive-timeline-model.ts`. The tree-wide
limits are session counters, not limits reset for every child. Reserve node and
request capacity atomically before enqueueing so four workers cannot overshoot
a limit concurrently. Release retained-data counters on eviction; depth and
cycle truncations consume no request slot.

Completion criteria:

- Fetches are deduplicated and canceled correctly.
- One failed child does not prevent siblings from rendering.
- Reaching a budget produces a visible truncation state rather than silently
  omitting descendants.
- Tests prove that request concurrency and retained data stay bounded while
  loading a wide or deep completed tree, not only while polling live children.

## 4. Generalize the Containment Layout

Replace the shallow run-only layout with a depth-first recursive layout. Its
output remains flat so the existing vertical virtualization can be retained:

```ts
type RecursiveTimelineLayout = {
  rows: TimelineLayoutRow[];
  workflowSpans: TimelineWorkflowSpan[];
  runSpans: TimelineRunSpan[];
  totalRowCount: number;
};

type TimelineLayoutRow =
  | TimelineGroupLayoutRow
  | TimelineChildEdgeLayoutRow
  | TimelineChildStateLayoutRow
  | TimelineEmptyRunLayoutRow
  | TimelineRunGapLayoutRow;
```

Each child relationship is a composite entry:

```text
relationship event row, or its filter-independent structural anchor
→ loading, error, or truncation row; or
→ loaded child subtree
→ next parent action
```

Layout requirements:

- Traverse each run's groups in the selected order.
- Insert a discovered child subtree immediately after its parent relationship
  row.
- Keep one stable child-edge anchor in the layout even when the relationship
  event is filtered out. Reuse the edge key and row slot when switching between
  the event presentation and compact structural presentation; do not replace
  the event's selection `timelineKey` with the edge key.
- Keep the relationship row first within the composite entry in both sort
  directions so it remains the visual introduction to the subtree.
- Apply the selected direction recursively to the child's run blocks and local
  action rows.
- Derive run spans after descendants are visited so a parent run encloses its
  entire child subtree.
- Derive workflow spans from their participating run spans.
- Propagate an open details panel's displacement through every ancestor run and
  workflow span.
- Allocate one constant-height row for loading, error, empty, collapsed, and
  truncated states.
- Preserve stable keys across loading-to-loaded transitions.
- Keep closed-form visible-row lookup; do not scan the recursive tree during
  scrolling.

Build the flat arrays only when the tree snapshot, filters, sort direction, or
horizontal participation changes. Scrolling continues to calculate a numeric
`[windowStart, windowEnd)` and index directly into `rows`; it must not rerun the
depth-first traversal. Generalize the existing row-union dispatch so only group
rows mount `TimelineGraphRow`, child-edge/state rows mount
`TimelineChildEdgeRow`, and empty/gap rows reserve space without an interactive
event row.

Return ancestor ownership with every span, for example `workflowKey`, `runId`,
`depth`, and `ancestorRunKeys`. This makes details-panel displacement a direct
span update after locating the active row rather than a second tree traversal.

Completion criteria:

- Pure tests cover parent-child-grandchild layouts, sibling children, empty
  children, ascending and descending order, details-panel displacement, and
  stable keys.
- Row pooling remains based on the flattened rows, not recursive DOM trees.

## 5. Generate Frames Uniformly

Refactor frame-candidate construction to operate once per workflow node.

For every root or child node:

- One participating run renders the same single run frame used by the root.
- Multiple related runs render the workflow-chain frame and sibling run frames.
- Status and delayed state come from that node rather than the root workflow.
- Absolute start and end timestamps project through the shared scale.
- Start and end boundary knowledge follows the existing retention rules.
- Frame backgrounds and borders remain clipped to the mounted page band.
- A small depth-dependent vertical inset keeps coincident ancestor and
  descendant borders legible without changing their status treatment.

Continue using the existing `WorkflowFrame` background and foreground layers.
Do not create separate child-specific frame components or styles. The frame
policy should be centralized so root and child rendering cannot drift.

Replace the root-specific `participatingRunFrames` and `chainFrameCandidate`
derivations in `timeline-graph.svelte` with arrays produced from all workflow
nodes. Pass each node's own `WorkflowExecution` into status, delayed, label, and
accessible-name derivation; no descendant should read status from the root
`workflow` prop. Key both background and foreground instances with the same
stable frame key.

Completion criteria:

- Given equivalent node data, root and child frame candidates and geometry are
  identical apart from vertical position and depth inset.
- Nested frame surfaces remain bounded to the visible paint band.
- Frame DOM count is bounded by loaded workflow and retained-run limits, not
  event count.

## 6. Unify the Timeline Lifecycle

The root timeline derives its effective timespan from all loaded workflow
nodes:

- The left edge is the earliest participating execution.
- The right or live edge is the latest loaded running or completed execution.
- A running child can keep the live edge advancing after its parent completes.
- Pause and resume apply to root and child polling together.
- Continue-as-new, retries, reset, and cron inside a child become sibling run
  frames within that child's workflow chain.
- Idle-time collapse uses the union of loaded events so all frame and action
  geometry stays aligned.

Generalize the existing chain lifecycle and retention concepts so each workflow
node can own a bounded run chain without owning a separate viewport or motion
timer.

For the completed-child increment, compute the scale from the union of the root
chain and all loaded descendant runs, but leave only the root chain live. The
live increment then gives each running descendant one polling runtime using the
existing chain transition helpers (`getSuccessorFromEvents`, retained run
metadata, and `DEFAULT_CHAIN_RETENTION_LIMITS`). A session-level scheduler owns
poll wakeups and respects the global concurrency cap; individual nodes do not
create animation frames or clocks.

When `$pauseLiveUpdates` becomes true, abort or suspend long-poll requests for
every descendant and freeze the single `nowMs`/viewport lifecycle. Resume
requeues only expanded, retained, running descendants. Collapsed loaded nodes
may retain completed data, but do not poll until expanded again.

Do not introduce another animation loop or per-child clock. All live frame ends
consume the existing committed viewport updates and compositor offset.

Completion criteria:

- Root and descendant actions and frames move together while following live.
- Pause freezes all loaded running workflows.
- A completed parent with a running child continues correctly.
- Child successor handoff does not reset the viewport or relabel predecessor
  groups.

## 7. Add Subtree Controls Without Making Frames Interactive

Keep frames informational and noninteractive. Put expand, collapse, retry, and
truncation controls on the child relationship row or its compact structural
anchor when the event presentation is filtered out.

Recommended behavior:

- Direct children are expanded by default.
- Descendants load recursively while within configured budgets.
- A collapsed subtree reserves only its relationship event row or compact
  structural anchor.
- Loading or failure never removes the relationship event; only event filtering
  may substitute its compact structural anchor.
- Expanding an evicted subtree loads it again.
- Keyboard focus remains attached to stable relationship or action row keys.
- Accessible names state the child workflow identity, status, depth, and
  expanded state without exposing individual frame edges or dots.

The relationship event remains the event-details target. Add the subtree
control as a separate button in the same pooled row, stop its click from
selecting the event, and use `aria-expanded` plus `aria-controls` when a loaded
subtree has a mounted region. The compact filtered anchor uses the same control
and accessible name but is not registered in the active-event store. When a
focused subtree is collapsed or evicted, move focus to its edge control before
removing descendant rows.

After inline child rendering lands, remove the embedded `GraphWidget` from
`group-details-row.svelte`. The details panel continues to display event
payload and history information, but it no longer owns another timeline.

Completion criteria:

- Frame layers do not block relationship-row controls or event hit targets.
- Collapse and re-expand preserve correct focus and ancestor geometry.
- No nested scrollbar remains in child workflow details.

## 8. Filtering, Sorting, and Partial States

Apply event-type and status filters uniformly to groups from every workflow
node.

- Filtering the `Child Workflow` event type hides the event presentation but
  retains a compact non-event subtree anchor with the same child-edge key. The
  anchor remains eligible for overscan loading and owns expand, collapse, retry,
  authorization, and truncation controls.
- Filtering cannot prevent an idle discovered child from loading, reassign a
  child, or discard an already loaded child workflow.
- A workflow whose duration intersects the viewport retains a minimum-height
  frame even when all owned action rows are filtered out.
- Sorting changes run-block and local action order recursively, while ownership
  and ancestry stay unchanged.
- Loading, error, authorization, and truncation rows belong to the parent run
  that contains the child relationship.

Completion criteria:

- Equivalent filters behave identically at every depth.
- No filter can move an action or child subtree into a different run frame.
- Changing sort direction does not cause unstable keys or unnecessary refetches.

## 9. Testing

### Pure model and layout tests

- Child and grandchild reference extraction
- Same-namespace and cross-namespace references
- Parent-child-grandchild recursive layout
- Concurrent sibling children
- Multiple child workflow runs
- Ascending and descending traversal
- Parent spans enclosing complete descendant spans
- Root and child single-run/multi-run frame parity
- Loading, error, collapsed, filtered, empty, and truncated child states
- Duplicate workflow IDs with distinct run IDs
- Ancestry cycle and depth protection
- Details-panel displacement through all ancestors
- Child continue-as-new handoff
- Shared timespan and live-edge selection
- Request deduplication, concurrency, cancellation, and eviction

### Component and integration tests

- Child relationship row followed by the inline child frame
- Recursive frame accessible identities
- Expand, collapse, retry, and keyboard focus behavior
- Frame layers do not occlude event targets
- Loading-to-loaded transitions preserve row and frame identity
- Filtering a child relationship before its first load still loads and renders
  the child through the compact structural anchor
- Filters and sorting apply consistently at every depth
- No `GraphWidget` or nested scroll container remains

### Browser and performance validation

- Parent to child to grandchild fixture
- Several concurrently running sibling children
- Running child under a completed parent
- Failed and unauthorized child fetches
- Light and dark themes
- Narrow and horizontally clipped child frames
- Open details inside a deeply nested child
- Large recursive fixture at configured node and history limits
- Bounded row-pool, frame, and total DOM counts
- No console errors, uncaught exceptions, or failed requests

## 10. Delivery Sequence

### Increment 1: Bounded completed child frames

1. Add and test key factories, child-reference extraction, the tree model,
   limits, and all edge state transitions. No Svelte or network changes belong
   in this step.
2. Add the exact-run Describe plus bounded history-page loader. Test page-token
   termination, aborts, error classification, partial results, and page-boundary
   budget exhaustion with injected request functions.
3. Add the root-owned session queue with four-worker concurrency,
   execution-key deduplication, ancestry checks, atomic budget reservations,
   disposal, and explicit retry. Feed it a projected root node but retain the
   existing root history ownership.
4. Generalize `timeline-containment-layout.ts` to depth-first flattening and add
   child edge/state row variants. Preserve the existing shallow-layout cases as
   regression tests.
5. Wire vertical overscan edge keys from `timeline-graph.svelte` back to the
   session. Prove with a component test that a filtered relationship anchor can
   schedule its first load and that pooled-row repointing does not duplicate it.
6. Generalize frame candidates and timeline timespan inputs across the loaded
   tree. Render completed child and grandchild histories inline, including
   loading, unavailable, unauthorized, error, empty, and truncation rows.
7. Add a mocked integration fixture for a completed parent, child, grandchild,
   and sibling child. Cover sorting, filtering, details selection, clipping, and
   root/child frame parity.
8. Remove `GraphWidget` from `group-details-row.svelte`, delete
   `graph-widget.svelte`, and assert that event details contain no nested graph
   or scroll container.

Increment gate: all completed descendants render recursively within global
budgets, the root-only timeline remains unchanged when no child edge exists,
and no child request survives navigation or session disposal.

### Increment 2: Subtree controls and interaction

1. Add retry, collapse, re-expand, and eviction controls.
2. Add deterministic eviction (least-recently-visible completed subtree first;
   never evict the root, a loading subtree, the focused subtree, or an ancestor
   of it) and release its retained-data counters.
3. Complete filtering, sorting, accessibility, and focus behavior.
4. Validate focus and geometry across collapse, eviction, reload, and filtered
   structural-anchor transitions.

Increment gate: every non-loaded state is visible and recoverable where
appropriate, controls remain keyboard operable through row-pool reuse, and
collapse/eviction cannot orphan focus or active details.

### Increment 3: Live children and chain handoff

1. Generalize the chain session for multiple workflow nodes.
2. Poll expanded running descendants through the session scheduler and shared
   pause lifecycle; do not allocate per-node clocks or animation loops.
3. Extend the global timespan and live edge across all loaded nodes, including a
   running child beneath a completed root.
4. Reuse chain transition and retention helpers for child continue-as-new,
   retry, reset, and cron handoffs without relabeling predecessor groups.
5. Validate retention, polling cancellation, and eviction of completed
   descendant chains under wide and deep live fixtures.

Increment gate: root and descendant frames/actions share one advancing or
paused coordinate system, and polling plus retained data stay within the same
global budgets after repeated successor handoffs.

Each increment should keep the timeline usable and pass its targeted tests.

## Final Validation

Run targeted tests throughout implementation, then run:

```bash
pnpm check
pnpm lint
pnpm test -- --run
pnpm test:integration
pnpm test:e2e
node scripts/agent-probe.mjs \
  /namespaces/default/workflows/<seeded-parent-workflow-id>/<run-id>/timeline
```

Extend `temporal/workflows.ts` and the existing workflow seeding scripts with a
deterministic parent-child-grandchild fixture plus a wide sibling fixture. The
seeder should print the parent workflow and run IDs used by the probe; do not
hard-code a stale run ID in this document or the browser test.

Also exercise a large live recursive fixture and verify:

- DOM row count remains bounded by the pool size.
- Frame count remains bounded by workflow-node and retained-run limits.
- Scroll window lookup remains closed-form.
- Follow-live animation does not add per-child animation loops.
- No full-height nested frame surface is rasterized outside the visible band.
- Child loading and eviction do not leak fetches, timers, or retained histories.

## Acceptance Criteria

The feature is complete when:

- A started child workflow appears inline inside the run that started it.
- A grandchild appears recursively inside its parent child run.
- Every workflow uses the same chain/run frame rules and `WorkflowFrame`
  renderer as the root.
- Parent frames enclose all loaded descendant content.
- All nodes share one time scale, viewport, motion lifecycle, and row pool.
- Event details, filtering, sorting, focus, pause/resume, and idle collapse remain
  functional.
- Loading failures and safety limits are explicit and recoverable.
- Large recursive histories remain bounded and responsive.
