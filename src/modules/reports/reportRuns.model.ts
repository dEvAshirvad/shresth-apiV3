import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

export const zReportRun = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  periodId: z.string().min(1),
  periodKey: z.string().min(1),
  generatedAt: z.date(),
  status: z.enum(['generated']).default('generated'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ReportRun = z.infer<typeof zReportRun>;

const reportRunSchema = new Schema(
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
    periodKey: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    status: { type: String, required: true, default: 'generated' },
  },
  { timestamps: true, collection: 'kpi_report_runs' }
);

reportRunSchema.index({ organizationId: 1, periodId: 1 }, { unique: true });

export const ReportRunModel = model<ReportRun>('kpi_report_run', reportRunSchema);

