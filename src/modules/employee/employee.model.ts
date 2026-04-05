import mongoose from 'mongoose';
import { z } from 'zod';

export const employeeZodSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string(),
  memberId: z.string().optional(),
  userId: z.string().optional(),
  invitationId: z.string().optional(),
  department: z.string().optional(),
  departmentRole: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const employeeDepartmentCreateZodSchema = employeeZodSchema
  .omit({
    id: true,
    userId: true,
    memberId: true,
    invitationId: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    department: z.string(),
  });

export const employeeDepartmentUpdateZodSchema =
  employeeDepartmentCreateZodSchema.partial();

/** Manual link after a user becomes an org member (alternative to bulk `sync-from-org-members`). */
export const attachUserIdMemberIdZodSchema = z.object({
  userId: z.string().min(1),
  memberId: z.string().min(1),
});

export type Employee = z.infer<typeof employeeZodSchema>;
export type EmployeeDepartmentCreate = z.infer<
  typeof employeeDepartmentCreateZodSchema
>;
export type EmployeeDepartmentUpdate = z.infer<
  typeof employeeDepartmentUpdateZodSchema
>;

const employeeSchema = new mongoose.Schema<Employee>(
  {
    name: {
      type: String,
      required: true,
    },
    /** Sparse unique: many employees have no linked user yet; plain unique on null would only allow one `userId: null`. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: false,
      unique: true,
      sparse: true,
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
    /** Sparse unique so many rows can omit email until provided. */
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
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tbl_departments',
      required: false,
    },
    departmentRole: {
      type: String,
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

export const EmployeeModal = mongoose.model('tb_employees', employeeSchema);
