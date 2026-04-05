import Redis from 'ioredis';
import env from '@/configs/env';

/** BullMQ requires `maxRetriesPerRequest: null` on ioredis (see BullMQ docs). */
export function createBullConnection(): Redis {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
}
