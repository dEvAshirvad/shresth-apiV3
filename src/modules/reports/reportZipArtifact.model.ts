import mongoose, { model, Schema } from 'mongoose';

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
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    generatedBy: { type: String, required: true, default: 'system' },
    templateVersion: { type: String, required: false, default: 'department-html-v2' },
    notifiedEmails: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'kpi_report_zip_artifacts' }
);

schema.index({ organizationId: 1, periodId: 1 }, { unique: true });

export const ReportZipArtifactModel = model('kpi_report_zip_artifact', schema);

