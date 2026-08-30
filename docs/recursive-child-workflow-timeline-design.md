# Recursive Child Workflow Timeline Design

## Status

Implemented as a proof of concept. The main timeline recursively renders child
workflow executions; the former event-details mini timeline has been removed.

The animated containment prototype remains under
`prototypes/workflow-containment/`. Its HTML, CSS, JavaScript, and captured UI
template are retained as design evidence. The other screenshots in
`prototypes/` are diagnostic records from the implementation process.

## Model and loading

`RecursiveWorkflowSession` owns one bounded tree rooted at the workflow shown
on the page. Child initiation events become stable edges keyed by their parent
execution, parent group, and referenced child execution. Expanded visible edges
load through a deduplicated queue with a four-request concurrency limit.

Limits cover depth, nodes, retained runs, groups, and events. Continue-As-New
runs belong to one workflow node and are retained as a bounded chain. Cache
aliases are rebuilt from attached edges and retained runs, so evicting one of
several shared edges does not discard the shared node and discarded runs do not
leave stale aliases.

Expanded running descendants have independent long polls. A refresh mutates the
existing workflow node and rediscovers its edges, preserving descendant
expansion, load, error, and retry state when the corresponding group remains.

## Layout

The containment layout is a pure depth-first flattening pass. It emits virtual
rows plus run and workflow spans. Consecutive run spans meet on one row boundary;
there are no synthetic run-gap rows. Child and grandchild rows are placed inside
their ancestor run spans, while workflow spacing rows keep nested borders clear
of nearby activities.

Run keys are created only by `timelineRunKey`. Vertical frame placement is
calculated by `getTimelineFrameVerticalLayout`, which owns adjoining-run borders,
root workflow padding, depth-based child padding, expanded-panel offsets, and
activity-border clearance.

The Svelte component consumes the flattened rows through its existing virtual
row pool. It does not create a recursive component tree.

## Interaction and failure states

Child edges default to expanded and can be collapsed without discarding loaded
state. Loading, retryable errors, truncation, cycles, depth limits, and eviction
render as inline child-state rows. Filtering can hide the relationship event;
loaded descendants remain governed by their edge state and the flattened layout.

## Validation fixtures

`BatchedContinueAsNewChildWorkflow` is the single recursive Temporal fixture.
It can create nested children and Continue-As-New chains while placing delayed
activities before and after each nested child. `start-recursive-timeline.ts`
starts the stress scenario used for browser validation.

Unit coverage includes recursive flattening, key stability, concurrent loading,
deduplication, cancellation, nested-state preservation during refresh, cache
alias retention, frame visibility, and vertical frame geometry.
