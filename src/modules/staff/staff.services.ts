import mongoose from 'mongoose';
import { isValidObjectId } from 'mongoose';
import APIError from '@/configs/errors/APIError';
import { EmployeeModal } from '@/modules/employee/employee.model';
import { KpiPeriodModel } from '@/modules/periods/periods.model';
import { ReportRankingModel } from '@/modules/reports/reportRanking.model';
import { compareByMarksPercentage } from '@/modules/reports/rankingOrder';

const DEFAULT_BAND = 3;

function assertStaffSession(role: string | undefined) {
  const r = String(role || '').toLowerCase();
  if (r !== 'staff') {
    throw new APIError({
      STATUS: 403,
      TITLE: 'STAFF_ONLY',
      MESSAGE: 'This endpoint is only available to staff members',
    });
  }
}

export class StaffKpiService {
  static async resolveEmployee(params: {
    userId: string;
    organizationId: string;
    role?: string;
  }) {
    assertStaffSession(params.role);

    if (!isValidObjectId(params.userId) || !isValidObjectId(params.organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_SESSION',
        MESSAGE: 'Invalid user or organization in session',
      });
    }

    const employee = await EmployeeModal.findOne({
      userId: new mongoose.Types.ObjectId(params.userId),
    } as any)
      .populate('department')
      .lean();

