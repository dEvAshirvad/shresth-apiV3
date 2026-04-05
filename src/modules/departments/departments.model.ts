import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

const zDepartment = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  logo: z.string().optional(),
  metadata: z.string().optional(),
  assignedNodal: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const zDepartmentGet = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  search: z.string().optional(),
  assignedNodal: z.string().optional(),
});

export const zDepartmentCreate = zDepartment.omit({
  id: true,
  assignedNodal: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
});

export const zDepartmentUpdate = zDepartmentCreate.partial();

export type DepartmentUpdate = z.infer<typeof zDepartmentUpdate>;

export const zDepartmentAssignNodal = zDepartment.pick({
  assignedNodal: true,
});
export type Department = z.infer<typeof zDepartment>;
export type DepartmentCreate = z.infer<typeof zDepartmentCreate>;
export type DepartmentAssignNodal = z.infer<typeof zDepartmentAssignNodal>;

const departmentSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    logo: { type: String, required: false },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
    },
    assignedNodal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'member',
      required: false,
    },
    metadata: { type: String, required: false },
  },
  {
    timestamps: true,
  }
);

export const DepartmentModel = model<Department>(
  'tbl_departments',
  departmentSchema
);
