import Redis from 'ioredis';
import env from '@/configs/env';

/**
 * Production-grade Redis connection with connection pooling
 */
const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  // Connection pool settings
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // Reconnect settings
  lazyConnect: false,
  keepAlive: 30000,
  // Performance settings
  enableOfflineQueue: true,
  enableReadyCheck: true,
  // Connection timeout
  connectTimeout: 10000,
});

export default redis;
