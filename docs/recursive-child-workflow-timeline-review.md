# Recursive Child Workflow Timeline Review

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

## Validation Results

- `pnpm check`: zero errors and 64 existing warnings.
- All recursive timeline tests passed.
- Full test run: 206 test files and 2,764 tests passed; two unrelated deployment
  test suites timed out during their setup hooks.
- Prettier reported formatting problems in seven prototype HTML/CSS files.
- `git diff --check` passed.

## Recommended Cleanup Order

1. Preserve nested state across live refreshes.
2. Correct cache alias ownership and eviction.
3. Remove the obsolete shallow containment implementation.
4. Extract and test the frame vertical-layout rules.
5. Consolidate key generation.
6. Remove dead fixture code and reconcile documentation and prototype assets.
