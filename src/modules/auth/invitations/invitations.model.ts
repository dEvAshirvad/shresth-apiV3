import mongoose from 'mongoose';
import { z } from 'zod';

// Zod schema for invitations
export const invitationZodSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  inviterId: z.string(),
  organizationId: z.string(),
  role: z.enum(['staff', 'admin', 'nodal']).default('staff'),
  status: z
    .enum(['pending', 'accepted', 'expired', 'revoked'])
    .default('pending'),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type Invitation = z.infer<typeof invitationZodSchema>;

// Mongoose schema for invitations
const invitationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    inviterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: ['staff', 'admin', 'master', 'nodal'],
      default: 'staff',
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired', 'revoked'],
      default: 'pending',
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    // Mongoose option is `collection`, not `collectionName` — wrong key was ignored, so it fell back to plural "invitations"
    collection: 'invitation',
  }
);

export const InvitationModel = mongoose.model<Invitation>(
  'invitation',
  invitationSchema
);
