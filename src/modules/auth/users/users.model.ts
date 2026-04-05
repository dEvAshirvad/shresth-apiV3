import mongoose from 'mongoose';
import { z } from 'zod';

export const userZodSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean().default(false),
  image: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  role: z.enum(['user', 'admin']).default('user'),
  banned: z.boolean().default(false),
  banReason: z.string(),
  banExpires: z.date(),
  isOnboarded: z.boolean().default(false),
});

export type User = z.infer<typeof userZodSchema>;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
      required: false,
    },
    banned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
      default: '',
    },
    banExpires: {
      type: Date,
      default: null,
    },
    caId: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      required: false,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isOnboarded: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'user',
  }
);

export const UserModel = mongoose.model<User>('user', userSchema);
