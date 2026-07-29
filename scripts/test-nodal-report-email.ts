/**
 * Send a test nodal-style department report email for a closed period.
 *
 * Default: previous closed period with a report run, Ashirvad's Computer Science PDF,
 * to ashirvad.satapathy01@gmail.com
 *
 *   pnpm exec tsx scripts/test-nodal-report-email.ts
 *   pnpm exec tsx scripts/test-nodal-report-email.ts --to you@example.com
 *   pnpm exec tsx scripts/test-nodal-report-email.ts --period <periodId> --all-depts
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const args = process.argv.slice(2);
  const toIdx = args.indexOf('--to');
  const periodIdx = args.indexOf('--period');
  const toEmail =
    (toIdx >= 0 && args[toIdx + 1]) || 'ashirvad.satapathy01@gmail.com';
  const periodOverride =
    periodIdx >= 0 && args[periodIdx + 1] ? String(args[periodIdx + 1]) : null;
  const allDepts = args.includes('--all-depts');

  const uri = process.env.MONGODB_URI || '';
  if (uri.includes('/shresth?') && !uri.includes('/shresth_test')) {
    console.error('Refusing prod DB name `shresth`. Use shresth_test.');
    process.exit(1);
  }

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(uri);
  console.log('Connected:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));

  const { KpiPeriodModel } = await import('../src/modules/periods/periods.model');
  const { ReportRunModel } = await import(
    '../src/modules/reports/reportRuns.model'
  );
  const { ReportZipService } = await import(
    '../src/modules/reports/reportZip.service'
  );

  const orgId = '69d2e6eeb8e910d6f1ed0fa7';
  /** Ashirvad Satapathy — Computer Science */
  const ashirvadDeptId = '69d33c33dc1129e56c672fd7';

  let periodId = periodOverride;
  if (!periodId) {
    const run = await ReportRunModel.findOne({ organizationId: orgId } as any)
      .sort({ createdAt: -1 })
      .select('periodId')
      .lean();
    periodId = run ? String((run as any).periodId) : '';
  }
  if (!periodId) {
    console.error('No report run found for org');
    process.exit(1);
  }

  const period = await KpiPeriodModel.findById(periodId)
    .select('key status')
    .lean();
  console.log('Using period', {
    periodId,
    key: (period as any)?.key,
    status: (period as any)?.status,
  });
  console.log('Sending to', toEmail, allDepts ? '(all depts)' : '(Computer Science only)');

  const result = await ReportZipService.sendTestNodalReportEmail({
    organizationId: orgId,
    periodId,
    toEmail,
    departmentIds: allDepts ? undefined : [ashirvadDeptId],
  });

  console.log('Sent OK', result);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
