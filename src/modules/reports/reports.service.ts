import APIError from '@/configs/errors/APIError';
import logger from '@/configs/logger/winston';
import { EmployeeModal } from '../employee/employee.model';
import { KpiEntryModel } from '../entries/entries.model';
import { KpiPeriodModel } from '../periods/periods.model';
import { ReportDepartmentRoleModel } from './reportDepartmentRole.model';
import { ReportRankingModel } from './reportRanking.model';
import { ReportRunModel } from './reportRuns.model';
import { ReportZipService } from './reportZip.service';
import { WhatsappPerformanceService } from './whatsappPerformance.service';

async function deleteReportArtifactsForPeriod(organizationId: string, periodId: string) {
  const filter = { organizationId, periodId } as any;
  await Promise.all([
    ReportRankingModel.deleteMany(filter),
    ReportDepartmentRoleModel.deleteMany(filter),
    ReportRunModel.deleteMany(filter),
  ]);
}

/** Detail endpoints must not require `period.status === 'closed'`: the same period row can become `active` again after roll-forward while the snapshot still applies to that `periodId`. */
async function requireReportRunOrThrow(organizationId: string, periodId: string) {
  const run = await ReportRunModel.findOne({ organizationId, periodId } as any).lean();
  if (!run) {
    throw new APIError({
      STATUS: 400,
      TITLE: 'REPORT_NOT_READY',
      MESSAGE:
        'Report snapshot has not been generated for this period yet (created when the period is locked or via admin).',
    });
  }
  return run;
}

