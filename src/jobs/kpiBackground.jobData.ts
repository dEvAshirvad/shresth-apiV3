/** Job names for the shared `kpi-background` BullMQ queue. */
export const KPI_BACKGROUND_JOB = {
  WHATSAPP_SEND: 'whatsapp-send',
  NODAL_SYNC_MEMBERS: 'nodal-sync-members',
  NODAL_SEND_INVITATIONS: 'nodal-send-invitations',
} as const;

export type KpiBackgroundJobName =
  (typeof KPI_BACKGROUND_JOB)[keyof typeof KPI_BACKGROUND_JOB];

export interface WhatsAppSendJobData {
  organizationId: string;
  periodId: string;
  dryRun: boolean;
  departmentId?: string;
  delayMs?: number;
  resend: boolean;
  triggeredByUserId?: string;
}

export interface NodalSyncMembersJobData {
  organizationId: string;
  triggeredByUserId?: string;
}

export interface NodalSendInvitationsJobData {
  organizationId: string;
  triggeredByUserId: string;
  origin?: string;
}
