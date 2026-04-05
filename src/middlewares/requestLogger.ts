import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import logger from '@/configs/logger/winston';
import env from '@/configs/env';

/**
 * Get color for HTTP status code
 */
const getStatusColor = (statusCode: number) => {
  if (statusCode >= 500) return chalk.red;
  if (statusCode >= 400) return chalk.yellow;
  if (statusCode >= 300) return chalk.cyan;
  return chalk.green;
};

/**
 * Get color for HTTP method
 */
const getMethodColor = (method: string) => {
  switch (method.toUpperCase()) {
    case 'GET':
      return chalk.blue;
    case 'POST':
      return chalk.green;
    case 'PUT':
      return chalk.yellow;
    case 'PATCH':
      return chalk.magenta;
    case 'DELETE':
      return chalk.red;
    default:
      return chalk.white;
  }
};

/**
 * Middleware to log HTTP requests in development mode
 * Logs request method, URL, status code, response time, and IP address
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only log requests in development mode and skip in tests
  if (env.NODE_ENV !== 'development' || process.env.NODE_ENV === 'test') {
    return next();
  }

  const startTime = Date.now();

  // Log request when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;

    // Get user agent
    const userAgent = req.get('user-agent') || 'unknown';

    // Get request ID if available
    const requestId = req.id || 'unknown';

    // Format timestamp
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Colorize console output with chalk
    const methodColor = getMethodColor(method);
    const statusColor = getStatusColor(statusCode);
    const durationColor =
      duration > 1000 ? chalk.red : duration > 500 ? chalk.yellow : chalk.gray;

    const consoleOutput = [
      chalk.gray(`[${timestamp}]`),
      methodColor(method.padEnd(7)),
      statusColor(statusCode.toString()),
      chalk.white(originalUrl),
      durationColor(`${duration}ms`),
      chalk.gray(`- ${ip}`),
    ].join(' ');

    // Log via Winston (request level), including a human-readable line
    logger.log('request', {
      method,
      url: originalUrl,
      statusCode,
      duration: `${duration}ms`,
      ip,
      userAgent,
      requestId,
      timestamp: new Date().toISOString(),
      message: consoleOutput,
    });
  });

  next();
};
