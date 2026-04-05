import { Worker } from 'bullmq';
import logger from '@/configs/logger/winston';
import { createBullConnection } from './bullmqConnection';
import { processKpiBackgroundJob } from './kpiBackground.processor';

const QUEUE_NAME = 'kpi-background';
const PREFIX = 'kpi';

export function createKpiBackgroundWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info(`KPI background job start: ${job.name} id=${job.id}`);
      const result = await processKpiBackgroundJob(job);
      logger.info(`KPI background job done: ${job.name} id=${job.id}`);
      return result;
    },
    {
      connection: createBullConnection(),
      prefix: PREFIX,
      concurrency: 2,
    }
  );
}
