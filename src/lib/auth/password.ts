import { APIError } from 'better-auth/api';
import bcrypt from 'bcrypt';
import { BetterAuthOptions } from 'better-auth/types';
import emailTemplates from '@/configs/emailTemplates';

const password = {
  async hash(password: string) {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    if (!hashedPassword) {
      throw new APIError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to hash password',
      });
    }
    return hashedPassword;
  },
  async verify({ password, hash }: { password: string; hash: string }) {
    const isMatch = await bcrypt.compare(password, hash);
    if (!isMatch) {
      throw new APIError('UNAUTHORIZED', {
        message: 'Invalid credentials',
      });
    }
    return true;
  },
};

const emailAndPassword: BetterAuthOptions['emailAndPassword'] = {
  enabled: true,
  password,
  sendResetPassword: async ({ user, url }) => {
    await emailTemplates.sendPasswordResetEmail(user.email, {
      name: user.name,
      resetLink: url,
      expiresIn: '1 hour',
    });
  },
};

export default emailAndPassword;
