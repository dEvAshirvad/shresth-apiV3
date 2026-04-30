import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

export const zReportRankingScope = z.enum(['overall', 'department']);
export type ReportRankingScope = z.infer<typeof zReportRankingScope>;

export const zReportRanking = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  periodId: z.string().min(1),
  scope: zReportRankingScope,
  departmentId: z.string().optional(),
  employeeId: z.string().min(1),
  employeeName: z.string().optional(),
  role: z.string().optional(),
  divisionOrBlock: z.string().optional(),
  obtainedMarks: z.number().nonnegative(),
  totalMarks: z.number().nonnegative(),
  rank: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ReportRanking = z.infer<typeof zReportRanking>;

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
    scope: { type: String, required: true, enum: ['overall', 'department'], index: true },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tbl_departments',
      required: false,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tb_employees',
      required: true,
      index: true,
    },
    employeeName: { type: String, required: false },
    role: { type: String, required: false, index: true },
    divisionOrBlock: { type: String, required: false },
    obtainedMarks: { type: Number, required: true, min: 0 },
    totalMarks: { type: Number, required: true, min: 0 },
    rank: { type: Number, required: true, min: 1, index: true },
  },
  { timestamps: true, collection: 'kpi_report_rankings' }
);

schema.index(
  { organizationId: 1, periodId: 1, scope: 1, departmentId: 1, rank: 1 },
  { name: 'report_ranking_pagination' }
);
schema.index(
  { organizationId: 1, periodId: 1, scope: 1, departmentId: 1, employeeId: 1 },
  { unique: true }
);

export const ReportRankingModel = model<ReportRanking>('kpi_report_ranking', schema);

