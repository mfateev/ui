# Timeline history API proposal

The UI remains correct with its bounded successor walk and buffer-backed run
models. Two authenticated server capabilities are required before serial chain
latency can be removed or compact storage can discard full event payloads.

## Paginated workflow-chain summaries

`ListWorkflowExecutionChain(namespace, workflowId, firstExecutionRunId,
pageSize, nextPageToken)` returns runs in chain order. Each entry contains the
run ID, status, start and end timestamps, successor run ID, transition type,
and an optional continuation count for aggregation.

- `pageSize` is capped at 1,000. The response may return fewer entries.
- A page token is opaque and bound to namespace, workflow ID, first execution
  run ID, caller authorization, and the snapshot boundary. Reusing it with
  other arguments is an invalid request.
- Closed-run entries in a page are immutable. The final running entry may
  change between requests and includes a summary version.
- The service applies the same namespace authorization and payload codec policy
  as workflow history. It distinguishes permission denied, archival
  unavailable, not found, invalid token, and transient failure.
- Archival either returns the same contract from the configured visibility
  archive or reports archival unavailable; it never silently returns a partial
  chain.
- Clients fall back to the bounded successor walk when the capability is absent.

## Workflow history event ranges

`GetWorkflowHistoryEventRange(namespace, workflowId, runId, firstEventId,
lastEventId, nextPageToken)` retrieves one inclusive event-ID range.

- The IDs must identify one event group. A response contains at most 100 events.
- Page tokens are opaque and bound to the namespace, execution, inclusive
  range, caller authorization, codec settings, and live summary version.
- Every response includes the run ID and actual first and last returned IDs.
  The client rejects mismatches, gaps, duplicate tokens, out-of-range events,
  and results larger than the summary event count.
- Closed ranges are immutable and cacheable. Running ranges are not persisted
  and require an exact summary version.
- The service distinguishes not found, permission denied, archival unavailable,
  invalid range or token, stale live version, and transient failure.
- Authorization and payload codec behavior exactly matches normal history
  retrieval. The implementation must seek to the range; replaying opaque page
  tokens from event 1 is not a compatible implementation.

Compact timeline storage remains disabled until the range capability is
advertised and compatibility-tested. The buffer-backed model is the supported
fallback.
