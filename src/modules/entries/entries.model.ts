import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

/**
 * Stored entry item (computed by server).
 */
export const zKpiEntryItem = z.object({
  templateItemId: z.string().min(1),
  title: z.string().min(1),
  inputType: z.enum(['number', 'percent', 'boolean']),
  inputValueNumber: z.number().optional(),
  inputValueBoolean: z.boolean().optional(),
  maxMarks: z.number().nonnegative(),
  awardedMarks: z.number().nonnegative(),
  remarks: z.string().optional(),
});
export type KpiEntryItem = z.infer<typeof zKpiEntryItem>;

/**
 * Client input item (only values; server fills title/maxMarks/awardedMarks).
 */
export const zKpiEntryItemInput = z.object({
  templateItemId: z.string().min(1),
  inputValueNumber: z.number().optional(),
  inputValueBoolean: z.boolean().optional(),
  remarks: z.string().optional(),
});
export type KpiEntryItemInput = z.infer<typeof zKpiEntryItemInput>;

export const zKpiEntry = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  departmentId: z.string().min(1),
  periodId: z.string().min(1),
  templateId: z.string().min(1),
  employeeId: z.string().min(1),
  roleSnapshot: z.string().min(1),
  divisionOrBlock: z.string().min(1).optional(),
  items: z.array(zKpiEntryItem).min(1),
  totalMarks: z.number().nonnegative(),
  obtainedMarks: z.number().nonnegative(),
  status: z.enum(['draft', 'submitted', 'locked']).default('draft'),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const zKpiEntryCreate = zKpiEntry.omit({
  id: true,
  totalMarks: true,
  obtainedMarks: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export const zKpiEntryUpsertInput = z.object({
  employeeId: z.string().min(1),
  templateId: z.string().min(1),
  /** optional: default to current active period */
  periodId: z.string().optional(),
  divisionOrBlock: z.string().trim().min(1).max(150).optional(),
  items: z.array(zKpiEntryItemInput).min(1),
});
export type KpiEntry = z.infer<typeof zKpiEntry>;
export type KpiEntryCreate = z.infer<typeof zKpiEntryCreate>;
export type KpiEntryUpsertInput = z.infer<typeof zKpiEntryUpsertInput>;

export const zKpiEntryBulkSubmitInput = z.object({
  entryIds: z.array(z.string().min(1)).min(1).max(500),
});
export type KpiEntryBulkSubmitInput = z.infer<typeof zKpiEntryBulkSubmitInput>;

const kpiEntryItemSchema = new Schema(
  {
    templateItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    inputType: {
      type: String,
      required: true,
      enum: ['number', 'percent', 'boolean'],
    },
    inputValueNumber: { type: Number, required: false },
    inputValueBoolean: { type: Boolean, required: false },
    maxMarks: { type: Number, required: true, min: 0 },
    awardedMarks: { type: Number, required: true, min: 0 },
    remarks: { type: String, required: false },
  },
  { _id: false }
);

const kpiEntrySchema = new Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tbl_departments',
      required: true,
      index: true,
    },
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'kpi_period',
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'kpi_template',
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tb_employees',
      required: true,
      index: true,
    },
    roleSnapshot: { type: String, required: true },
    divisionOrBlock: { type: String, required: false, index: true },
    items: { type: [kpiEntryItemSchema], required: true },
    totalMarks: { type: Number, required: true, min: 0 },
    obtainedMarks: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'submitted', 'locked'],
      default: 'draft',
    },
  },
  { timestamps: true, collection: 'kpi_entries' }
);

kpiEntrySchema.index(
  { employeeId: 1, periodId: 1, templateId: 1 },
  { unique: true }
);

export const KpiEntryModel = model<KpiEntry>('kpi_entry', kpiEntrySchema);
