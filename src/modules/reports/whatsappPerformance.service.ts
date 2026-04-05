import axios from 'axios';
import mongoose from 'mongoose';
import APIError from '@/configs/errors/APIError';
import env from '@/configs/env';
import logger from '@/configs/logger/winston';
import { DepartmentModel } from '../departments/departments.model';
import { EmployeeModal } from '../employee/employee.model';
import { KpiEntryModel } from '../entries/entries.model';
import { KpiPeriodModel } from '../periods/periods.model';
import { ReportRankingModel } from './reportRanking.model';
import { ReportRunModel } from './reportRuns.model';
import type { PerformerBucket, WhatsAppSendStatus } from './whatsappReportSend.model';
import { WhatsAppReportSendModel } from './whatsappReportSend.model';
import { enqueueWhatsAppSend } from '@/jobs/kpiBackground.queue';

/** Max JSON length stored on send record for provider debugging. */
const PROVIDER_RESPONSE_MAX = 8000;
const WHATSAPP_AUTO_DELAY_MS_DEFAULT = 350;

function roleScopeKey(departmentId: string, role: string): string {
  return `${departmentId}::${role.trim().toLowerCase()}`;
}

export interface WhatsAppAPIPayload {
  apiKey: string;
  campaignName: string;
  destination: string;
  userName: string;
  templateParams: string[];
  source: string;
  media: Record<string, unknown>;
  buttons: unknown[];
  carouselCards: unknown[];
  location: Record<string, unknown>;
  attributes: Record<string, unknown>;
  paramsFallbackValue: Record<string, unknown>;
}

function campaignNames() {
  return {
    top: env.WHATSAPP_CAMPAIGN_TOP || 'Top_Perfomer_API',
    medium: env.WHATSAPP_CAMPAIGN_MEDIUM || 'Medium_Perfomer_API',
    bottom: env.WHATSAPP_CAMPAIGN_BOTTOM || 'Bottom_Performer',
  };
}

