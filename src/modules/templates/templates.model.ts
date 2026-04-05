import mongoose, { model, Schema } from 'mongoose';
import { z } from 'zod';

/**
 * KPI Template
 * - A template belongs to an organization and optionally a department.
 * - A template targets a role inside a department (e.g. "SDM").
 * - A template contains KPI items, each with its own scoring/judgement rule.
 */

const zTargetSlab = z.object({
  /** e.g. 10 places visited */
  target: z.number().nonnegative(),
  /** e.g. 25 marks */
  marks: z.number().nonnegative(),
});

const zJudgementPercent = z.object({
  type: z.literal('percent'),
  /**
   * How to convert percent input to marks.
   * - linear: marks = maxMarks * clamp(percent,0,100)/100
   */
  mode: z.enum(['linear']).default('linear'),
});

const zJudgementTarget = z.object({
  type: z.literal('target'),
  /**
   * Slabs: map an achieved target (number) → marks.
   * Recommended: define slabs in descending order (highest target first),
   * but evaluation can sort at runtime.
   */
  slabs: z.array(zTargetSlab).min(1),
  /**
   * How to evaluate slabs.
   * - best_match: pick the slab with highest target <= achieved
   * - nearest: pick slab with target nearest to achieved
   */
  mode: z.enum(['best_match', 'nearest']).default('best_match'),
});

const zJudgementBoolean = z.object({
  type: z.literal('boolean'),
  /** When true, awarded marks = item `maxMarks`; when false, 0. No separate trueMarks. */
});

const zRangeBand = z
  .object({
    min: z.number().finite(),
    max: z.number().finite(),
    marks: z.number().finite().nonnegative(),
  })
  .superRefine((data, ctx) => {
    if (data.min > data.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'max must be greater than or equal to min',
      });
    }
  });

const zJudgementRange = z.object({
  type: z.literal('range'),
  /** Multiple non-overlapping or ordered bands; first matching band wins. */
  ranges: z.array(zRangeBand).min(1),
});

export const zKpiJudgement = z.discriminatedUnion('type', [
  zJudgementPercent,
  zJudgementTarget,
  zJudgementBoolean,
  zJudgementRange,
]);
export type KpiJudgement = z.infer<typeof zKpiJudgement>;

export const zKpiItem = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    /** input expected from user */
    inputType: z.enum(['number', 'percent', 'boolean']).default('number'),
    unit: z.string().optional(), // e.g. "visits", "₹", "%"
    maxMarks: z.number().positive(),
    judgement: zKpiJudgement,
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.judgement.type === 'percent' && data.inputType !== 'percent') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputType'],
        message: 'inputType must be "percent" for judgement.type "percent"',
      });
    }
    if (data.judgement.type === 'boolean' && data.inputType !== 'boolean') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputType'],
        message: 'inputType must be "boolean" for judgement.type "boolean"',
      });
    }
    if (
      (data.judgement.type === 'target' || data.judgement.type === 'range') &&
      data.inputType !== 'number'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputType'],
        message:
          'inputType must be "number" for judgement.type "target" or "range"',
      });
    }
    if (data.judgement.type === 'percent') {
      const u = data.unit;
      if (u !== undefined && u !== null && String(u).trim() !== '') {
        ctx.addIssue({
          code: 'custom',
          path: ['unit'],
          message:
            'unit must not be set for percent items; values are always interpreted as % on the server',
        });
      }
    }
  });
export type KpiItem = z.infer<typeof zKpiItem>;

export const zKpiTemplate = z.object({
  id: z.string(),
  organizationId: z.string().min(1),
  /** optional: template can be org-wide or department-specific */
  departmentId: z.string().optional(),
  /** role inside the department, e.g. "SDM" */
  role: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  items: z.array(zKpiItem).min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const zKpiTemplateCreate = zKpiTemplate.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const zKpiTemplateUpdate = zKpiTemplateCreate.partial();

export type KpiTemplate = z.infer<typeof zKpiTemplate>;
export type KpiTemplateCreate = z.infer<typeof zKpiTemplateCreate>;
export type KpiTemplateUpdate = z.infer<typeof zKpiTemplateUpdate>;

const targetSlabSchema = new Schema(
  {
    target: { type: Number, required: true, min: 0 },
    marks: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const rangeBandSchema = new Schema(
  {
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    marks: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const judgementSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['percent', 'target', 'boolean', 'range'],
    },
    mode: { type: String, required: false }, // percent/target modes
    slabs: { type: [targetSlabSchema], required: false }, // target
    /** @deprecated legacy single band; prefer `ranges` */
    min: { type: Number, required: false },
    max: { type: Number, required: false },
    marks: { type: Number, required: false, min: 0 },
    ranges: { type: [rangeBandSchema], required: false },
  },
  { _id: false }
);

const kpiItemSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: false },
    inputType: {
      type: String,
      required: true,
      enum: ['number', 'percent', 'boolean'],
      default: 'number',
    },
    unit: { type: String, required: false },
    maxMarks: { type: Number, required: true, min: 0 },
    judgement: { type: judgementSchema, required: true },
    isActive: { type: Boolean, required: true, default: true },
  },
  { _id: true }
);

const kpiTemplateSchema = new Schema(
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
      required: false,
      index: true,
    },
    role: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, required: false },
    items: { type: [kpiItemSchema], required: true },
  },
  { timestamps: true, collection: 'kpi_templates' }
);

export const KpiTemplateModel = model<KpiTemplate>(
  'kpi_template',
  kpiTemplateSchema
);
