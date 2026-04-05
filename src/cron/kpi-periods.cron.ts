import cron from 'node-cron';
import logger from '@/configs/logger/winston';
import { KpiPeriodService } from '@/modules/periods/periods.service';
import { ReportZipService } from '@/modules/reports/reportZip.service';

/**
 * Runs daily at 11:59 PM server local time.
 * If you want a fixed timezone, set process.env.TZ at runtime.
 */
export function startKpiPeriodCron() {
  cron.schedule('59 23 * * *', async () => {
    try {
      const result = await KpiPeriodService.runDailyMaintenance(new Date());
      const cleanup = await ReportZipService.cleanupExpiredArtifacts(new Date());
      logger.info('KPI period cron ran', result);
      if (cleanup.deletedArtifacts > 0) {
        logger.info('Expired report ZIP artifacts cleaned', cleanup);
      }
    } catch (err) {
      logger.error('KPI period cron crashed', err);
    }
  });
}

