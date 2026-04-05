import connectDB, { disconnectDB } from '@/configs/db/mongodb';
import logger from '@/configs/logger/winston';
import env from '@/configs/env';
import createApp from '@/configs/serverConfig';
import redis from '@/configs/db/redis';
import { startKpiPeriodCron } from '@/cron/kpi-periods.cron';

const app = createApp();

connectDB()
  .then(async () => {
    startKpiPeriodCron();
  })
  .catch((err) => {
    logger.error('Database Connection Failed', err);
    process.exit();
  });

const server = app.listen(env.PORT, () => {
  logger.info(
    `Running Status : Server started on port http://localhost:${env.PORT}`
  );
  if (!env.BACKGROUND_JOBS_SYNC) {
    logger.warn(
      'BACKGROUND_JOBS_SYNC=false: start the BullMQ worker (`pnpm worker:dev`) or nodal invite / WhatsApp jobs will remain queued with no emails.'
    );
  }
});

redis.on('connect', () => {
  logger.info('Redis client connecting...');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

redis.on('error', (error: Error) => {
  logger.error(`Redis error: ${error.message}`, error);
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

// Graceful shutdown (single handler: server → Redis → MongoDB)
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  server.close(() => logger.info('HTTP server closed'));
  await redis.quit();
  logger.info('Redis connection closed through app termination');
  await disconnectDB();
  logger.info('MongoDB connection closed through app termination');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.log('fatal', 'Unhandled rejection', err);
  server.close(() => process.exit(1));
});
