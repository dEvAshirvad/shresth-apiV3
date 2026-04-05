import APIError from '@/configs/errors/APIError';
import { AUTHORIZATION_ERRORS } from '@/configs/errors/AUTHORIZATION_ERRORS';
import { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';

export const validateRequest = ({
  body,
  query,
  params,
}: {
  body?: ZodType<unknown>;
  query?: ZodType<unknown>;
  params?: ZodType<unknown>;
}) => {
  return async (req: Request, _: Response, next: NextFunction) => {
    try {
      await Promise.all([
        body && body.parseAsync(req.body),
        query && query.parseAsync(req.query),
        params && params.parseAsync(req.params),
      ]);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        throw new APIError({
          ...AUTHORIZATION_ERRORS.VALIDATION_ERROR,
          // @ts-ignore
          ERRORS: error.flatten(),
        });
      }
      throw error;
    }
  };
};
