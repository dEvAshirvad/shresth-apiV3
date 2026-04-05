import APIError from '@/configs/errors/APIError';
import mongoose from 'mongoose';
import { EmployeeModal } from '../employee/employee.model';
import { KpiPeriodModel } from '../periods/periods.model';
import { KpiTemplateModel } from '../templates/templates.model';
import { KpiEntryModel, KpiEntryUpsertInput } from './entries.model';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeMarks(opts: {
  maxMarks: number;
  judgement: any;
  inputValueNumber?: number;
  inputValueBoolean?: boolean;
}) {
  const { maxMarks, judgement, inputValueNumber, inputValueBoolean } = opts;
  if (!judgement?.type) return 0;

  if (judgement.type === 'percent') {
    const pct = clamp(Number(inputValueNumber ?? 0), 0, 100);
    return clamp((maxMarks * pct) / 100, 0, maxMarks);
  }

  if (judgement.type === 'boolean') {
    const ok = Boolean(inputValueBoolean);
    return ok ? clamp(maxMarks, 0, maxMarks) : 0;
  }

  if (judgement.type === 'range') {
    const v = Number(inputValueNumber ?? NaN);
    if (!Number.isFinite(v)) return 0;
    const bands: Array<{ min?: number; max?: number; marks?: number }> =
      Array.isArray(judgement.ranges) ? judgement.ranges : [];
    if (bands.length > 0) {
      for (const r of bands) {
        const min = Number(r.min);
        const max = Number(r.max);
        if (
          Number.isFinite(min) &&
          Number.isFinite(max) &&
          v >= min &&
          v <= max
        ) {
          return clamp(Number(r.marks ?? 0), 0, maxMarks);
        }
      }
      return 0;
    }
    const min = Number(judgement.min);
    const max = Number(judgement.max);
    if (Number.isFinite(min) && Number.isFinite(max) && v >= min && v <= max) {
      return clamp(Number(judgement.marks ?? 0), 0, maxMarks);
    }
    return 0;
  }

  if (judgement.type === 'target') {
    const achieved = Number(inputValueNumber ?? NaN);
    if (!Number.isFinite(achieved)) return 0;
    const slabs: Array<{ target: number; marks: number }> = Array.isArray(
      judgement.slabs
    )
      ? judgement.slabs
      : [];
    if (!slabs.length) return 0;
    const mode = judgement.mode || 'best_match';

    if (mode === 'nearest') {
      let best = slabs[0]!;
      let bestDist = Math.abs(achieved - best.target);
      for (const s of slabs) {
        const dist = Math.abs(achieved - s.target);
        if (dist < bestDist) {
          best = s;
          bestDist = dist;
        }
      }
      return clamp(Number(best.marks ?? 0), 0, maxMarks);
    }

    // best_match: highest target <= achieved, else 0
    const sorted = [...slabs].sort((a, b) => b.target - a.target);
    const match = sorted.find((s) => achieved >= s.target);
    return clamp(Number(match?.marks ?? 0), 0, maxMarks);
  }

  return 0;
}

function sanitizeHeaderTitle(s: string): string {
  return String(s || 'KPI')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

/** Human-readable CSV/XLSX column for KPI value; `[id]` suffix keeps import mapping stable. */
export function formatKpiEntryImportValueHeader(
  it: { title?: string; inputType?: string; maxMarks?: number },
  id: string
): string {
  const title = sanitizeHeaderTitle(String(it?.title ?? 'KPI'));
  const inputType = String(it?.inputType ?? 'number');
  const maxMarks = Number(it?.maxMarks ?? 0);
  return `${title} (${inputType}, max ${maxMarks}) [${id}]`;
}

export function formatKpiEntryImportRemarkHeader(
  it: { title?: string },
  id: string
): string {
  const title = sanitizeHeaderTitle(String(it?.title ?? 'KPI'));
  return `Remark — ${title} [${id}]`;
}

function resolveImportColumnKey(
  row: Record<string, unknown>,
  tid: string,
  kind: 'value' | 'remark'
): string {
  const legacy = kind === 'value' ? `item_${tid}` : `remark_${tid}`;
  if (row[legacy] !== undefined) return legacy;
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === legacy.toLowerCase()) return k;
  }

  const suffix = `[${tid}]`;
  for (const k of Object.keys(row)) {
    if (!k.endsWith(suffix)) continue;
    const trimmed = k.trim();
    const isRemark = /^remark/i.test(trimmed) || trimmed.startsWith('Remark —');
    if (kind === 'remark' && isRemark) return k;
    if (kind === 'value' && !isRemark) return k;
  }
  return legacy;
}

