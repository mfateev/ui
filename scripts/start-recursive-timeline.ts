import { connect, disconnect } from '../temporal/client';
import { runWorkerUntil } from '../temporal/worker';
import { RecursiveTimelineParentWorkflow } from '../temporal/workflows';

async function main() {
  const client = await connect();
  const workflowId = `recursive-timeline-parent-${Date.now()}`;
  const handle = await client.workflow.start(RecursiveTimelineParentWorkflow, {
    taskQueue: 'e2e-1',
    workflowId,
  });
  console.log(
    `Recursive timeline fixture: workflowId=${workflowId} runId=${handle.firstExecutionRunId}`,
  );
  await runWorkerUntil(handle.result());
  await disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
