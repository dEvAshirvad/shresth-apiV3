import logger from '@/configs/logger/winston';
import APIError from '@/configs/errors/APIError';
import { RespondError } from '@/lib/respond';
import { NextFunction, Request, Response } from 'express';

export function errorHandler(
  error: Error,
  _: Request,
  res: Response,
  next: NextFunction
) {
  if (error instanceof APIError) {
    RespondError(res, error.serializeError(), error.statusCode);
    return;
  }

  logger.error(error?.message);
  RespondError(
    res,
    {
      title: 'Internal Server Error',
      message: error?.message,
    },
    500
  );
}
