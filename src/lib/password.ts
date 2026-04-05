import APIError from '@/configs/errors/APIError';
import { HttpErrorStatusCode } from '@/types/errors/errors.types';
import bcrypt from 'bcrypt';

const password = {
  async hash(password: string) {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    if (!hashedPassword) {
      throw new APIError({
        STATUS: HttpErrorStatusCode.INTERNAL_SERVER,
        TITLE: 'INTERNAL_SERVER_ERROR',
        MESSAGE: 'Failed to hash password',
      });
    }
    return hashedPassword;
  },
  async verify({ password, hash }: { password: string; hash: string }) {
    const isMatch = await bcrypt.compare(password, hash);
    if (!isMatch) {
      throw new APIError({
        STATUS: HttpErrorStatusCode.UNAUTHORIZED,
        TITLE: 'UNAUTHORIZED',
        MESSAGE: 'Invalid credentials',
      });
    }
    return true;
  },
};

export default password;
