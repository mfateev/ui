import { createRequire } from 'node:module';

import { Client, Connection } from '@temporalio/client';
import { Worker } from '@temporalio/worker';
import yargs from 'yargs/yargs';

import * as activities from '../temporal/activities/index';
import { getDataConverter } from '../temporal/data-converter';
import { ThousandActivitiesContinueAsNewWorkflow } from '../temporal/workflows';

const require = createRequire(import.meta.url);

const taskQueue = 'thousand-activities-continue-as-new';

const argv = await yargs(process.argv.slice(2))
  .option('workflow-id', {
    type: 'string',
    default: `thousand-activities-continue-as-new-${Date.now()}`,
  })
  .option('activities', { type: 'number', default: 1_000 })
  .option('continue-as-new-count', { type: 'number', default: 10 })
  .option('batch-size', { type: 'number', default: 100 })
  .parse();

async function main() {
  const connection = await Connection.connect();
  const dataConverter = await getDataConverter();
  const client = new Client({ connection, dataConverter });
  const worker = await Worker.create({
    activities,
    dataConverter,
    taskQueue,
    workflowsPath: require.resolve('../temporal/workflows'),
  });
  const handle = await client.workflow.start(
    ThousandActivitiesContinueAsNewWorkflow,
    {
      args: [argv.activities, argv.continueAsNewCount, 1, argv.batchSize],
      taskQueue,
      workflowId: argv.workflowId,
    },
  );

  console.log(`Started ${argv.workflowId}`);
  const result = await worker.runUntil(handle.result());
  await connection.close();
  console.log(`Completed ${argv.workflowId}`, result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
