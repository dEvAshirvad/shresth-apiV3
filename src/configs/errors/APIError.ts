import {
  HttpErrorStatusCode,
  IAPIError,
  IHttpErrorResponse,
  ErrorType,
} from '@/types/errors/errors.types';

import { format } from 'date-fns';
const timestamp = new Date().toISOString();

export default class APIError extends Error {
  statusCode: HttpErrorStatusCode;
  title: string;
  errors?: ErrorType;
  success: boolean;
  isOperational: boolean;
  meta?: Record<string, unknown>;

  constructor(option: IAPIError) {
    super(option?.MESSAGE);
    Object.setPrototypeOf(this, APIError.prototype);
    this.title = option.TITLE;
    this.statusCode = option.STATUS;
    this.success = false;
    this.errors = option.ERRORS;
    this.meta = option.META;
    this.isOperational = true;
  }

  serializeError() {
    return {
      title: this.title,
      message: this?.message,
      success: this.success,
      status: this.statusCode,
      errors: this.errors || [],
      meta : this.meta || {},
      timestamp: format(timestamp, 'PPP p'),
    } satisfies IHttpErrorResponse;
  }

  toString() {
    return (
      'APIError: ' +
      this.statusCode +
      ' - ' +
      this.title +
      ' - ' +
      this.message +
      '\n'
    );
  }
}