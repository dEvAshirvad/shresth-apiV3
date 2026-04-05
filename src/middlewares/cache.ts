import { Request, Response, NextFunction } from 'express';
import CacheService, { generateCacheKey } from '@/lib/cache';
import logger from '@/configs/logger/winston';

/**
 * Cache middleware options
 */
interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyPrefix?: string; // Prefix for cache key
  includeQuery?: boolean; // Include query params in cache key
  includeBody?: boolean; // Include body in cache key (for POST/PUT)
  skipCache?: (req: Request) => boolean; // Function to skip caching
}

/**
 * Cache middleware for Express routes
 * Caches GET requests by default
 */
export const cacheMiddleware = (options: CacheOptions = {}) => {
  const {
    ttl = 300, // Default 5 minutes
    keyPrefix = 'api',
    includeQuery = true,
    includeBody = false,
    skipCache,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests by default
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache if function returns true
    if (skipCache && skipCache(req)) {
      return next();
    }

    // Generate cache key
    const cacheParams: Record<string, unknown> = {
      method: req.method,
      path: req.path,
    };

    if (includeQuery && Object.keys(req.query).length > 0) {
      cacheParams.query = req.query;
    }

    if (includeBody && req.body && Object.keys(req.body).length > 0) {
      cacheParams.body = req.body;
    }

    const cacheKey = generateCacheKey(keyPrefix, cacheParams);

    try {
      // Try to get from cache
      const cached = await CacheService.get(cacheKey);

      if (cached) {
        logger.debug(`Cache hit for key: ${cacheKey}`);
        // Set cache headers
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        return res.json(cached);
      }

      // Cache miss - continue to route handler
      logger.debug(`Cache miss for key: ${cacheKey}`);
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Key', cacheKey);

      // Override res.json to cache the response
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        // Cache the response asynchronously (don't block response)
        CacheService.set(cacheKey, body, ttl).catch((error) => {
          logger.error('Failed to cache response:', error);
        });

        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      // Continue without caching on error
      next();
    }
  };
};

/**
 * Invalidate cache by pattern
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    const deleted = await CacheService.delPattern(pattern);
    logger.info(
      `Invalidated ${deleted} cache entries matching pattern: ${pattern}`
    );
  } catch (error) {
    logger.error(`Failed to invalidate cache for pattern ${pattern}:`, error);
  }
};

/**
 * Clear all cache for a specific route
 */
export const clearRouteCache = async (route: string): Promise<void> => {
  await invalidateCache(`api:*path:${route}*`);
};
