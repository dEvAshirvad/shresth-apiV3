import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import PDFDocument from 'pdfkit';
import APIError from '@/configs/errors/APIError';
import logger from '@/configs/logger/winston';
import { sendEmail } from '@/configs/emails';
import { DepartmentModel } from '../departments/departments.model';
import { MemberModel } from '../auth/members/members.model';
import { UserModel } from '../auth/users/users.model';
import { KpiPeriodModel } from '../periods/periods.model';
import { ReportRankingModel } from './reportRanking.model';
import { ReportRunModel } from './reportRuns.model';
import { ReportZipArtifactModel } from './reportZipArtifact.model';

const RETENTION_DAYS = 2;
const TEMP_DIR = path.resolve(process.cwd(), 'uploads', 'temp');
const PDF_TEMPLATE_VERSION = 'department-html-v2';

type RankingRow = {
  employeeId: string;
  employeeName?: string;
  role?: string;
  divisionOrBlock?: string;
  obtainedMarks: number;
  totalMarks: number;
};

function sanitizeFileName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatScore(obtained: number, total: number) {
  const pct = total > 0 ? (obtained / total) * 100 : 0;
  return `${obtained.toFixed(2)} / ${total.toFixed(2)} (${pct.toFixed(1)}%)`;
}

function monthYearFromLabel(periodLabel: string): string {
  const d = new Date(periodLabel);
  if (Number.isNaN(d.getTime())) return periodLabel;
  return d.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generatePDFHTML(args: {
  departmentName: string;
  periodLabel: string;
  roleRows: Map<string, RankingRow[]>;
}): string {
  const sortedRoles = [...args.roleRows.keys()].sort((a, b) => a.localeCompare(b));
  const roleSections = sortedRoles
    .map((role) => {
      const rows = args.roleRows.get(role) || [];
      if (!rows.length) {
        return `
          <div class="role-section">
            <h3 class="role-title">${escapeHtml(role.toUpperCase())}</h3>
            <div class="no-data">No data available for this role</div>
          </div>
        `;
      }

      const body = rows
        .map((r, idx) => {
          const rank = idx + 1;
          const pct =
            Number(r.totalMarks || 0) > 0
              ? (Number(r.obtainedMarks || 0) / Number(r.totalMarks || 0)) * 100
              : 0;
          let scoreClass = 'score-poor';
          if (pct >= 80) scoreClass = 'score-excellent';
          else if (pct >= 60) scoreClass = 'score-good';
          else if (pct >= 40) scoreClass = 'score-average';
          return `
            <tr>
              <td class="rank rank-${rank}">${rank}</td>
              <td class="name">${escapeHtml(r.employeeName || String(r.employeeId))}</td>
              <td class="division">${escapeHtml(String(r.divisionOrBlock || 'N/A'))}</td>
              <td class="score ${scoreClass}">${escapeHtml(
                formatScore(Number(r.obtainedMarks || 0), Number(r.totalMarks || 0))
              )}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <div class="role-section">
          <h3 class="role-title">${escapeHtml(role.toUpperCase())}</h3>
          <table class="ranking-table">
            <thead>
              <tr>
                <th style="width: 60px;">Rank</th>
                <th>Name</th>
                <th>Division / Block</th>
                <th style="width: 180px; text-align: right;">Score</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>Department Performance Report</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          color: #333;
          line-height: 1.6;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 3px solid #2c3e50;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #2c3e50;
          margin: 0;
          font-size: 28px;
        }
        .header h2 {
          color: #7f8c8d;
          margin: 10px 0 0 0;
          font-size: 18px;
          font-weight: normal;
        }
        .role-section {
          margin-bottom: 40px;
          page-break-inside: avoid;
        }
        .role-title {
          background: linear-gradient(135deg, #3498db, #2980b9);
          color: white;
          padding: 15px 20px;
          margin: 0 0 20px 0;
          border-radius: 8px;
          font-size: 20px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .ranking-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        .ranking-table th {
          background: #34495e;
          color: white;
          padding: 15px 12px;
          text-align: left;
          font-weight: bold;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .ranking-table td {
          padding: 12px;
          border-bottom: 1px solid #ecf0f1;
          font-size: 13px;
        }
        .ranking-table tr:nth-child(even) {
          background-color: #f8f9fa;
        }
        .rank {
          font-weight: bold;
          color: #2c3e50;
          text-align: center;
          width: 60px;
        }
        .rank-1 { color: #f39c12; font-size: 16px; }
        .rank-2 { color: #95a5a6; font-size: 15px; }
        .rank-3 { color: #cd7f32; font-size: 15px; }
        .name {
          font-weight: 600;
          color: #2c3e50;
        }
        .division {
          color: #7f8c8d;
          font-size: 12px;
        }
        .score {
          font-weight: bold;
          text-align: right;
        }
        .score-excellent { color: #27ae60; }
        .score-good { color: #f39c12; }
        .score-average { color: #e67e22; }
        .score-poor { color: #e74c3c; }
        .no-data {
          text-align: center;
          color: #7f8c8d;
          font-style: italic;
          padding: 40px;
          background: #f8f9fa;
          border-radius: 8px;
        }
        .footer {
          margin-top: 40px;
          text-align: center;
          color: #7f8c8d;
          font-size: 12px;
          border-top: 1px solid #ecf0f1;
          padding-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${escapeHtml(args.departmentName)}</h1>
        <h2>Performance Report - ${escapeHtml(monthYearFromLabel(args.periodLabel))}</h2>
      </div>
      ${roleSections}
      <div class="footer">
        <p>Generated on ${new Date().toLocaleDateString()} | Department Performance Report</p>
      </div>
    </body>
  </html>
  `;
}

async function generatePdfBufferFallback(args: {
  departmentName: string;
  periodLabel: string;
  roleRows: Map<string, RankingRow[]>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(`${args.departmentName} - Performance Report`);
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('gray').text(`Period: ${monthYearFromLabel(args.periodLabel)}`);
    doc.moveDown(1).fillColor('black');
    for (const [role, rows] of args.roleRows.entries()) {
      doc.fontSize(13).font('Helvetica-Bold').text(`Role: ${role.toUpperCase()}`);
      doc.moveDown(0.2).font('Helvetica').fontSize(10);
      rows.forEach((r, idx) => {
        doc.text(
          `${idx + 1}. ${r.employeeName || r.employeeId} | Division / Block: ${r.divisionOrBlock || 'N/A'} | ${formatScore(
            Number(r.obtainedMarks || 0),
            Number(r.totalMarks || 0)
          )}`
        );
      });
      doc.moveDown(0.8);
    }
    doc.end();
  });
}

async function generatePdfBuffer(args: {
  departmentName: string;
  periodLabel: string;
  roleRows: Map<string, RankingRow[]>;
}): Promise<Buffer> {
  const html = generatePDFHTML(args);
  try {
    const puppeteer = await import('puppeteer');
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const browser = await puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : { channel: 'chrome' as const }),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  } catch (err) {
    logger.warn(
      'Puppeteer PDF rendering unavailable; falling back to basic PDF renderer.',
      err as any
    );
    return generatePdfBufferFallback(args);
  }
}

export class ReportZipService {
  static async cleanupExpiredArtifacts(now: Date = new Date()) {
    const expired = await ReportZipArtifactModel.find({
      expiresAt: { $lte: now },
    } as any).lean();

    for (const row of expired as any[]) {
      const p = String(row.filePath || '');
      if (p) {
        try {
          await fs.unlink(p);
        } catch {
          // Ignore missing files; DB cleanup still continues.
        }
      }
    }
    if (expired.length) {
      await ReportZipArtifactModel.deleteMany({
        _id: { $in: (expired as any[]).map((e) => e._id) },
      } as any);
    }
    return { deletedArtifacts: expired.length };
  }

  private static async requireReportRun(organizationId: string, periodId: string) {
    const run = await ReportRunModel.findOne({ organizationId, periodId } as any).lean();
    if (!run) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'REPORT_NOT_READY',
        MESSAGE:
          'Report snapshot has not been generated for this period yet. Lock/generate reports first.',
      });
    }
    return run;
  }

  private static async collectDepartmentRoleRows(organizationId: string, periodId: string) {
    const rows = await ReportRankingModel.find({
      organizationId,
      periodId,
      scope: 'department',
    } as any).lean();
    if (!rows.length) {
      throw new APIError({
        STATUS: 400,
        TITLE: 'NO_REPORT_RANKING_DATA',
        MESSAGE: 'No department ranking rows were found for this report period.',
      });
    }

    const deptIds = [...new Set(rows.map((r: any) => String(r.departmentId)).filter(Boolean))];
    const departments = await DepartmentModel.find({ _id: { $in: deptIds } } as any)
      .select('name')
      .lean();
    const deptNameById = new Map<string, string>();
    departments.forEach((d: any) => deptNameById.set(String(d._id), String(d.name || 'Department')));

    const grouped = new Map<string, Map<string, RankingRow[]>>();
    for (const row of rows as any[]) {
      const did = String(row.departmentId || '');
      if (!did) continue;
      const role = String(row.role || 'UNASSIGNED').trim() || 'UNASSIGNED';
      const roleMap = grouped.get(did) || new Map<string, RankingRow[]>();
      const arr = roleMap.get(role) || [];
      arr.push({
        employeeId: String(row.employeeId),
        employeeName: row.employeeName ? String(row.employeeName) : undefined,
        role,
        divisionOrBlock: row.divisionOrBlock
          ? String(row.divisionOrBlock)
          : undefined,
        obtainedMarks: Number(row.obtainedMarks || 0),
        totalMarks: Number(row.totalMarks || 0),
      });
      roleMap.set(role, arr);
      grouped.set(did, roleMap);
    }

    for (const roleMap of grouped.values()) {
      for (const [role, arr] of roleMap.entries()) {
        arr.sort((a, b) =>
          b.obtainedMarks !== a.obtainedMarks
            ? b.obtainedMarks - a.obtainedMarks
            : b.totalMarks - a.totalMarks
        );
        roleMap.set(role, arr);
      }
    }

    return { grouped, deptNameById };
  }

  private static async buildZip(args: {
    organizationId: string;
    periodId: string;
    periodLabel: string;
    grouped: Map<string, Map<string, RankingRow[]>>;
    deptNameById: Map<string, string>;
  }) {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const fileName = `department_reports_${sanitizeFileName(args.periodLabel)}_${Date.now()}.zip`;
    const outputPath = path.join(TEMP_DIR, fileName);

    const pdfEntries: Array<{
      departmentId: string;
      departmentName: string;
      name: string;
      buffer: Buffer;
    }> = [];
    for (const [departmentId, roleMap] of args.grouped.entries()) {
      const deptName = args.deptNameById.get(departmentId) || `Department_${departmentId}`;
      const pdfBuffer = await generatePdfBuffer({
        departmentName: deptName,
        periodLabel: args.periodLabel,
        roleRows: roleMap,
      });
      const pdfName = `${sanitizeFileName(deptName)}_report.pdf`;
      pdfEntries.push({
        departmentId,
        departmentName: deptName,
        name: pdfName,
        buffer: pdfBuffer,
      });
    }

    await new Promise<void>((resolve, reject) => {
      const output = fssync.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);

      for (const entry of pdfEntries) {
        archive.append(entry.buffer, { name: entry.name });
      }

      void archive.finalize();
    });

    return { fileName, filePath: outputPath, pdfEntries };
  }

  private static async notifyOwnerAdmins(args: {
    organizationId: string;
    periodId: string;
    fileName: string;
    filePath: string;
    expiresAt: Date;
  }) {
    const members = await MemberModel.find({
      organizationId: args.organizationId,
      role: { $in: ['owner', 'admin', 'admins'] },
    } as any)
      .select('userId role')
      .lean();

    const userIds = [...new Set((members as any[]).map((m) => String(m.userId)).filter(Boolean))];
    if (!userIds.length) return [] as string[];

    const users = await UserModel.find({ _id: { $in: userIds } } as any)
      .select('email name')
      .lean();
    const emails = [...new Set(users.map((u: any) => String(u.email || '')).filter(Boolean))];
    if (!emails.length) return [] as string[];

    const expiryStr = args.expiresAt.toISOString().slice(0, 10);
    await sendEmail({
      to: emails,
      subject: `Department-wise KPI report ZIP ready (period ${args.periodId})`,
      text: `Your department-wise KPI reports ZIP is generated for period ${args.periodId}. The file is attached and will be retained until ${expiryStr}.`,
      html: `<p>Department-wise KPI report ZIP has been generated for period <strong>${args.periodId}</strong>.</p>
<p>Retention: until <strong>${expiryStr}</strong>.</p>
<p>The ZIP file is attached for convenience.</p>`,
      attachments: [{ filename: args.fileName, path: args.filePath }],
    });
    return emails;
  }

  private static async notifyNodalsForAssignedDepartments(args: {
    organizationId: string;
    periodId: string;
    periodLabel: string;
    pdfEntries: Array<{
      departmentId: string;
      departmentName: string;
      name: string;
      buffer: Buffer;
    }>;
  }) {
    const departments = await DepartmentModel.find({
      organizationId: args.organizationId,
      assignedNodal: { $ne: null },
    } as any)
      .select('_id assignedNodal name')
      .lean();

    if (!departments.length) return [] as string[];

    const deptIdsWithPdf = new Set(args.pdfEntries.map((p) => p.departmentId));
    const departmentByMemberId = new Map<string, string[]>();
    for (const d of departments as any[]) {
      const did = String(d._id);
      if (!deptIdsWithPdf.has(did) || !d.assignedNodal) continue;
      const mid = String(d.assignedNodal);
      const arr = departmentByMemberId.get(mid) || [];
      arr.push(did);
      departmentByMemberId.set(mid, arr);
    }
    if (!departmentByMemberId.size) return [] as string[];

    const memberIds = [...departmentByMemberId.keys()];
    const members = await MemberModel.find({ _id: { $in: memberIds } } as any)
      .select('_id userId')
      .lean();
    const memberUserById = new Map<string, string>();
    for (const m of members as any[]) {
      if (m.userId) memberUserById.set(String(m._id), String(m.userId));
    }

    const userIds = [...new Set([...memberUserById.values()])];
    if (!userIds.length) return [] as string[];

    const users = await UserModel.find({ _id: { $in: userIds } } as any)
      .select('_id email name')
      .lean();
    const userById = new Map<string, any>();
    for (const u of users as any[]) userById.set(String(u._id), u);

    const sentEmails: string[] = [];
    for (const [memberId, deptIds] of departmentByMemberId.entries()) {
      const uid = memberUserById.get(memberId);
      if (!uid) continue;
      const user = userById.get(uid);
      const email = user?.email ? String(user.email) : '';
      if (!email) continue;

      const nodalPdfEntries = args.pdfEntries.filter((p) =>
        deptIds.includes(p.departmentId)
      );
      if (!nodalPdfEntries.length) continue;

      const attachments = nodalPdfEntries.map((p) => ({
        filename: p.name,
        content: p.buffer,
        contentType: 'application/pdf',
      }));

      await sendEmail({
        to: email,
        subject: `Your department KPI reports (${args.periodLabel})`,
        text: `Your assigned department-wise KPI report PDFs are attached for period ${args.periodLabel}.`,
        html: `<p>Your assigned department-wise KPI report PDFs are attached.</p>
<p>Period: <strong>${args.periodLabel}</strong></p>`,
        attachments,
      });
      sentEmails.push(email);
    }

    return sentEmails;
  }

  static async getOrCreateDepartmentReportZip(params: {
    organizationId: string;
    periodId: string;
    notifyOwnersAndAdmins?: boolean;
    generatedBy?: 'system' | 'manual';
    forceRegenerate?: boolean;
  }) {
    const notify = Boolean(params.notifyOwnersAndAdmins);
    const generatedBy = params.generatedBy || 'manual';
    await this.cleanupExpiredArtifacts();
    await this.requireReportRun(params.organizationId, params.periodId);

    const existing = await ReportZipArtifactModel.findOne({
      organizationId: params.organizationId,
      periodId: params.periodId,
      expiresAt: { $gt: new Date() },
    } as any).lean();

    const existingVersion = String((existing as any)?.templateVersion || '');
    const forceRegenerate = Boolean(params.forceRegenerate);
    if (
      !forceRegenerate &&
      existing &&
      existingVersion === PDF_TEMPLATE_VERSION &&
      (await fileExists(String((existing as any).filePath || '')))
    ) {
      return existing as any;
    }

    const period = await KpiPeriodModel.findOne({
      _id: params.periodId,
      organizationId: params.organizationId,
    } as any)
      .select('key startDate endDate')
      .lean();
    if (!period) {
      throw new APIError({
        STATUS: 404,
        TITLE: 'PERIOD_NOT_FOUND',
        MESSAGE: 'Period not found',
      });
    }

    const { grouped, deptNameById } = await this.collectDepartmentRoleRows(
      params.organizationId,
      params.periodId
    );
    const periodLabel = String((period as any).key || params.periodId);
    const { fileName, filePath, pdfEntries } = await this.buildZip({
      organizationId: params.organizationId,
      periodId: params.periodId,
      periodLabel,
      grouped,
      deptNameById,
    });

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const notifiedEmails: string[] = [];
    if (notify) {
      const ownerAdminEmails = await this.notifyOwnerAdmins({
        organizationId: params.organizationId,
        periodId: params.periodId,
        fileName,
        filePath,
        expiresAt,
      });
      notifiedEmails.push(...ownerAdminEmails);

      const nodalEmails = await this.notifyNodalsForAssignedDepartments({
        organizationId: params.organizationId,
        periodId: params.periodId,
        periodLabel,
        pdfEntries,
      });
      notifiedEmails.push(...nodalEmails);
    }

    if (existing && (existing as any).filePath && String((existing as any).filePath) !== filePath) {
      try {
        await fs.unlink(String((existing as any).filePath));
      } catch {
        // Ignore stale file cleanup issues.
      }
    }

    const artifact = await ReportZipArtifactModel.findOneAndUpdate(
      { organizationId: params.organizationId, periodId: params.periodId } as any,
      {
        $set: {
          fileName,
          filePath,
          generatedAt: new Date(),
          expiresAt,
          generatedBy,
          templateVersion: PDF_TEMPLATE_VERSION,
          notifiedEmails,
        },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    return artifact as any;
  }

  static async autoGenerateAndNotify(organizationId: string, periodId: string) {
    try {
      await this.getOrCreateDepartmentReportZip({
        organizationId,
        periodId,
        notifyOwnersAndAdmins: true,
        generatedBy: 'system',
      });
    } catch (err) {
      logger.error('Department ZIP auto-generation failed', err);
    }
  }
}

