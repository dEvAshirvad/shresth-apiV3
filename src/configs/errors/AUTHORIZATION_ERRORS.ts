import { IErrorData } from '@/types/errors/errors.types';

export const AUTHORIZATION_ERRORS = {
  AUTHORIZATION_ERROR: {
    STATUS: 401,
    TITLE: 'AUTHORIZATION_ERROR',
    MESSAGE: 'The user is not authorized to perform this action.',
  },
  SESSION_INVALIDATED: {
    STATUS: 404,
    TITLE: 'SESSION_INVALIDATED',
    MESSAGE: 'The session was invalidated. Please login again.',
  },
  VALIDATION_ERROR: {
    STATUS: 400,
    TITLE: 'VALIDATION_ERROR',
    MESSAGE: 'Invalid input data',
  },
} satisfies IErrorData;