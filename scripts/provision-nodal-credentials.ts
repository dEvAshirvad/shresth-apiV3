/**
 * One-time backfill: provision empId + password for nodals on the connected DB.
 *
 * SAFETY: only run against shresth_test (or another non-prod clone).
 *
 * Usage:
 *   pnpm exec tsx scripts/provision-nodal-credentials.ts
 *   pnpm exec tsx scripts/provision-nodal-credentials.ts --rotate-linked
 *   pnpm exec tsx scripts/provision-nodal-credentials.ts --skip-whatsapp
 *   pnpm exec tsx scripts/provision-nodal-credentials.ts --org <organizationId>
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  if (uri.includes('/shresth?') && !uri.includes('/shresth_test')) {
    console.error(
      'Refusing to run against prod-looking DB name `shresth`. Point MONGODB_URI at shresth_test.'
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const rotateLinked = args.includes('--rotate-linked');
  const skipWhatsApp = args.includes('--skip-whatsapp');
  const orgIdx = args.indexOf('--org');
  const orgFilter =
    orgIdx >= 0 && args[orgIdx + 1] ? String(args[orgIdx + 1]) : null;

  await mongoose.connect(uri);
  console.log('Connected:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));

  // Dynamic import after env/DB so modules read correct config
  const { NodalModal } = await import('../src/modules/nodal/nodal.model');
  const { provisionNodalCredentials } = await import(
    '../src/modules/nodal/nodal.provision'
  );

  const filter: Record<string, unknown> = {};
  if (orgFilter) filter.organizationId = orgFilter;
  if (!rotateLinked) {
    filter.$or = [
      { userId: { $exists: false } },
      { userId: null },
      { empId: { $exists: false } },
      { empId: null },
      { empId: '' },
    ];
  }

  const rows = await NodalModal.find(filter).lean();
  console.log(`Found ${rows.length} nodal(s) to process`);

  const credentials: Array<Record<string, unknown>> = [];
  const errors: Array<{ nodalId: string; message: string }> = [];

  for (const row of rows) {
    const nodalId = String((row as any)._id);
    const organizationId = String((row as any).organizationId);
    try {
      const creds = await provisionNodalCredentials({
        nodalId,
        organizationId,
        rotatePassword: Boolean((row as any).userId) && rotateLinked,
        skipWhatsApp,
      });
      credentials.push({
        nodalId: creds.nodalId,
        name: creds.name,
        phone: creds.phone,
        email: creds.email || '',
        empId: creds.empId,
        password: creds.password,
        whatsappOk: creds.whatsapp.ok,
        whatsappMessage: creds.whatsapp.message || '',
      });
      console.log(`OK ${creds.empId} (${creds.name})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ nodalId, message });
      console.error(`FAIL ${nodalId}: ${message}`);
    }
  }

  const outDir = path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outDir, `nodal-credentials-backfill-${stamp}.csv`);
  const header =
    'nodalId,name,phone,email,empId,password,whatsappOk,whatsappMessage\n';
  const body = credentials
    .map((c) =>
      [
        c.nodalId,
        JSON.stringify(c.name),
        c.phone,
        c.email,
        c.empId,
        c.password,
        c.whatsappOk,
        JSON.stringify(c.whatsappMessage || ''),
      ].join(',')
    )
    .join('\n');
  fs.writeFileSync(csvPath, header + body + '\n', 'utf8');
  console.log(`Wrote ${credentials.length} credentials to ${csvPath}`);
  console.log(`Errors: ${errors.length}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
