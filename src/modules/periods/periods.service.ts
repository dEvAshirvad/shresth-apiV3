import APIError from '@/configs/errors/APIError';
import mongoose from 'mongoose';
import logger from '@/configs/logger/winston';
import {
  KpiPeriodConfigModel,
  KpiPeriodModel,
  KpiPeriodConfigPutBody,
} from './periods.model';
import { KpiEntryModel } from '../entries/entries.model';
import { KpiEntryService } from '../entries/entries.service';
import { KpiReportService } from '../reports/reports.service';

function toUTCDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

function daysInMonthUTC(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function addMonthsClampedUTC(date: Date, monthsToAdd: number, anchorDay: number) {
  const year = date.getUTCFullYear();
  const month0 = date.getUTCMonth();
  const targetMonth0 = month0 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonth0 / 12);
  const modMonth0 = ((targetMonth0 % 12) + 12) % 12;
  const dim = daysInMonthUTC(targetYear, modMonth0);
  const day = Math.min(anchorDay, dim);
  return toUTCDate(targetYear, modMonth0, day);
}

function periodKey(startDate: Date) {
  const y = startDate.getUTCFullYear();
  const m = String(startDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(startDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function periodName(startDate: Date, frequencyMonths: number) {
  const base = startDate.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return frequencyMonths === 1 ? base : `${base} (+${frequencyMonths}mo)`;
}

function diffMonthsUTC(a: Date, b: Date) {
  // b - a in months (approx by year+month)
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function parseStartDateToUTC(input: string | Date): Date {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new APIError({
      STATUS: 400,
      TITLE: 'INVALID_START_DATE',
      MESSAGE: 'startDate must be a valid ISO date or date string',
    });
  }
  return toUTCDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * First KPI cycle from org anchor (k=0): e.g. startDate 7 Apr → end 6 May for monthly.
 * Used on initial `POST /start` so the period always matches configured `startDate`, not “today”.
 */
function getFirstPeriodMetaFromAnchor(startedAt: Date, frequencyMonths: number) {
  const anchorDay = startedAt.getUTCDate();
  const anchorStart = toUTCDate(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), anchorDay);
  const step = Math.max(1, frequencyMonths);
  const startDate = anchorStart;
  const nextStartDate = addMonthsClampedUTC(startDate, step, anchorDay);
  const endDate = toUTCDate(
    nextStartDate.getUTCFullYear(),
    nextStartDate.getUTCMonth(),
    nextStartDate.getUTCDate() - 1
  );
  return {
    startDate,
    nextStartDate,
    endDate,
    key: periodKey(startDate),
    name: periodName(startDate, step),
  };
}

function getAnchoredPeriodMeta(now: Date, startedAt: Date, frequencyMonths: number) {
  const anchorDay = startedAt.getUTCDate();
  const anchorStart = toUTCDate(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), anchorDay);

  const monthsDiff = diffMonthsUTC(anchorStart, now);
  const step = Math.max(1, frequencyMonths);
  /** Never use a negative segment (before anchor): before anchor, stay on first cycle k=0. */
  const k = Math.max(0, Math.floor(monthsDiff / step));

  const startDate = addMonthsClampedUTC(anchorStart, k * step, anchorDay);
  const nextStartDate = addMonthsClampedUTC(startDate, step, anchorDay);
  const endDate = toUTCDate(
    nextStartDate.getUTCFullYear(),
    nextStartDate.getUTCMonth(),
    nextStartDate.getUTCDate() - 1
  );

  return {
    startDate,
    nextStartDate,
    endDate,
    key: periodKey(startDate),
    name: periodName(startDate, step),
  };
}

/** Inclusive end date → exclusive next cycle; next period starts the following UTC calendar day. */
function addDaysUTC(d: Date, days: number): Date {
  return toUTCDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days);
}

/** Minimum inclusive endDate allowed for admin edits: today (UTC) + lockingPeriodDays. */
function minAllowedEndDateUTC(lockingPeriodDays: number, now: Date = new Date()): Date {
  const today = toUTCDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return addDaysUTC(today, Math.max(1, lockingPeriodDays));
}

/**
 * Next period after a chain end date: start = end+1 day, end = day before (start + frequencyMonths).
 * Uses **`startDate.getUTCDate()`** as the month-step anchor (same calendar day in the target month, clamped).
 * Org **`startedAt`** day must not be used here: after an irregular close (e.g. end Mar 31 → start Apr 1), using
 * anchor 31 would make `addMonthsClampedUTC(Apr 1, 1, 31)` land on May 31 and yield Apr 1–May 30 (~two months).
 * With segment day **1**, Apr 1 + 1 month → May 1 → end Apr 30 (one monthly span).
 */
function nextPeriodBoundsFromChainEnd(previousEndDate: Date, frequencyMonths: number) {
  const startDate = addDaysUTC(previousEndDate, 1);
  const step = Math.max(1, frequencyMonths);
  const segmentDay = startDate.getUTCDate();
  const nextCycleStart = addMonthsClampedUTC(startDate, step, segmentDay);
  const endDate = toUTCDate(
    nextCycleStart.getUTCFullYear(),
    nextCycleStart.getUTCMonth(),
    nextCycleStart.getUTCDate() - 1
  );
  return {
    startDate,
    endDate,
    key: periodKey(startDate),
    name: periodName(startDate, step),
  };
}

/**
 * Activates the next KPI period after a chain end.
 *
 * When **`next.key`** equals the closing row’s **`key`** (same calendar segment, e.g. chain end Mar 31 → next start Apr 1
 * still **`2026-04-01`**), we **must not** `$set` the same document to active: that would delete the closed row from
 * history and make **`GET /periods`** look unchanged. Instead: **rename** the closed row to an archival **`key`**
 * (unique under `{ organizationId, key }`), then **insert** a new active period (new **`_id`**). Reports and entries for
 * the closed cycle keep pointing at the archived row’s id.
 *
 * Otherwise we upsert by **`{ organizationId, key }`** with **`$set`**.
 */
async function activateNextPeriodAfterChainEnd(params: {
  organizationId: string;
  closingPeriodId: string;
  closingPeriodKey: string;
  chainEndInclusive: Date;
  frequencyMonths: number;
}) {
  const { organizationId, closingPeriodId, closingPeriodKey, chainEndInclusive, frequencyMonths } =
    params;
  const orgOid = new mongoose.Types.ObjectId(organizationId);
  const next = nextPeriodBoundsFromChainEnd(chainEndInclusive, frequencyMonths);

  const setDoc = {
    organizationId: orgOid,
    frequencyMonths,
    key: next.key,
    name: next.name,
    startDate: next.startDate,
    endDate: next.endDate,
    status: 'active' as const,
  };

  if (next.key === closingPeriodKey) {
    const oid = new mongoose.Types.ObjectId(closingPeriodId);
    const archivedKey = `${closingPeriodKey}~${periodKey(chainEndInclusive)}`;
    await KpiPeriodModel.updateOne({ _id: oid } as any, {
      $set: {
        key: archivedKey,
        status: 'closed',
        endDate: chainEndInclusive,
      },
    });
    const created = (await KpiPeriodModel.create({
      organizationId,
      frequencyMonths,
      key: next.key,
      name: next.name,
      startDate: next.startDate,
      endDate: next.endDate,
      status: 'active',
    } as any)) as { _id: mongoose.Types.ObjectId };
    return KpiPeriodModel.findById(created._id).lean();
  }

  const upserted = await KpiPeriodModel.findOneAndUpdate(
    { organizationId: orgOid, key: next.key } as any,
    { $set: setDoc },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  if (upserted) {
    return upserted;
  }

  return KpiPeriodModel.findOne({ organizationId: orgOid, key: next.key } as any).lean();
}

export class KpiPeriodService {
  /**
   * After the system has started, KPI settings may only change while the latest period is `locked`
   * (entries frozen, reports snapshot) — the stable window before the next cycle activates.
   */
  static async assertConfigChangeAllowedWhenStarted(organizationId: string) {
    const latest = await KpiPeriodModel.findOne({ organizationId } as any)
      .sort({ startDate: -1 })
      .lean();
    if (!latest) return;
    if (latest.status !== 'locked') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_CONFIG_CHANGE_NOT_ALLOWED',
        MESSAGE:
          'KPI period settings can only be updated while the current period is locked (after lock, before the next period starts).',
      });
    }
  }

  static async start(organizationId: string) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const existing = await KpiPeriodConfigModel.findOne({ organizationId } as any).lean();
    if (existing?.isStarted) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_ALREADY_STARTED',
        MESSAGE: 'Period system already started. Start API can only be used once.',
      });
    }

    if (!existing?.pendingStartDate) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_CONFIG_INCOMPLETE',
        MESSAGE:
          'Configure frequency, locking period, and startDate with PUT /api/v1/periods/config before starting.',
      });
    }

    const startedAt = parseStartDateToUTC(new Date(existing.pendingStartDate));

    const nextConfig = await KpiPeriodConfigModel.findOneAndUpdate(
      { organizationId } as any,
      {
        $set: { isStarted: true, startedAt },
        $unset: { pendingStartDate: 1 },
      },
      { returnDocument: 'after' }
    ).lean();

    if (!nextConfig) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'PERIOD_CONFIG_MISSING',
        MESSAGE: 'KPI period config was not found after update',
      });
    }

    const period = await this.ensureCurrentPeriod(organizationId);
    if (!period) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'PERIOD_BOOTSTRAP_FAILED',
        MESSAGE: 'Could not create the first KPI period',
      });
    }
    return { config: nextConfig, period };
  }

  static async updateConfig(organizationId: string, body: KpiPeriodConfigPutBody) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const existing = await KpiPeriodConfigModel.findOne({ organizationId } as any).lean();

    if (existing?.isStarted) {
      if (body.startDate !== undefined) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'VALIDATION_ERROR',
          MESSAGE: 'startDate cannot be changed after the KPI period system has started',
        });
      }
      await this.assertConfigChangeAllowedWhenStarted(organizationId);

      const $set: Record<string, number> = {};
      if (body.frequencyMonths !== undefined) $set.frequencyMonths = body.frequencyMonths;
      if (body.lockingPeriodDays !== undefined) $set.lockingPeriodDays = body.lockingPeriodDays;
      if (Object.keys($set).length === 0) {
        return existing;
      }

      const config = await KpiPeriodConfigModel.findOneAndUpdate(
        { organizationId } as any,
        { $set },
        { returnDocument: 'after' }
      ).lean();

      await this.ensureCurrentPeriod(organizationId);
      return config;
    }

    // Not started: require frequency (months), locking (days), and startDate every time.
    if (
      body.frequencyMonths === undefined ||
      body.lockingPeriodDays === undefined ||
      body.startDate === undefined
    ) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_CONFIG_INCOMPLETE',
        MESSAGE:
          'Before starting, send frequencyMonths (≥1), lockingPeriodDays (≥1), and startDate (anchor for automation).',
      });
    }

    const pendingStartDate = parseStartDateToUTC(body.startDate);

    const config = await KpiPeriodConfigModel.findOneAndUpdate(
      { organizationId } as any,
      {
        $set: {
          frequencyMonths: body.frequencyMonths,
          lockingPeriodDays: body.lockingPeriodDays,
          pendingStartDate,
          isStarted: false,
        },
        $setOnInsert: { organizationId },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    return config;
  }

  static async ensureCurrentPeriod(organizationId: string) {
    const config = await KpiPeriodConfigModel.findOne({ organizationId } as any).lean();
    if (!config?.isStarted) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_NOT_STARTED',
        MESSAGE: 'Period system is not started yet. Call start API once first.',
      });
    }
    if (!config.startedAt) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'PERIOD_CONFIG_INVALID',
        MESSAGE: 'Period config is started but startedAt is missing',
      });
    }

    const existingActive = await KpiPeriodModel.findOne({ organizationId, status: 'active' } as any).lean();
    if (existingActive) {
      return existingActive;
    }

    const periodCount = await KpiPeriodModel.countDocuments({ organizationId } as any);
    if (periodCount > 0) {
      const lockedPeriod = await KpiPeriodModel.findOne({ organizationId, status: 'locked' } as any)
        .sort({ startDate: -1 })
        .lean();
      if (lockedPeriod) {
        // No active row while current cycle is locked (pre-close). Do not bootstrap a second "active" period
        // from getAnchoredPeriodMeta — cron or admin force-lock will close and insert the real next period.
        return null;
      }
    }

    const startedAtDate = new Date(config.startedAt);
    const frequencyMonths = Number(config.frequencyMonths || 1);

    /** First row for the org must match configured anchor, not “current” calendar segment. */
    const meta =
      periodCount === 0
        ? getFirstPeriodMetaFromAnchor(startedAtDate, frequencyMonths)
        : getAnchoredPeriodMeta(new Date(), startedAtDate, frequencyMonths);

    const period = await KpiPeriodModel.findOneAndUpdate(
      { organizationId, key: meta.key } as any,
      {
        $setOnInsert: {
          organizationId,
          frequencyMonths: config.frequencyMonths,
          key: meta.key,
          name: meta.name,
          startDate: meta.startDate,
          endDate: meta.endDate,
          status: 'active',
        },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    return period;
  }

  static async listPeriods(
    organizationId: string,
    params: {
      page?: number;
      limit?: number;
      status?: 'active' | 'locked' | 'closed';
    }
  ) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    const page = params.page && params.page > 0 ? params.page : 1;
    const limit =
      params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 20;

    const filter: any = { organizationId };
    if (params.status) {
      filter.status = params.status;
    }

    const [docs, total] = await Promise.all([
      KpiPeriodModel.find(filter)
        .sort({ startDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      KpiPeriodModel.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      docs,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  static async getPeriodById(organizationId: string, periodId: string) {
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(periodId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ID',
        MESSAGE: 'Invalid organization or period id',
      });
    }

    return KpiPeriodModel.findOne({ _id: periodId, organizationId } as any).lean();
  }

  /** KPI period settings row for the org (`kpi_period_configs`), or `null` if never configured. */
  static async getPeriodConfig(organizationId: string) {
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ORGANIZATION_ID',
        MESSAGE: 'Invalid organization id',
      });
    }

    return KpiPeriodConfigModel.findOne({ organizationId } as any).lean();
  }

  /**
   * Cron entry point (daily 11:59 PM).
   * Uses the **active** period’s stored `endDate`: next cycle starts the day after `endDate`.
   * - Lock while now is in [nextStart - lockingDays, nextStart).
   * - Roll when now >= nextStart (close current, create next from chain).
   */
  static async runDailyMaintenance(now: Date = new Date()) {
    const configs = await KpiPeriodConfigModel.find({ isStarted: true } as any).lean();
    if (!configs.length) return { processed: 0 };

    for (const cfg of configs) {
      try {
        if (!cfg.organizationId || !cfg.startedAt) continue;

        const organizationId = String(cfg.organizationId);
        const frequencyMonths = Number(cfg.frequencyMonths || 1);
        const lockingDays = Math.max(1, Number(cfg.lockingPeriodDays || 1));

        let current = await KpiPeriodModel.findOne({ organizationId, status: 'active' } as any).lean();

        if (!current) {
          const lockedLatest = await KpiPeriodModel.findOne({ organizationId, status: 'locked' } as any)
            .sort({ startDate: -1 })
            .lean();
          if (lockedLatest) {
            current = lockedLatest;
          } else {
            await this.ensureCurrentPeriod(organizationId);
            current = await KpiPeriodModel.findOne({ organizationId, status: 'active' } as any).lean();
          }
        }
        if (!current) continue;

        const endDate = new Date((current as any).endDate);
        const nextStartDate = addDaysUTC(endDate, 1);
        const lockAt = new Date(
          nextStartDate.getTime() - lockingDays * 24 * 60 * 60 * 1000
        );

        const st = (current as any).status as string;
        if (now >= nextStartDate && (st === 'active' || st === 'locked')) {
          if (st === 'active') {
            await KpiPeriodModel.updateOne({ _id: (current as any)._id } as any, {
              $set: { status: 'locked' },
            });
            await KpiEntryService.submitAllDraftsForPeriod(
              organizationId,
              String((current as any)._id)
            );
            await KpiReportService.generateIfMissingForLockedPeriod(
              organizationId,
              String((current as any)._id)
            );
          }
          await KpiPeriodModel.updateOne({ _id: (current as any)._id } as any, {
            $set: { status: 'closed' },
          });
          const rolled = await activateNextPeriodAfterChainEnd({
            organizationId,
            closingPeriodId: String((current as any)._id),
            closingPeriodKey: String((current as any).key),
            chainEndInclusive: endDate,
            frequencyMonths,
          });
          if (!rolled) {
            logger.error('KPI period cron: activateNextPeriodAfterChainEnd returned no document', {
              organizationId,
              closingPeriodId: String((current as any)._id),
            });
          }
          continue;
        }

        if (st === 'active' && now >= lockAt && now < nextStartDate) {
          await KpiPeriodModel.updateOne({ _id: (current as any)._id } as any, {
            $set: { status: 'locked' },
          });
          await KpiEntryService.submitAllDraftsForPeriod(
            organizationId,
            String((current as any)._id)
          );
          await KpiReportService.generateIfMissingForLockedPeriod(
            organizationId,
            String((current as any)._id)
          );
        }
      } catch (err) {
        logger.error('KPI period cron maintenance failed', err);
      }
    }

    return { processed: configs.length };
  }

  /**
   * Admin: update **`startDate`** and/or **`endDate`** on the **active** period (UTC calendar days).
   * - **`endDate` only:** same rules as before (≥ start, ≥ today + lockingPeriodDays).
   * - **`startDate`:** allowed only when there are **no** KPI entries for this period; must not overlap the
   *   previous period’s inclusive range; **`key`** / **`name`** are recomputed from the new start.
   */
  static async adminUpdatePeriodDates(
    organizationId: string,
    periodId: string,
    input: { startDate?: string | Date; endDate?: string | Date }
  ) {
    if (input.startDate === undefined && input.endDate === undefined) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'VALIDATION_ERROR',
        MESSAGE: 'Provide at least one of startDate or endDate',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(periodId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ID',
        MESSAGE: 'Invalid organization or period id',
      });
    }

    const orgOid = new mongoose.Types.ObjectId(organizationId);
    const periodOid = new mongoose.Types.ObjectId(periodId);

    const config = await KpiPeriodConfigModel.findOne({ organizationId: orgOid } as any).lean();
    if (!config) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_CONFIG_MISSING',
        MESSAGE: 'KPI period configuration not found',
      });
    }
    const lockingDays = Math.max(1, Number(config.lockingPeriodDays || 1));

    const period = await KpiPeriodModel.findOne({
      _id: periodOid,
      organizationId: orgOid,
    } as any).lean();

    if (!period) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'PERIOD_NOT_FOUND',
        MESSAGE: 'Period not found',
      });
    }

    if ((period as any).status !== 'active') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_NOT_ACTIVE',
        MESSAGE: 'Only an active period’s dates can be changed this way',
      });
    }

    const frequencyMonths = Math.max(1, Number((period as any).frequencyMonths || 1));
    const currentStart = parseStartDateToUTC(new Date((period as any).startDate));
    const currentEnd = parseStartDateToUTC(new Date((period as any).endDate));

    const newStart =
      input.startDate !== undefined ? parseStartDateToUTC(input.startDate) : currentStart;
    const newEnd = input.endDate !== undefined ? parseStartDateToUTC(input.endDate) : currentEnd;

    if (newEnd.getTime() < newStart.getTime()) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'END_BEFORE_START',
        MESSAGE: 'endDate cannot be before startDate',
      });
    }

    if (input.endDate !== undefined) {
      const minEnd = minAllowedEndDateUTC(lockingDays);
      if (newEnd.getTime() < minEnd.getTime()) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'END_DATE_TOO_SOON',
          MESSAGE: `endDate must be on or after ${minEnd.toISOString().slice(0, 10)} (today UTC + lockingPeriodDays = ${lockingDays}).`,
        });
      }
    }

    if (input.startDate !== undefined) {
      const entryCount = await KpiEntryModel.countDocuments({
        organizationId: orgOid,
        periodId: periodOid,
      } as any);
      if (entryCount > 0) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'PERIOD_HAS_ENTRIES',
          MESSAGE:
            'startDate cannot be changed while KPI entries exist for this period; adjust only endDate or clear entries first',
        });
      }

      const predecessor = await KpiPeriodModel.findOne({
        organizationId: orgOid,
        _id: { $ne: periodOid },
        startDate: { $lt: newStart },
      } as any)
        .sort({ startDate: -1 })
        .lean();

      if (predecessor) {
        const prevEnd = parseStartDateToUTC(new Date((predecessor as any).endDate));
        const mustStartOnOrAfter = addDaysUTC(prevEnd, 1);
        if (newStart.getTime() < mustStartOnOrAfter.getTime()) {
          throw new APIError({
            STATUS: 400,
            TITLE: 'START_OVERLAPS_PREVIOUS_PERIOD',
            MESSAGE: `startDate must be on or after the day after the previous period’s end (${mustStartOnOrAfter.toISOString().slice(0, 10)} UTC)`,
          });
        }
      }

      const newKey = periodKey(newStart);
      const keyConflict = await KpiPeriodModel.findOne({
        organizationId: orgOid,
        key: newKey,
        _id: { $ne: periodOid },
      } as any)
        .select('_id')
        .lean();
      if (keyConflict) {
        throw new APIError({
          STATUS: 400,
          TITLE: 'PERIOD_KEY_CONFLICT',
          MESSAGE: 'Another period already uses this derived key; choose a different startDate',
        });
      }
    }

    const $set: Record<string, unknown> = {};
    if (input.startDate !== undefined) {
      $set.startDate = newStart;
      $set.key = periodKey(newStart);
      $set.name = periodName(newStart, frequencyMonths);
    }
    if (input.endDate !== undefined) {
      $set.endDate = newEnd;
    }

    await KpiPeriodModel.updateOne({ _id: periodOid } as any, { $set });
    return KpiPeriodModel.findById(periodOid).lean();
  }

  /**
   * @deprecated Prefer {@link adminUpdatePeriodDates} with `{ endDate }` — behavior identical.
   */
  static async adminUpdateEndDate(
    organizationId: string,
    periodId: string,
    endDateInput: string | Date
  ) {
    return this.adminUpdatePeriodDates(organizationId, periodId, { endDate: endDateInput });
  }

  /**
   * Admin: lock → generate reports → set endDate to **report generation day (UTC)** → close period → create next active period (chain from that endDate).
   */
  static async adminForceLockPeriod(
    organizationId: string,
    periodId: string,
    options?: { reportDate?: string }
  ) {
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(periodId)) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_ID',
        MESSAGE: 'Invalid organization or period id',
      });
    }

    const config = await KpiPeriodConfigModel.findOne({ organizationId } as any).lean();
    if (!config?.frequencyMonths) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_CONFIG_MISSING',
        MESSAGE: 'KPI period configuration not found',
      });
    }

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

    if ((period as any).status !== 'active') {
      throw new APIError({
        STATUS: 400,
        TITLE: 'PERIOD_NOT_ACTIVE',
        MESSAGE: 'Only an active period can be force-locked and rolled forward',
      });
    }

    const closingPeriodKey = String((period as any).key);

    const now = new Date();
    const reportDay = options?.reportDate
      ? parseStartDateToUTC(options.reportDate)
      : toUTCDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const periodStart = parseStartDateToUTC(new Date((period as any).startDate));
    if (reportDay.getTime() < periodStart.getTime()) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'INVALID_REPORT_DATE',
        MESSAGE:
          'reportDate must be a UTC calendar day (YYYY-MM-DD) on or after this period’s startDate. Omit reportDate to use today’s UTC date.',
      });
    }

    const frequencyMonths = Number(config.frequencyMonths || 1);

    await KpiPeriodModel.updateOne({ _id: periodId } as any, { $set: { status: 'locked' } });
    await KpiEntryService.submitAllDraftsForPeriod(organizationId, String(periodId));
    await KpiReportService.generateForPeriod(organizationId, String(periodId));

    await KpiPeriodModel.updateOne({ _id: periodId } as any, {
      $set: { endDate: reportDay, status: 'closed' },
    });

    const nextPeriod = await activateNextPeriodAfterChainEnd({
      organizationId,
      closingPeriodId: String(periodId),
      closingPeriodKey,
      chainEndInclusive: reportDay,
      frequencyMonths,
    });

    if (!nextPeriod) {
      throw new APIError({
        STATUS: 500,
        TITLE: 'NEXT_PERIOD_ACTIVATION_FAILED',
        MESSAGE:
          'The period was closed but the next active period could not be created or loaded. Check data consistency for this organization.',
      });
    }

    /** Always the row for `periodId` after roll: `closed` with archival `key` when same-segment split, else unchanged closed row. */
    const closedPeriod = await KpiPeriodModel.findById(periodId).lean();

    return { closedPeriod, nextPeriod };
  }
}

