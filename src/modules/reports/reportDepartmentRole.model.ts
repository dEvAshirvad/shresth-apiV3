import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

export const zReportDepartmentRole = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  periodId: z.string().min(1),
  departmentId: z.string().min(1),
  role: z.string().min(1),
  employees: z.number().int().nonnegative(),
  avgObtainedMarks: z.number().nonnegative(),
  totalObtainedMarks: z.number().nonnegative(),
  totalMarks: z.number().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ReportDepartmentRole = z.infer<typeof zReportDepartmentRole>;

const schema = new Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
      index: true,
    },
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'kpi_period',
      required: true,
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tbl_departments',
      required: true,
      index: true,
    },
    role: { type: String, required: true, index: true },
    employees: { type: Number, required: true, min: 0 },
    avgObtainedMarks: { type: Number, required: true, min: 0 },
    totalObtainedMarks: { type: Number, required: true, min: 0 },
    totalMarks: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, collection: 'kpi_report_department_roles' }
);

schema.index(
  { organizationId: 1, periodId: 1, departmentId: 1, role: 1 },
  { unique: true }
);

export const ReportDepartmentRoleModel = model<ReportDepartmentRole>(
  'kpi_report_department_role',
  schema
);