    if (!employee) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'EMPLOYEE_NOT_LINKED',
        MESSAGE: 'No employee record is linked to this user',
      });
    }

    const dept = (employee as any).department;
    const deptOrgId = String(dept?.organizationId || '');
    if (!dept || deptOrgId !== String(params.organizationId)) {
      throw new APIError({
        STATUS: 403,
        TITLE: 'EMPLOYEE_ORG_MISMATCH',
        MESSAGE: 'Employee does not belong to the active organization',
      });
    }

    return employee;
  }

  static async getMe(params: {
    userId: string;
    organizationId: string;
    role?: string;
  }) {
    const employee = await this.resolveEmployee(params);
    const dept = (employee as any).department;
    return {
      id: String((employee as any)._id),
      name: String((employee as any).name || ''),
      empId: String((employee as any).empId || ''),
      phone: String((employee as any).phone || ''),
      email: (employee as any).email
        ? String((employee as any).email)
        : undefined,
      departmentRole: String((employee as any).departmentRole || ''),
      department: {
        id: String(dept?._id || ''),
        name: String(dept?.name || ''),
        slug: String(dept?.slug || ''),
      },
    };
  }

  /**
   * Closed periods that have a department-scope ranking row for this employee.
   */
  static async listPeriods(params: {
    userId: string;
    organizationId: string;
    role?: string;
  }) {
    const employee = await this.resolveEmployee(params);
    const employeeId = String((employee as any)._id);
    const orgOid = new mongoose.Types.ObjectId(params.organizationId);
    const empOid = new mongoose.Types.ObjectId(employeeId);

    const rankings = await ReportRankingModel.find({
      organizationId: orgOid,
      employeeId: empOid,
      scope: 'department',
    } as any)
      .select('periodId obtainedMarks totalMarks rank')
      .lean();

    if (!rankings.length) {
      return { periods: [] as Array<Record<string, unknown>> };
    }

    const periodIds = [
      ...new Set(rankings.map((r) => String((r as any).periodId))),
    ];

    const periods = await KpiPeriodModel.find({
      _id: { $in: periodIds },
      organizationId: orgOid,
      status: 'closed',
    } as any)
      .select('name key startDate endDate status')
      .sort({ endDate: -1 })
      .lean();

    const byPeriod = new Map(
      rankings.map((r) => [String((r as any).periodId), r])
    );

    return {
      periods: periods.map((p) => {
        const rank = byPeriod.get(String((p as any)._id));
        return {
          id: String((p as any)._id),
          name: String((p as any).name || ''),
          key: String((p as any).key || ''),
          startDate: (p as any).startDate,
          endDate: (p as any).endDate,
          status: (p as any).status,
          myScore: rank
            ? {
                obtainedMarks: Number((rank as any).obtainedMarks || 0),
                totalMarks: Number((rank as any).totalMarks || 0),
                rank: Number((rank as any).rank || 0),
              }
            : undefined,
        };
      }),
    };
  }

  static async getPeriodSummary(params: {
    userId: string;
    organizationId: string;
    periodId: string;
    role?: string;
  }) {
    const employee = await this.resolveEmployee(params);
    await this.assertClosedPeriod(params.organizationId, params.periodId);

    const employeeId = String((employee as any)._id);
    const orgOid = new mongoose.Types.ObjectId(params.organizationId);
    const periodOid = new mongoose.Types.ObjectId(params.periodId);
    const empOid = new mongoose.Types.ObjectId(employeeId);

    const [department, overall] = await Promise.all([
      ReportRankingModel.findOne({
        organizationId: orgOid,
        periodId: periodOid,
        employeeId: empOid,
        scope: 'department',
      } as any).lean(),
      ReportRankingModel.findOne({
        organizationId: orgOid,
        periodId: periodOid,
        employeeId: empOid,
        scope: 'overall',
      } as any).lean(),
    ]);

    if (!department && !overall) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'RANKING_NOT_FOUND',
        MESSAGE: 'No ranking found for you in this period',
      });
    }

    const mapRow = (r: any) =>
      r
        ? {
            scope: r.scope,
            obtainedMarks: Number(r.obtainedMarks || 0),
            totalMarks: Number(r.totalMarks || 0),
            rank: Number(r.rank || 0),
            role: r.role ? String(r.role) : undefined,
            departmentId: r.departmentId
              ? String(r.departmentId)
              : undefined,
          }
        : null;

    return {
      periodId: params.periodId,
      employeeId,
      department: mapRow(department),
      overall: mapRow(overall),
    };
  }

  /**
   * Same department + same role cohort: self, top N, bottom N, cohort size.
   */
  static async getPeriodCohort(params: {
    userId: string;
    organizationId: string;
    periodId: string;
    role?: string;
    topN?: number;
    bottomN?: number;
  }) {
    const employee = await this.resolveEmployee(params);
    await this.assertClosedPeriod(params.organizationId, params.periodId);

    const employeeId = String((employee as any)._id);
    const orgOid = new mongoose.Types.ObjectId(params.organizationId);
    const periodOid = new mongoose.Types.ObjectId(params.periodId);
    const empOid = new mongoose.Types.ObjectId(employeeId);
    const topN = Math.min(Math.max(params.topN ?? DEFAULT_BAND, 1), 10);
    const bottomN = Math.min(Math.max(params.bottomN ?? DEFAULT_BAND, 1), 10);

    const self = await ReportRankingModel.findOne({
      organizationId: orgOid,
      periodId: periodOid,
      employeeId: empOid,
      scope: 'department',
    } as any).lean();

    if (!self) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'RANKING_NOT_FOUND',
        MESSAGE: 'No department ranking found for you in this period',
      });
    }

    const departmentId = (self as any).departmentId;
    const role = String((self as any).role || '').trim();

    const cohortFilter: Record<string, unknown> = {
      organizationId: orgOid,
      periodId: periodOid,
      scope: 'department',
      departmentId,
    };
    if (role) {
      cohortFilter.role = role;
    }

    const cohort = await ReportRankingModel.find(cohortFilter as any)
      .select(
        'employeeId employeeName role obtainedMarks totalMarks rank departmentId'
      )
      .lean();

    cohort.sort(compareByMarksPercentage);

    const mapPeer = (r: any, idx: number) => ({
      employeeId: String(r.employeeId),
      employeeName: String(r.employeeName || ''),
      role: r.role ? String(r.role) : undefined,
      obtainedMarks: Number(r.obtainedMarks || 0),
      totalMarks: Number(r.totalMarks || 0),
      rank: idx + 1,
      isSelf: String(r.employeeId) === employeeId,
    });

    const selfIdx = cohort.findIndex(
      (r: any) => String(r.employeeId) === employeeId
    );
    const selfRow =
      selfIdx >= 0
        ? mapPeer(cohort[selfIdx], selfIdx)
        : mapPeer(self, Number((self as any).rank || 1) - 1);
    const top = cohort.slice(0, topN).map((r, i) => mapPeer(r, i));
    const bottom =
      cohort.length <= bottomN
        ? cohort.map((r, i) => mapPeer(r, i))
        : cohort
            .slice(-bottomN)
            .map((r, i) => mapPeer(r, cohort.length - bottomN + i));

    return {
      periodId: params.periodId,
      departmentId: departmentId ? String(departmentId) : undefined,
      role: role || undefined,
      cohortSize: cohort.length,
      self: selfRow,
      top,
      bottom,
    };
  }

  private static async assertClosedPeriod(
    organizationId: string,
    periodId: string
  ) {
    if (!isValidObjectId(periodId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_PERIOD_ID',
        MESSAGE: 'Invalid period id',
      });
    }

    const period = await KpiPeriodModel.findOne({
      _id: periodId,
      organizationId,
    } as any)
      .select('status name')
      .lean();

    if (!period) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'PERIOD_NOT_FOUND',
        MESSAGE: 'Period not found',
      });
    }

    if (String((period as any).status) !== 'closed') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'REPORT_NOT_READY',
        MESSAGE: 'Staff KPI is only available for closed periods',
      });
    }

    return period;
  }
}
