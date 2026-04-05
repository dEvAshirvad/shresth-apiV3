import mongoose from 'mongoose';
import { z } from 'zod';

const memberZodSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.enum(['admin', 'nodal', 'staff', 'owner']).default('staff'),
  createdAt: z.date(),
});

export type Member = z.infer<typeof memberZodSchema>;

const memberSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
    role: {
      type: String,
      required: true,
      default: 'staff',
      enum: ['admins', 'nodals', 'staff'],
    },
  },
  {
    timestamps: true,
    collection: 'member',
  }
);

export const MemberModel = mongoose.model<Member>('member', memberSchema);