/**
 * One row per template line: template definition (`judgement`, etc.) merged with saved scores.
 * Order follows **`template.items`**. Entry-only lines without a template row are ignored.
 */
function mergeTemplateAndEntryItems(
  templateItems: unknown[] | undefined,
  entryItems: unknown[] | undefined
): Record<string, unknown>[] {
  const entryByTid = new Map<string, Record<string, unknown>>();
  for (const line of entryItems ?? []) {
    if (!line || typeof line !== 'object') continue;
    const e = line as Record<string, unknown>;
    const tid = e.templateItemId != null ? String(e.templateItemId) : '';
    if (tid) entryByTid.set(tid, e);
  }

  const result: Record<string, unknown>[] = [];
  for (const t of templateItems ?? []) {
    if (!t || typeof t !== 'object') continue;
    const tm = t as Record<string, unknown>;
    const tid = tm._id != null ? String(tm._id) : '';
    const e = tid ? entryByTid.get(tid) : undefined;

    const { _id: _tplId, ...templateRest } = tm;
    const base: Record<string, unknown> = {
      ...templateRest,
      templateItemId: tid,
    };

    if (e) {
      const { templateItemId: _et, ...entryRest } = e;
      result.push({ ...base, ...entryRest, templateItemId: tid });
    } else {
      result.push(base);
    }
  }
  return result;
}

/**
 * After `.populate('employeeId').populate('templateId')`: keep id fields as strings and expose **`employee`** / **`template`** snapshots.
 */
function shapePopulatedKpiEntry(
  entry: Record<string, unknown> | null | undefined
) {
  if (!entry) return null;

  const emp = entry.employeeId;
  const tpl = entry.templateId;

  const employeePopulated =
    emp !== null &&
    emp !== undefined &&
    typeof emp === 'object' &&
    '_id' in emp;
  const templatePopulated =
    tpl !== null &&
    tpl !== undefined &&
    typeof tpl === 'object' &&
    '_id' in tpl;

  const employeeIdStr = employeePopulated
    ? String((emp as { _id: unknown })._id)
    : entry.employeeId != null
      ? String(entry.employeeId)
      : '';

  const templateIdStr = templatePopulated
    ? String((tpl as { _id: unknown })._id)
    : entry.templateId != null
      ? String(entry.templateId)
      : '';

  const templateItems =
    templatePopulated && tpl && typeof tpl === 'object' && 'items' in tpl
      ? (tpl as { items?: unknown[] }).items
      : undefined;

  const rawItems = entry.items;
  const mergedItems = mergeTemplateAndEntryItems(
    templateItems,
    Array.isArray(rawItems) ? rawItems : undefined
  );

  const { employeeId: _e, templateId: _t, ...rest } = entry;

  return {
    ...rest,
    employeeId: employeeIdStr,
    templateId: templateIdStr,
    items: mergedItems,
    ...(employeePopulated ? { employee: emp } : {}),
    ...(templatePopulated ? { template: tpl } : {}),
  };
}

export interface BulkEntryError {
  row: number;
  employeeId?: string;
  message: string;
}

function formatExportCellForStoredItem(
  line: {
    inputType?: string;
    inputValueNumber?: number;
    inputValueBoolean?: boolean;
  } | null
): string {
  if (!line) return '';
  const inputType = String(line.inputType ?? 'number');
  if (inputType === 'boolean') {
    if (line.inputValueBoolean === undefined || line.inputValueBoolean === null)
      return '';
    return line.inputValueBoolean ? 'true' : 'false';
  }
  const n = line.inputValueNumber;
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return '';
  return String(n);
}

