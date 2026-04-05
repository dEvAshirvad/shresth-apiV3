import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

/** Frequency as number of months. 1 = monthly, 2 = every 2 months, etc. */
export const zFrequencyMonths = z.number().int().min(1).default(1);
export type FrequencyMonths = z.infer<typeof zFrequencyMonths>;

export const zKpiPeriodConfig = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  frequencyMonths: zFrequencyMonths,
  /** Lock current period N days before next period start (min 1). */
  lockingPeriodDays: z.number().int().min(1).default(1),
  isStarted: z.boolean().default(false),
  /** Set from user `startDate` before POST /start; copied to startedAt on start. */
  pendingStartDate: z.date().optional(),
  startedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** PUT /config body: before start, all three are required (enforced in service). After start, only frequency/locking; startDate rejected. */
export const zKpiPeriodConfigPutBody = z.object({
  frequencyMonths: z.number().int().min(1).optional(),
  lockingPeriodDays: z.number().int().min(1).optional(),
  startDate: z.union([z.string(), z.coerce.date()]).optional(),
});
export type KpiPeriodConfigPutBody = z.infer<typeof zKpiPeriodConfigPutBody>;

export const zPeriodAdminPeriodIdBody = z.object({
  periodId: z.string().min(1),
});

/** Body for `POST /admin/force-lock`. `reportDate` is the inclusive close day as a **UTC** calendar date (`YYYY-MM-DD`). */
export const zPeriodAdminForceLockBody = z.object({
  periodId: z.string().min(1),
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const zPeriodAdminGenerateReportsBody = z.object({
  periodId: z.string().min(1),
  /** When true, delete existing report run + aggregates for this period, then regenerate. */
  force: z.boolean().optional(),
});

export const zPeriodAdminUpdateEndDateBody = z.object({
  periodId: z.string().min(1),
  /** New inclusive end date (UTC calendar day); next period will start the following day. */
  endDate: z.union([z.string(), z.coerce.date()]),
});

/** Optional `startDate` / `endDate` — at least one required. `startDate` has extra validation in the service (active period, no entries, chain/key rules). */
export const zPeriodAdminUpdatePeriodDatesBody = z
  .object({
    periodId: z.string().min(1),
    startDate: z.union([z.string(), z.coerce.date()]).optional(),
    endDate: z.union([z.string(), z.coerce.date()]).optional(),
  })
  .refine((b) => b.startDate !== undefined || b.endDate !== undefined, {
    message: 'Provide at least one of startDate or endDate',
  });

export const zPeriodListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['active', 'locked', 'closed']).optional(),
});

export const zPeriodIdParams = z.object({
  id: z.string().min(1),
});

export type KpiPeriodConfig = z.infer<typeof zKpiPeriodConfig>;

export const zKpiPeriod = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  frequencyMonths: zFrequencyMonths,
  key: z.string().min(1), // e.g. 2026-03, 2026-Q1, 2026
  name: z.string().min(1), // e.g. Mar 2026
  startDate: z.date(),
  endDate: z.date(),
  status: z.enum(['active', 'locked', 'closed']).default('active'),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type KpiPeriod = z.infer<typeof zKpiPeriod>;

const kpiPeriodConfigSchema = new Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
      unique: true,
      index: true,
    },
    frequencyMonths: { type: Number, required: true, default: 1, min: 1 },
    lockingPeriodDays: { type: Number, required: true, default: 1, min: 1 },
    isStarted: { type: Boolean, required: true, default: false },
    pendingStartDate: { type: Date, required: false },
    startedAt: { type: Date, required: false },
  },
  { timestamps: true, collection: 'kpi_period_configs' }
);

const kpiPeriodSchema = new Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'organization',
      required: true,
      index: true,
    },
    frequencyMonths: { type: Number, required: true, min: 1 },
    key: { type: String, required: true },
    name: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['active', 'locked', 'closed'],
      default: 'active',
    },
  },
  { timestamps: true, collection: 'kpi_periods' }
);

kpiPeriodSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const KpiPeriodConfigModel = model<KpiPeriodConfig>(
  'kpi_period_config',
  kpiPeriodConfigSchema
);
export const KpiPeriodModel = model<KpiPeriod>('kpi_period', kpiPeriodSchema);