export class KpiReportService {
  /** Generate snapshot once (called at lock stage). */
  static async generateForPeriod(organizationId: string, periodId: string) {
    const period = await KpiPeriodModel.findOne({
      _id: periodId,
      organizationId,
    } as any).lean();
    if (!period) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'PERIOD_NOT_FOUND',
        MESSAGE: 'Period not found',
      });
    }

    const existingRun = await ReportRunModel.findOne({ organizationId, periodId } as any).lean();
    if (existingRun) return existingRun;

    // Aggregates
    const deptRoleAgg = await KpiEntryModel.aggregate([
      { $match: { organizationId: period.organizationId, periodId: period._id } },
      {
        $group: {
          _id: { departmentId: '$departmentId', role: '$roleSnapshot' },
          employees: { $addToSet: '$employeeId' },
          totalObtainedMarks: { $sum: '$obtainedMarks' },
          totalMarks: { $sum: '$totalMarks' },
        },
      },
      {
        $project: {
          departmentId: '$_id.departmentId',
          role: { $ifNull: ['$_id.role', 'UNASSIGNED'] },
          employees: { $size: '$employees' },
          totalObtainedMarks: 1,
          totalMarks: 1,
          avgObtainedMarks: {
            $cond: [
              { $gt: [{ $size: '$employees' }, 0] },
              { $divide: ['$totalObtainedMarks', { $size: '$employees' }] },
              0,
            ],
          },
        },
      },
    ]);

    // Ranking base: marks per employee in department and overall
    const deptEmployeeAgg = await KpiEntryModel.aggregate([
      { $match: { organizationId: period.organizationId, periodId: period._id } },
      {
        $group: {
          _id: { departmentId: '$departmentId', employeeId: '$employeeId' },
          obtainedMarks: { $sum: '$obtainedMarks' },
          totalMarks: { $sum: '$totalMarks' },
          role: { $first: '$roleSnapshot' },
          divisionOrBlock: { $first: '$divisionOrBlock' },
        },
      },
      {
        $project: {
          departmentId: '$_id.departmentId',
          employeeId: '$_id.employeeId',
          obtainedMarks: 1,
          totalMarks: 1,
          role: 1,
          divisionOrBlock: 1,
        },
      },
    ]);

    // employee names (all referenced)
    const employeeIds = Array.from(new Set(deptEmployeeAgg.map((r: any) => String(r.employeeId))));
    const employeeDocs = await EmployeeModal.find({ _id: { $in: employeeIds } } as any)
      .select('_id name')
      .lean();
    const employeeNameById = new Map<string, string>();
    employeeDocs.forEach((e: any) => employeeNameById.set(String(e._id), String(e.name || '')));

    const generatedAt = new Date();
    const run = await ReportRunModel.create({
      organizationId,
      periodId,
      periodKey: String((period as any).key),
      generatedAt,
      status: 'generated',
    });

    // Write dept-role aggregates
    if (deptRoleAgg.length) {
      await ReportDepartmentRoleModel.insertMany(
        deptRoleAgg.map((r: any) => ({
          organizationId,
          periodId,
          departmentId: r.departmentId,
          role: String(r.role),
          employees: Number(r.employees || 0),
          avgObtainedMarks: Number(r.avgObtainedMarks || 0),
          totalObtainedMarks: Number(r.totalObtainedMarks || 0),
          totalMarks: Number(r.totalMarks || 0),
        })),
        { ordered: false }
      );
    }

    // Build department + overall rankings with rank numbers
    const byDept = new Map<string, any[]>();
    deptEmployeeAgg.forEach((r: any) => {
      const deptId = String(r.departmentId);
      const arr = byDept.get(deptId) || [];
      arr.push(r);
      byDept.set(deptId, arr);
    });

    const rankingDocs: any[] = [];

    // Department rankings
    for (const [deptId, arr] of byDept.entries()) {
      arr.sort((a: any, b: any) =>
        b.obtainedMarks !== a.obtainedMarks
          ? b.obtainedMarks - a.obtainedMarks
          : b.totalMarks - a.totalMarks
      );
      arr.forEach((r: any, idx: number) => {
        rankingDocs.push({
          organizationId,
          periodId,
          scope: 'department',
          departmentId: deptId,
          employeeId: r.employeeId,
          employeeName: employeeNameById.get(String(r.employeeId)),
          role: String(r.role || ''),
          divisionOrBlock: r.divisionOrBlock
            ? String(r.divisionOrBlock)
            : undefined,
          obtainedMarks: Number(r.obtainedMarks || 0),
          totalMarks: Number(r.totalMarks || 0),
          rank: idx + 1,
        });
      });
    }

    // Overall ranking
    const overall = [...deptEmployeeAgg].sort((a: any, b: any) =>
      b.obtainedMarks !== a.obtainedMarks
        ? b.obtainedMarks - a.obtainedMarks
        : b.totalMarks - a.totalMarks
    );
    overall.forEach((r: any, idx: number) => {
      rankingDocs.push({
        organizationId,
        periodId,
        scope: 'overall',
        employeeId: r.employeeId,
        employeeName: employeeNameById.get(String(r.employeeId)),
        departmentId: String(r.departmentId),
        role: String(r.role || ''),
        divisionOrBlock: r.divisionOrBlock
          ? String(r.divisionOrBlock)
          : undefined,
        obtainedMarks: Number(r.obtainedMarks || 0),
        totalMarks: Number(r.totalMarks || 0),
        rank: idx + 1,
      });
    });

    if (rankingDocs.length) {
      await ReportRankingModel.insertMany(rankingDocs, { ordered: false });
    }

    // Fire-and-forget: reporting must not fail if WhatsApp provider is down.
    void WhatsappPerformanceService.autoSendAfterReportGeneration({
      organizationId,
      periodId,
    });
    void ReportZipService.autoGenerateAndNotify(organizationId, periodId);

    return run.toObject();
  }

  static async getReportSummary(organizationId: string, periodId: string) {
    const period = await KpiPeriodModel.findOne({
      _id: periodId,
      organizationId,
    } as any).lean();
    if (!period) return null;

    return requireReportRunOrThrow(organizationId, periodId);
  }

  static async listReports(organizationId: string) {
    return await ReportRunModel.find({ organizationId } as any)
      .sort({ generatedAt: -1 })
      .lean();
  }

  static async getDepartmentRoleStats(organizationId: string, periodId: string, departmentId?: string) {
    const period = await KpiPeriodModel.findOne({ _id: periodId, organizationId } as any).lean();
    if (!period) return null;
    await requireReportRunOrThrow(organizationId, periodId);
    const filter: any = { organizationId, periodId };
    if (departmentId) filter.departmentId = departmentId;
    return await ReportDepartmentRoleModel.find(filter).sort({ departmentId: 1, employees: -1 }).lean();
  }

  static async getRanking(params: {
    organizationId: string;
    periodId: string;
    scope: 'overall' | 'department';
    departmentId?: string;
    page?: number;
    limit?: number;
  }) {
    const { organizationId, periodId, scope, departmentId, page = 1, limit = 50 } = params;
    const period = await KpiPeriodModel.findOne({ _id: periodId, organizationId } as any).lean();
    if (!period) return null;
    await requireReportRunOrThrow(organizationId, periodId);
    const filter: any = { organizationId, periodId, scope };
    if (scope === 'department') filter.departmentId = departmentId;
    const [docs, total] = await Promise.all([
      ReportRankingModel.find(filter)
        .sort({ rank: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReportRankingModel.countDocuments(filter),
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

  /** Called from cron right after locking. */
  static async generateIfMissingForLockedPeriod(organizationId: string, periodId: string) {
    try {
      await this.generateForPeriod(organizationId, periodId);
    } catch (err) {
      logger.error('Failed generating KPI report', err);
    }
  }

  /**
   * Admin: generate report snapshot for a locked or closed period. Idempotent unless `force` —
   * then existing run + aggregates are removed and rebuilt (e.g. after bad data or failed cron).
   */
  static async generateReportsForPeriodAdmin(
    organizationId: string,
    periodId: string,
    options: { force?: boolean } = {}
  ) {
    const period = await KpiPeriodModel.findOne({
      _id: periodId,
      organizationId,
    } as any).lean();
    if (!period) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'PERIOD_NOT_FOUND',
        MESSAGE: 'Period not found',
      });
    }
    const status = (period as any).status;
    if (status !== 'locked' && status !== 'closed') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'REPORT_GENERATION_REQUIRES_LOCKED_OR_CLOSED',
        MESSAGE:
          'Report generation is only allowed for periods in locked or closed status. Use admin force-lock first if you need to lock early.',
      });
    }
    if (options.force) {
      await deleteReportArtifactsForPeriod(organizationId, periodId);
    }
    return this.generateForPeriod(organizationId, periodId);
  }
}

