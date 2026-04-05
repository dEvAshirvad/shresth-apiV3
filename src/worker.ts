/**
 * BullMQ worker process: run alongside the API (`pnpm dev`) as `pnpm worker:dev`,
 * or in production as a separate service (`pnpm start:worker`).
 */
import connectDB, { disconnectDB } from '@/configs/db/mongodb';
import logger from '@/configs/logger/winston';
import env from '@/configs/env';
import { createKpiBackgroundWorker } from '@/jobs/kpiBackground.worker';

if (env.BACKGROUND_JOBS_SYNC) {
  logger.warn(
    'BACKGROUND_JOBS_SYNC=true — worker will idle (jobs are executed inline in the API). Exiting worker.'
  );
  process.exit(0);
}

let worker: ReturnType<typeof createKpiBackgroundWorker>;

connectDB()
  .then(() => {
    worker = createKpiBackgroundWorker();
    worker.on('failed', (job, err) => {
      logger.error(`KPI background job failed id=${job?.id} name=${job?.name}`, err);
    });
    worker.on('error', (err) => {
      logger.error('KPI background worker error', err);
    });
    logger.info('KPI background worker started');
  })
  .catch((err) => {
    logger.error('Worker: database connection failed', err);
    process.exit(1);
  });

async function shutdown(signal: string) {
  logger.info(`Worker ${signal}, closing...`);
  if (worker) {
    await worker.close();
  }
  await disconnectDB();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
