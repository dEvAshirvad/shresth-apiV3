import morgan, { StreamOptions } from 'morgan';
import logger from '@/configs/logger/winston';

// Stream interface for morgan to use Winston
const stream: StreamOptions = {
  write: (message: string) => {
    // Remove trailing newline added by morgan
    const msg = message.trim();
    if (!msg) return;
    logger.log('request', msg);
  },
};

// Skip HTTP logging in tests to keep output clean
const skip = () => process.env.NODE_ENV === 'test';

/**
 * Morgan middleware configured to log via Winston.
 *
 * Usage in app.ts:
 *   import requestLogger from '@/config/logger/morgan';
 *   app.use(requestLogger);
 */
const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream, skip }
);

export default requestLogger;
