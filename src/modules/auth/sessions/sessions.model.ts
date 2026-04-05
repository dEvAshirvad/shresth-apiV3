import mongoose from 'mongoose';
import { z } from 'zod';

export const sessionZodSchema = z.object({
  id: z.string(),
  expiresAt: z.date(),
  token: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  userId: z.string(),
  impersonatedBy: z.string().optional(),
  activeOrganizationId: z.string().optional(),
  activeOrganizationRole: z.string().optional(),
  memberId: z.string().optional(),
});

export type Session = z.infer<typeof sessionZodSchema>;

const sessionSchema = new mongoose.Schema(
  {
    expiresAt: {
      type: Date,
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
    userId: {
      type: String,
      required: true,
    },
    impersonatedBy: {
      type: String,
      required: false,
    },
    activeOrganizationId: {
      type: String,
      required: false,
    },
    activeOrganizationRole: {
      type: String,
      required: false,
    },
    memberId: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    collection: 'session',
  }
);

export const SessionModel = mongoose.model<Session>('session', sessionSchema);
