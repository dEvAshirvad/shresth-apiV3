import mongoose, { model, Schema } from 'mongoose';

export type WhatsAppSendStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type PerformerBucket = 'top' | 'medium' | 'bottom';

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
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tb_employees',
      required: true,
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tbl_departments',
      required: true,
    },
    employeeName: { type: String, required: false },
    /** E.164-style digits only (e.g. 91xxxxxxxxxx); never log full number in application logs. */
    phoneDigits: { type: String, required: false },
    phoneMasked: { type: String, required: false },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      index: true,
    },
    performerBucket: {
      type: String,
      required: true,
      enum: ['top', 'medium', 'bottom'],
    },
    campaignName: { type: String, required: true },
    templateParams: { type: [String], default: [] },
    dryRun: { type: Boolean, default: false },
    skipReason: { type: String, required: false },
    /** Truncated JSON-safe snapshot from the WhatsApp provider (for ops/debug). */
    providerResponse: { type: Schema.Types.Mixed, required: false },
    errorMessage: { type: String, required: false },
    triggeredByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: false,
    },
    sentAt: { type: Date, required: false },
  },
  { timestamps: true, collection: 'kpi_whatsapp_report_sends' }
);

schema.index({ organizationId: 1, periodId: 1, createdAt: -1 });
schema.index({ organizationId: 1, periodId: 1, employeeId: 1, status: 1 });

export const WhatsAppReportSendModel = model('kpi_whatsapp_report_send', schema);
