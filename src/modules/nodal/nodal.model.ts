import mongoose from 'mongoose';
import { z } from 'zod';

/** Org nodal candidate records — parallel to employees; invitations use role `nodal` (not `staff`). */
export const nodalZodSchema = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string(),
  memberId: z.string().optional(),
  userId: z.string().optional(),
  invitationId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const nodalDepartmentCreateZodSchema = nodalZodSchema.omit({
  id: true,
  userId: true,
  memberId: true,
  invitationId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
});

export const nodalDepartmentUpdateZodSchema =
  nodalDepartmentCreateZodSchema.partial();

/** Manual link after a user becomes an org member (alternative to bulk `sync-from-org-members`). */
export const attachUserIdMemberIdZodSchema = z.object({
  userId: z.string().min(1),
  memberId: z.string().min(1),
});

export type Nodal = z.infer<typeof nodalZodSchema>;
export type NodalDepartmentCreate = z.infer<
  typeof nodalDepartmentCreateZodSchema
>;
export type NodalDepartmentUpdate = z.infer<
  typeof nodalDepartmentUpdateZodSchema
>;

const nodalSchema = new mongoose.Schema<Nodal>(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: false,
      unique: true,
      sparse: true,
      default: null,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'member',
      required: false,
      default: null,
    },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'invitation',
      required: false,
      default: null,
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
    },
    metadata: {
      type: Map,
      of: String,
    },
  },
  {
    timestamps: true,
  }
);

export const NodalModal = mongoose.model('tb_nodals', nodalSchema);