/** Normalize to 91XXXXXXXXXX (India); returns null if invalid. */
export function formatPhoneNumber(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.substring(1)}`;
  if (phone.startsWith('+91') && digits.length === 12) return digits;
  return null;
}

function maskPhone(digits: string): string {
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

/** Discrete bucket by department rank (aligned with legacy campaign logic). */
export function classifyPerformerBucket(
  userRank: number,
  totalInDepartment: number
): PerformerBucket {
  if (totalInDepartment <= 1) return 'top';
  if (totalInDepartment < 5) {
    if (userRank === 1) return 'top';
    if (userRank === totalInDepartment) return 'bottom';
    return 'medium';
  }
  if (totalInDepartment < 10) {
    if (userRank <= 2) return 'top';
    if (userRank >= totalInDepartment - 1) return 'bottom';
    return 'medium';
  }
  const topCount = Math.max(5, Math.floor(totalInDepartment * 0.05));
  const bottomCount = Math.max(5, Math.floor(totalInDepartment * 0.05));
  if (userRank <= topCount) return 'top';
  if (userRank > totalInDepartment - bottomCount) return 'bottom';
  return 'medium';
}

function createKpiSummary(entries: Array<{ items?: Array<{ title?: string; awardedMarks?: number }> }>): string {
  const lines: string[] = [];
  for (const e of entries) {
    for (const it of e.items || []) {
      const title = String(it.title || 'KPI').trim();
      const score = typeof it.awardedMarks === 'number' ? it.awardedMarks : 0;
      lines.push(`${title} : ${score.toFixed(2)}`);
    }
  }
  if (!lines.length) return 'No KPI data available';
  return lines.join(' | ');
}

function createTopPerformersSummary(
  departmentRows: Array<{ rank: number; employeeName?: string }>
): string {
  if (!departmentRows.length) return 'No ranking data available';
  return departmentRows
    .slice(0, 8)
    .map((entry, index) => {
      const rawRank = entry.rank;
      const safeRank = typeof rawRank === 'number' && rawRank > 0 ? rawRank : index + 1;
      const name = entry.employeeName?.trim() || 'Unknown';
      return `Rank ${safeRank} : ${name}`;
    })
    .join(' | ');
}

function truncateJson(val: unknown): unknown {
  try {
    const s = JSON.stringify(val);
    if (s.length <= PROVIDER_RESPONSE_MAX) return JSON.parse(s);
    return { _truncated: true, preview: s.slice(0, PROVIDER_RESPONSE_MAX) };
  } catch {
    return { _error: 'unserializable' };
  }
}

async function requireReportRun(organizationId: string, periodId: string) {
  const run = await ReportRunModel.findOne({ organizationId, periodId } as any).lean();
  if (!run) {
    throw new APIError({
      STATUS: 400,
      TITLE: 'REPORT_NOT_READY',
      MESSAGE:
        'Report snapshot has not been generated for this period yet. Generate reports after the period is locked.',
    });
  }
  return run;
}

function buildPayload(args: {
  employeeName: string;
  percentageScore: number;
  userRank: number;
  kpiSummary: string;
  topPerformers: string;
  bucket: PerformerBucket;
  destination: string;
}): WhatsAppAPIPayload {
  const names = campaignNames();
  let campaignName: string;
  let templateParams: string[];
  if (args.bucket === 'top') {
    campaignName = names.top;
    templateParams = [
      args.employeeName,
      args.percentageScore.toFixed(2),
      String(args.userRank),
      args.kpiSummary,
    ];
  } else if (args.bucket === 'bottom') {
    campaignName = names.bottom;
    templateParams = [
      args.employeeName,
      args.percentageScore.toFixed(2),
      String(args.userRank),
      args.kpiSummary,
      args.topPerformers,
    ];
  } else {
    campaignName = names.medium;
    templateParams = [
      args.employeeName,
      args.percentageScore.toFixed(2),
      String(args.userRank),
      args.kpiSummary,
      args.topPerformers,
    ];
  }

  return {
    apiKey: env.WHATSAPP_API_KEY || '',
    campaignName,
    destination: args.destination,
    userName: env.WHATSAPP_DISPLAY_NAME || 'Organization',
    templateParams,
    source: env.WHATSAPP_SOURCE || 'kpi-reports',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    attributes: {},
    paramsFallbackValue: { FirstName: 'user' },
  };
}

async function sendWhatsAppRequest(payload: WhatsAppAPIPayload): Promise<unknown> {
  const url = env.WHATSAPP_API_URL;
  if (!url) {
    throw new APIError({
      STATUS: 500,
      TITLE: 'WHATSAPP_NOT_CONFIGURED',
      MESSAGE: 'WHATSAPP_API_URL is not set',
    });
  }
  const res = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new APIError({
      STATUS: 500,
      TITLE: 'WHATSAPP_PROVIDER_ERROR',
      MESSAGE: `WhatsApp API HTTP ${res.status}`,
      META: { providerStatus: res.status, providerBody: res.data },
    });
  }
  return res.data;
}

export class WhatsappPerformanceService {
  /** Automatic trigger right after report snapshot generation paths succeed. */
  static async autoSendAfterReportGeneration(params: {
    organizationId: string;
    periodId: string;
    triggeredByUserId?: string;
  }) {
    const delayFromEnv = Number((env as any).WHATSAPP_AUTO_DELAY_MS);
    const delayMs =
      Number.isFinite(delayFromEnv) && delayFromEnv >= 0
        ? delayFromEnv
        : WHATSAPP_AUTO_DELAY_MS_DEFAULT;

    try {
      if (env.BACKGROUND_JOBS_SYNC) {
        await this.sendPerformanceBatch({
          organizationId: params.organizationId,
          periodId: params.periodId,
          dryRun: false,
          delayMs,
          resend: false,
          triggeredByUserId: params.triggeredByUserId,
        });
      } else {
        await enqueueWhatsAppSend({
          organizationId: params.organizationId,
          periodId: params.periodId,
          dryRun: false,
          delayMs,
          resend: false,
          triggeredByUserId: params.triggeredByUserId,
        });
      }
    } catch (err) {
      logger.error(
        `Auto WhatsApp send failed for org=${params.organizationId} period=${params.periodId}`,
        err
      );
    }
  }

  static async listSends(params: {
    organizationId: string;
    periodId: string;
    page?: number;
    limit?: number;
    status?: WhatsAppSendStatus;
    departmentId?: string;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const filter: Record<string, unknown> = {
      organizationId: params.organizationId,
      periodId: params.periodId,
    };
    if (params.status) filter.status = params.status;
    if (params.departmentId) filter.departmentId = params.departmentId;

    const [docs, total] = await Promise.all([
      WhatsAppReportSendModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WhatsAppReportSendModel.countDocuments(filter),
    ]);

    return {
      docs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    };
  }

  static async sendPerformanceBatch(params: {
    organizationId: string;
    periodId: string;
    dryRun: boolean;
    departmentId?: string;
    delayMs?: number;
    resend: boolean;
    triggeredByUserId?: string;
  }) {
    const { organizationId, periodId, dryRun, departmentId, resend, triggeredByUserId } =
      params;
    const delayMs = params.delayMs ?? WHATSAPP_AUTO_DELAY_MS_DEFAULT;

    if (!dryRun && (!env.WHATSAPP_API_URL || !env.WHATSAPP_API_KEY)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'WHATSAPP_NOT_CONFIGURED',
        MESSAGE:
          'Set WHATSAPP_API_URL and WHATSAPP_API_KEY in the environment to send messages (or use dryRun: true).',
      });
    }

    const period = await KpiPeriodModel.findOne({
      _id: periodId,
      organizationId,
    } as any).lean();
    if (!period) {
      throw new APIError({ STATUS: 404, TITLE: 'PERIOD_NOT_FOUND', MESSAGE: 'Period not found' });
    }

    const st = (period as { status?: string }).status;
    if (st !== 'locked' && st !== 'closed') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_NOT_READY_FOR_WHATSAPP',
        MESSAGE:
          'WhatsApp performance messages are only sent while the period is locked or closed (after report snapshots exist).',
      });
    }

    await requireReportRun(organizationId, periodId);

    const rankFilter: Record<string, unknown> = {
      organizationId,
      periodId,
      scope: 'department',
    };
    if (departmentId) rankFilter.departmentId = departmentId;

    const rankingRows = await ReportRankingModel.find(rankFilter).sort({ rank: 1 }).lean();

    if (!rankingRows.length) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_RANKING_DATA',
        MESSAGE: 'No department-scope ranking rows found for this period (reports may be empty).',
      });
    }

    // Build role-scoped ranking cohorts in-memory: department + role.
    const rowsByRoleScope = new Map<string, any[]>();
    for (const row of rankingRows as any[]) {
      const deptId = String(row.departmentId || '');
      const role = String(row.role || '').trim();
      if (!deptId || !role) continue;
      const key = roleScopeKey(deptId, role);
      const arr = rowsByRoleScope.get(key) || [];
      arr.push(row);
      rowsByRoleScope.set(key, arr);
    }

    const cohortSizeByScope = new Map<string, number>();
    const cohortRankByScopeEmployee = new Map<string, number>();
    const topPerformerSummaryByScope = new Map<string, string>();

    for (const [scope, arr] of rowsByRoleScope.entries()) {
      arr.sort((a: any, b: any) =>
        b.obtainedMarks !== a.obtainedMarks
          ? b.obtainedMarks - a.obtainedMarks
          : b.totalMarks - a.totalMarks
      );
      cohortSizeByScope.set(scope, arr.length);
      arr.forEach((r: any, idx: number) => {
        cohortRankByScopeEmployee.set(`${scope}::${String(r.employeeId)}`, idx + 1);
      });
      topPerformerSummaryByScope.set(
        scope,
        createTopPerformersSummary(
          arr.slice(0, 8).map((r: any, idx: number) => ({
            rank: idx + 1,
            employeeName: r.employeeName,
          }))
        )
      );
    }

    const deptIds = Array.from(
      new Set(rankingRows.map((r: any) => String(r.departmentId)).filter(Boolean))
    );
    const deptNameById = new Map<string, string>();
    if (deptIds.length) {
      const depts = await DepartmentModel.find({ _id: { $in: deptIds } } as any)
        .select('name')
        .lean();
      depts.forEach((d: any) => deptNameById.set(String(d._id), String(d.name || '')));
    }

    const employeeIds = Array.from(
      new Set(rankingRows.map((r: any) => String(r.employeeId)).filter(Boolean))
    );
    const employees = await EmployeeModal.find({ _id: { $in: employeeIds } } as any)
      .select('_id name phone')
      .lean();
    const employeeById = new Map<string, any>();
    for (const e of employees) employeeById.set(String((e as any)._id), e);

    const batchId = new mongoose.Types.ObjectId();
    const summary = {
      sent: 0,
      failed: 0,
      skipped: 0,
      dryRun,
    };

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < rankingRows.length; i++) {
      const row = rankingRows[i] as any;
      const employeeId = String(row.employeeId);
      const deptId = String(row.departmentId || '');
      const role = String(row.role || '').trim();
      if (!deptId || !role) {
        await WhatsAppReportSendModel.create({
          organizationId,
          periodId,
          batchId,
          employeeId: row.employeeId,
          departmentId: row.departmentId,
          employeeName: row.employeeName,
          status: 'skipped',
          performerBucket: 'medium',
          campaignName: '(skipped)',
          templateParams: [],
          dryRun,
          skipReason: 'missing_role_scope',
          triggeredByUserId: triggeredByUserId || undefined,
        });
        summary.skipped += 1;
        await delay(delayMs);
        continue;
      }

      const scope = roleScopeKey(deptId, role);
      const userRank = cohortRankByScopeEmployee.get(`${scope}::${employeeId}`) ?? 1;
      const totalInDepartment = cohortSizeByScope.get(scope) ?? 1;

      const bucket = classifyPerformerBucket(userRank, totalInDepartment);

      if (!resend) {
        const prior = await WhatsAppReportSendModel.findOne({
          organizationId,
          periodId,
          employeeId: row.employeeId,
          status: 'sent',
          dryRun: false,
        } as any).lean();
        if (prior) {
          await WhatsAppReportSendModel.create({
            organizationId,
            periodId,
            batchId,
            employeeId: row.employeeId,
            departmentId: row.departmentId,
            employeeName: row.employeeName,
            phoneDigits: undefined,
            phoneMasked: undefined,
            status: 'skipped',
            performerBucket: bucket,
            campaignName: '(skipped)',
            templateParams: [],
            dryRun,
            skipReason: 'already_sent',
            triggeredByUserId: triggeredByUserId || undefined,
          });
          summary.skipped += 1;
          await delay(delayMs);
          continue;
        }
      }

      const employee = employeeById.get(employeeId);
      if (!employee) {
        await WhatsAppReportSendModel.create({
          organizationId,
          periodId,
          batchId,
          employeeId: row.employeeId,
          departmentId: row.departmentId,
          employeeName: row.employeeName,
          status: 'skipped',
          performerBucket: bucket,
          campaignName: '(skipped)',
          templateParams: [],
          dryRun,
          skipReason: 'employee_not_found',
          triggeredByUserId: triggeredByUserId || undefined,
        });
        summary.skipped += 1;
        await delay(delayMs);
        continue;
      }

      const phoneDigits = formatPhoneNumber((employee as any).phone);
      if (!phoneDigits) {
        await WhatsAppReportSendModel.create({
          organizationId,
          periodId,
          batchId,
          employeeId: row.employeeId,
          departmentId: row.departmentId,
          employeeName: (employee as any).name,
          status: 'skipped',
          performerBucket: bucket,
          campaignName: '(skipped)',
          templateParams: [],
          dryRun,
          skipReason: 'invalid_or_missing_phone',
          triggeredByUserId: triggeredByUserId || undefined,
        });
        summary.skipped += 1;
        await delay(delayMs);
        continue;
      }

      const entries = await KpiEntryModel.find({
        organizationId,
        periodId: row.periodId,
        employeeId: row.employeeId,
      } as any)
        .select('items')
        .lean();

      const kpiSummary = createKpiSummary(entries as any[]);

      const topPerformers =
        topPerformerSummaryByScope.get(scope) || 'No ranking data available';

      const obtained = Number(row.obtainedMarks || 0);
      const totalMarks = Number(row.totalMarks || 0);
      const percentageScore = totalMarks > 0 ? (obtained / totalMarks) * 100 : 0;

      const payload = buildPayload({
        employeeName: String((employee as any).name || row.employeeName || 'Employee'),
        percentageScore,
        userRank,
        kpiSummary,
        topPerformers,
        bucket,
        destination: phoneDigits,
      });

      const baseRecord = {
        organizationId,
        periodId,
        batchId,
        employeeId: row.employeeId,
        departmentId: row.departmentId,
        employeeName: String((employee as any).name || row.employeeName),
        phoneDigits,
        phoneMasked: maskPhone(phoneDigits),
        performerBucket: bucket,
        campaignName: payload.campaignName,
        templateParams: payload.templateParams,
        dryRun,
        triggeredByUserId: triggeredByUserId || undefined,
      };

      if (dryRun) {
        await WhatsAppReportSendModel.create({
          ...baseRecord,
          status: 'sent',
          providerResponse: { dryRun: true },
          sentAt: new Date(),
        });
        summary.sent += 1;
        await delay(delayMs);
        continue;
      }

      const pending = await WhatsAppReportSendModel.create({
        ...baseRecord,
        status: 'pending',
      });

      try {
        const providerResponse = await sendWhatsAppRequest(payload);
        await WhatsAppReportSendModel.findByIdAndUpdate(pending._id, {
          status: 'sent',
          providerResponse: truncateJson(providerResponse) as any,
          sentAt: new Date(),
        } as any);
        summary.sent += 1;
      } catch (err: unknown) {
        logger.error('WhatsApp send failed', err);
        const msg =
          err instanceof APIError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        const meta = err instanceof APIError ? err.meta : undefined;
        const axiosData =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: unknown } }).response?.data
            : undefined;
        await WhatsAppReportSendModel.findByIdAndUpdate(pending._id, {
          status: 'failed',
          errorMessage: msg.slice(0, 2000),
          providerResponse: truncateJson(meta ?? axiosData ?? { message: msg }) as any,
        } as any);
        summary.failed += 1;
      }

      await delay(delayMs);
    }

    return {
      batchId: batchId.toString(),
      message: `WhatsApp batch completed (batchId=${batchId.toString()})`,
      summary,
      departmentNamesSample: deptNameById.size
        ? Object.fromEntries([...deptNameById.entries()].slice(0, 5))
        : {},
    };
  }
}