export class KpiEntryService {
  static async upsertDraft(input: KpiEntryUpsertInput, organizationId: string) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const employee = await EmployeeModal.findById(input.employeeId).lean();
    if (!employee) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'EMPLOYEE_NOT_FOUND',
        MESSAGE: 'Employee not found',
      });
    }
    if (!employee.department) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'EMPLOYEE_NO_DEPARTMENT',
        MESSAGE: 'Employee has no department',
      });
    }

    const template = await KpiTemplateModel.findById(input.templateId).lean();
    if (!template) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'TEMPLATE_NOT_FOUND',
        MESSAGE: 'Template not found',
      });
    }
    if (String((template as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'TEMPLATE_FORBIDDEN',
        MESSAGE: 'Template does not belong to your organization',
      });
    }
    if (
      template.departmentId &&
      String(template.departmentId) !== String(employee.department)
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'TEMPLATE_DEPARTMENT_MISMATCH',
        MESSAGE: 'Template is not for this employee department',
      });
    }
    if (
      template.role &&
      employee.departmentRole &&
      template.role.toLowerCase() !==
        String(employee.departmentRole).toLowerCase()
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'ROLE_MISMATCH',
        MESSAGE: 'Employee role does not match template role',
      });
    }

    const periodId = input.periodId;
    const period = periodId
      ? await KpiPeriodModel.findById(periodId).lean()
      : await KpiPeriodModel.findOne({
          organizationId,
          status: 'active',
        } as any)
          .sort({ startDate: -1 })
          .lean();

    if (!period) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_PERIOD',
        MESSAGE: 'No active period found',
      });
    }
    if (String((period as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'PERIOD_FORBIDDEN',
        MESSAGE: 'Period does not belong to your organization',
      });
    }
    if (period.status !== 'active') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_LOCKED',
        MESSAGE: 'Period is locked/closed; entries cannot be changed',
      });
    }

    const templateItems: any[] = Array.isArray((template as any).items)
      ? (template as any).items
      : [];
    const templateItemById = new Map<string, any>();
    for (const it of templateItems) {
      const tid = String(it._id || it.id || '');
      if (tid) templateItemById.set(tid, it);
    }

    const storedItems = input.items.map((i) => {
      const t = templateItemById.get(String(i.templateItemId));
      if (!t) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'INVALID_TEMPLATE_ITEM',
          MESSAGE: `Template item not found: ${i.templateItemId}`,
        });
      }

      const maxMarks = Number(t.maxMarks ?? 0);
      const inputType = String(t.inputType ?? 'number');
      const awardedMarks = computeMarks({
        maxMarks,
        judgement: t.judgement,
        inputValueNumber: i.inputValueNumber,
        inputValueBoolean: i.inputValueBoolean,
      });

      return {
        templateItemId: String(i.templateItemId),
        title: String(t.title),
        inputType,
        inputValueNumber: i.inputValueNumber,
        inputValueBoolean: i.inputValueBoolean,
        maxMarks,
        awardedMarks,
        remarks: i.remarks,
      };
    });

    const totalMarks = storedItems.reduce(
      (sum, it) => sum + Number(it.maxMarks || 0),
      0
    );
    const obtainedMarks = storedItems.reduce(
      (sum, it) => sum + Number(it.awardedMarks || 0),
      0
    );

    const entry = await KpiEntryModel.findOneAndUpdate(
      {
        organizationId,
        employeeId: input.employeeId,
        periodId: (period as any)._id,
        templateId: input.templateId,
      } as any,
      {
        $set: {
          organizationId,
          departmentId: employee.department,
          periodId: (period as any)._id,
          templateId: input.templateId,
          employeeId: input.employeeId,
          roleSnapshot: employee.departmentRole || template.role,
          items: storedItems,
          totalMarks,
          obtainedMarks,
          status: 'draft',
        },
      },
      { upsert: true, new: true }
    ).lean();

    return entry;
  }

  /**
   * Same columns as the blank import template, with cells filled from saved entries for the period
   * (any period status when `periodId` is set; default period is current **active**).
   */
  static async getImportFormatExportData(params: {
    organizationId: string;
    templateId: string;
    departmentId: string;
    periodId?: string;
  }) {
    const {
      organizationId,
      templateId,
      departmentId,
      periodId: periodIdParam,
    } = params;

    const template = await KpiTemplateModel.findById(templateId).lean();
    if (!template) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'TEMPLATE_NOT_FOUND',
        MESSAGE: 'Template not found',
      });
    }
    if (String((template as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'TEMPLATE_FORBIDDEN',
        MESSAGE: 'Template does not belong to your organization',
      });
    }
    if (
      (template as any).departmentId &&
      String((template as any).departmentId) !== departmentId
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'TEMPLATE_DEPARTMENT_MISMATCH',
        MESSAGE: 'Template is not for this department',
      });
    }

    const period = periodIdParam
      ? await KpiPeriodModel.findById(periodIdParam).lean()
      : await KpiPeriodModel.findOne({
          organizationId,
          status: 'active',
        } as any)
          .sort({ startDate: -1 })
          .lean();

    if (!period) {
      throw new APIError({
        STATUS: periodIdParam ? 404 : 400,
        TITLE: periodIdParam ? 'PERIOD_NOT_FOUND' : 'NO_ACTIVE_PERIOD',
        MESSAGE: periodIdParam ? 'Period not found' : 'No active period found',
      });
    }
    if (String((period as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'PERIOD_FORBIDDEN',
        MESSAGE: 'Period does not belong to your organization',
      });
    }

    const employees = await EmployeeModal.find({
      department: departmentId,
    } as any)
      .select('_id name email phone departmentRole')
      .lean();

    const items: any[] = Array.isArray((template as any).items)
      ? (template as any).items
      : [];
    const itemHeaders = items.map((it) =>
      formatKpiEntryImportValueHeader(it, String(it._id || it.id))
    );
    const remarkHeaders = items.map((it) =>
      formatKpiEntryImportRemarkHeader(it, String(it._id || it.id))
    );

    const header = [
      'employeeId',
      'name',
      'email',
      'phone',
      ...itemHeaders,
      ...remarkHeaders,
    ];

    const filtered = employees.filter((e) => {
      if (!(template as any).role) return true;
      return (
        String(e.departmentRole || '').toLowerCase() ===
        String((template as any).role).toLowerCase()
      );
    });

    const empIds = filtered.map((e) => (e as any)._id);
    const entries = await KpiEntryModel.find({
      organizationId,
      templateId,
      periodId: (period as any)._id,
      employeeId: { $in: empIds },
    } as any).lean();

    const entryByEmp = new Map<string, any>();
    for (const ent of entries) {
      entryByEmp.set(String((ent as any).employeeId), ent);
    }

    const rows = filtered.map((e) => {
      const eid = String((e as any)._id);
      const entry = entryByEmp.get(eid);
      const lineByTid = new Map<string, any>();
      if (entry && Array.isArray((entry as any).items)) {
        for (const line of (entry as any).items) {
          lineByTid.set(String(line.templateItemId), line);
        }
      }

      const base: Record<string, unknown> = {
        employeeId: eid,
        name: (e as any).name || '',
        email: (e as any).email || '',
        phone: (e as any).phone || '',
      };

      items.forEach((it, idx) => {
        const tid = String(it._id || it.id);
        const line = lineByTid.get(tid);
        base[itemHeaders[idx]!] = formatExportCellForStoredItem(line ?? null);
        const rem = line?.remarks;
        base[remarkHeaders[idx]!] =
          rem != null && rem !== '' ? String(rem) : '';
      });

      return base;
    });

    return {
      header,
      rows,
      periodId: String((period as any)._id),
    };
  }

  static async bulkUpsertDraftFromRows(params: {
    organizationId: string;
    templateId: string;
    departmentId: string;
    periodId?: string;
    /** rows are key/value objects from CSV/XLSX */
    rows: Record<string, unknown>[];
  }) {
    const { organizationId, templateId, departmentId, periodId, rows } = params;

    const [template, period, employees] = await Promise.all([
      KpiTemplateModel.findById(templateId).lean(),
      periodId
        ? KpiPeriodModel.findById(periodId).lean()
        : KpiPeriodModel.findOne({ organizationId, status: 'active' } as any)
            .sort({ startDate: -1 })
            .lean(),
      EmployeeModal.find({ department: departmentId } as any)
        .select('_id name email phone departmentRole department')
        .lean(),
    ]);

    if (!template) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'TEMPLATE_NOT_FOUND',
        MESSAGE: 'Template not found',
      });
    }
    if (String((template as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'TEMPLATE_FORBIDDEN',
        MESSAGE: 'Template does not belong to your organization',
      });
    }
    if (
      (template as any).departmentId &&
      String((template as any).departmentId) !== String(departmentId)
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'TEMPLATE_DEPARTMENT_MISMATCH',
        MESSAGE: 'Template is not for this department',
      });
    }

    if (!period) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ACTIVE_PERIOD',
        MESSAGE: 'No active period found',
      });
    }
    if (String((period as any).organizationId) !== organizationId) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'PERIOD_FORBIDDEN',
        MESSAGE: 'Period does not belong to your organization',
      });
    }
    if ((period as any).status !== 'active') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_LOCKED',
        MESSAGE: 'Period is locked/closed; entries cannot be changed',
      });
    }

    const templateItems: any[] = Array.isArray((template as any).items)
      ? (template as any).items
      : [];
    const templateItemIds = templateItems
      .map((it) => String(it._id || it.id))
      .filter(Boolean);
    const itemById = new Map<string, any>();
    templateItems.forEach((it) => itemById.set(String(it._id || it.id), it));

    const employeeById = new Map<string, any>();
    employees.forEach((e) => employeeById.set(String((e as any)._id), e));

    const errors: BulkEntryError[] = [];
    const ops: any[] = [];
    let upsertCandidates = 0;

    const getVal = (obj: Record<string, unknown>, key: string) => {
      const direct = obj[key];
      if (direct !== undefined) return direct;
      // try case-insensitive match
      const kLower = key.toLowerCase();
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase() === kLower) return v;
      }
      return undefined;
    };

    rows.forEach((row, idx) => {
      const rowNum = idx + 2; // header is row 1
      const employeeId = String(getVal(row, 'employeeId') || '').trim();
      if (!employeeId) {
        errors.push({ row: rowNum, message: 'Missing employeeId' });
        return;
      }
      const employee = employeeById.get(employeeId);
      if (!employee) {
        errors.push({
          row: rowNum,
          employeeId,
          message: 'Employee not found in this department',
        });
        return;
      }

      // role check (if template role exists)
      if ((template as any).role && employee.departmentRole) {
        if (
          String(employee.departmentRole).toLowerCase() !==
          String((template as any).role).toLowerCase()
        ) {
          errors.push({
            row: rowNum,
            employeeId,
            message: 'Employee role does not match template role',
          });
          return;
        }
      }

      const storedItems = templateItemIds.map((tid) => {
        const t = itemById.get(tid);
        const maxMarks = Number(t.maxMarks ?? 0);
        const inputType = String(t.inputType ?? 'number');
        const valueKey = resolveImportColumnKey(row, tid, 'value');
        const remarksKey = resolveImportColumnKey(row, tid, 'remark');
        const raw = getVal(row, valueKey);
        const rawRemarks = getVal(row, remarksKey);

        let inputValueNumber: number | undefined;
        let inputValueBoolean: boolean | undefined;
        if (inputType === 'boolean') {
          const s = String(raw ?? '')
            .trim()
            .toLowerCase();
          inputValueBoolean =
            s === 'true' || s === '1' || s === 'yes' || s === 'y';
        } else {
          const n = Number(String(raw ?? '').trim());
          inputValueNumber = Number.isFinite(n) ? n : 0;
        }

        const awardedMarks = computeMarks({
          maxMarks,
          judgement: t.judgement,
          inputValueNumber,
          inputValueBoolean,
        });

        return {
          templateItemId: tid,
          title: String(t.title),
          inputType,
          inputValueNumber,
          inputValueBoolean,
          maxMarks,
          awardedMarks,
          remarks: rawRemarks ? String(rawRemarks) : undefined,
        };
      });

      const totalMarks = storedItems.reduce(
        (sum, it) => sum + Number(it.maxMarks || 0),
        0
      );
      const obtainedMarks = storedItems.reduce(
        (sum, it) => sum + Number(it.awardedMarks || 0),
        0
      );

      upsertCandidates += 1;
      ops.push({
        updateOne: {
          filter: {
            organizationId,
            employeeId: employeeId,
            periodId: (period as any)._id,
            templateId,
          } as any,
          update: {
            $set: {
              organizationId,
              departmentId: employee.department,
              periodId: (period as any)._id,
              templateId,
              employeeId,
              roleSnapshot: employee.departmentRole || (template as any).role,
              items: storedItems,
              totalMarks,
              obtainedMarks,
              status: 'draft',
            },
          },
          upsert: true,
        },
      });
    });

    if (ops.length) {
      await KpiEntryModel.bulkWrite(
        ops as Parameters<typeof KpiEntryModel.bulkWrite>[0],
        {
          ordered: false,
        }
      );
    }

    return {
      processed: rows.length,
      upserted: upsertCandidates,
      errors,
      periodId: String((period as any)._id),
    };
  }

  /**
   * When a period becomes locked (cron or admin), promote remaining **`draft`** rows for that period to **`submitted`**
   * so they are not stranded after the active window. Invoked from **`periods.service`** before report snapshots.
   */
  static async submitAllDraftsForPeriod(
    organizationId: string,
    periodId: string
  ) {
    if (
      !mongoose.Types.ObjectId.isValid(organizationId) ||
      !mongoose.Types.ObjectId.isValid(periodId)
    ) {
      return { modifiedCount: 0 };
    }
    const res = await KpiEntryModel.updateMany(
      { organizationId, periodId, status: 'draft' } as any,
      { $set: { status: 'submitted' } }
    );
    return { modifiedCount: res.modifiedCount ?? 0 };
  }

  static async submitEntry(id: string, organizationId: string) {
    const entry = await KpiEntryModel.findOne({
      _id: id,
      organizationId,
    } as any).lean();
    if (!entry) return null;

    const period = await KpiPeriodModel.findById(
      (entry as any).periodId
    ).lean();
    if (!period || period.status !== 'active') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_LOCKED',
        MESSAGE: 'Period is locked/closed; cannot submit',
      });
    }

    const updated = await KpiEntryModel.findOneAndUpdate(
      { _id: id, organizationId } as any,
      { $set: { status: 'submitted' } },
      { new: true }
    ).lean();
    return updated;
  }

  static async bulkSubmitEntries(entryIds: string[], organizationId: string) {
    const unique = [
      ...new Set(entryIds.map((id) => String(id).trim()).filter(Boolean)),
    ];
    if (!unique.length) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_ENTRY_IDS',
        MESSAGE: 'Provide at least one entry id',
      });
    }

    const submitted: unknown[] = [];
    const errors: Array<{ entryId: string; message: string }> = [];

    for (const id of unique) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        errors.push({ entryId: id, message: 'Invalid entry id' });
        continue;
      }
      try {
        const entry = await KpiEntryService.submitEntry(id, organizationId);
        if (!entry) {
          errors.push({ entryId: id, message: 'Entry not found' });
        } else {
          submitted.push(entry);
        }
      } catch (e) {
        if (e instanceof APIError) {
          errors.push({ entryId: id, message: e.message || e.title });
        } else {
          throw e;
        }
      }
    }

    return {
      submitted,
      errors,
      submittedCount: submitted.length,
      errorCount: errors.length,
    };
  }

  static async getEntry(id: string, organizationId: string) {
    const entry = await KpiEntryModel.findOne({
      _id: id,
      organizationId,
    } as any)
      .populate('employeeId')
      .populate('templateId')
      .lean();
    if (!entry) return null;
    return shapePopulatedKpiEntry(entry as Record<string, unknown>);
  }

  static async getEntries(
    {
      page = 1,
      limit = 10,
      employeeId,
      periodId,
      templateId,
    }: {
      page?: number;
      limit?: number;
      employeeId?: string;
      periodId?: string;
      templateId?: string;
    },
    organizationId: string
  ) {
    const filter: any = { organizationId };
    if (employeeId) filter.employeeId = employeeId;
    if (periodId) filter.periodId = periodId;
    if (templateId) filter.templateId = templateId;

    const [docs, total] = await Promise.all([
      KpiEntryModel.find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      KpiEntryModel.countDocuments(filter),
    ]);

    return {
      docs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };
  }

  static async deleteDraft(id: string, organizationId: string) {
    const entry = await KpiEntryModel.findOne({
      _id: id,
      organizationId,
    } as any).lean();
    if (!entry) return null;
    if (entry.status !== 'draft') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NOT_DRAFT',
        MESSAGE: 'Only draft entries can be deleted',
      });
    }
    return await KpiEntryModel.findOneAndDelete({
      _id: id,
      organizationId,
    } as any).lean();
  }
}
