import axios from 'axios';
import env from '@/configs/env';
import logger from '@/configs/logger/winston';
import {
  formatPhoneNumber,
  type WhatsAppAPIPayload,
} from '@/modules/reports/whatsappPerformance.service';

export type NodalWhatsAppCredentialResult =
  | { ok: true; destination: string }
  | { ok: false; skipped?: boolean; message: string };

/**
 * Send nodal login credentials via the same WhatsApp campaign provider
 * used for KPI performance messages.
 *
 * Template params (order): name, empId, password.
 * Configure campaign name with `WHATSAPP_CAMPAIGN_NODAL_CREDENTIALS`.
 */
export async function sendNodalCredentialsWhatsApp(params: {
  name: string;
  phone: string;
  empId: string;
  password: string;
}): Promise<NodalWhatsAppCredentialResult> {
  const url = env.WHATSAPP_API_URL;
  const apiKey = env.WHATSAPP_API_KEY;
  if (!url || !apiKey) {
    return {
      ok: false,
      skipped: true,
      message: 'WhatsApp is not configured (WHATSAPP_API_URL / WHATSAPP_API_KEY)',
    };
  }

  const destination = formatPhoneNumber(params.phone);
  if (!destination) {
    return {
      ok: false,
      message: `Invalid phone number: ${params.phone}`,
    };
  }

  const campaignName =
    env.WHATSAPP_CAMPAIGN_NODAL_CREDENTIALS || 'Nodal_Credentials_API';

  const payload: WhatsAppAPIPayload = {
    apiKey,
    campaignName,
    destination,
    userName: env.WHATSAPP_DISPLAY_NAME || 'Organization',
    templateParams: [params.name, params.empId, params.password],
    source: env.WHATSAPP_SOURCE || 'kpi-nodal-credentials',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    attributes: {},
    paramsFallbackValue: { FirstName: params.name || 'user' },
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      logger.warn(
        `Nodal credentials WhatsApp failed HTTP ${res.status} for empId=${params.empId}`
      );
      return {
        ok: false,
        message: `WhatsApp API HTTP ${res.status}`,
      };
    }
    return { ok: true, destination };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Nodal credentials WhatsApp error for empId=${params.empId}`, err);
    return { ok: false, message: msg };
  }
}
