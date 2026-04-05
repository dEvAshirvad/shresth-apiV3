import nodemailer, { Transporter } from 'nodemailer';
import env from '@/configs/env';
import logger from '@/configs/logger/winston';

/**
 * Create and configure nodemailer transporter
 */
const createTransporter = (): Transporter | null => {
  // If email is not configured, return null
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    logger.warn(
      'Email configuration is incomplete. Email functionality will be disabled.'
    );
    return null;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || (env.SMTP_SECURE ? 465 : 587),
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
      // Connection pool options
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Retry options
      rateDelta: 1000,
      rateLimit: 5,
    });

    // Verify connection
    transporter.verify((error: Error | null) => {
      if (error) {
        logger.error('SMTP connection verification failed:', error);
      } else {
        logger.info('SMTP connection verified successfully');
      }
    });

    return transporter;
  } catch (error) {
    logger.error('Failed to create email transporter:', error);
    return null;
  }
};

const transporter = createTransporter();

/**
 * Email service interface
 */
export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
}

/**
 * Send email using nodemailer
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  if (!transporter) {
    logger.warn('Email transporter not available. Email not sent.');
    return false;
  }

  if (!env.EMAIL_FROM) {
    logger.error('EMAIL_FROM is not configured');
    return false;
  }

  try {
    const mailOptions = {
      from: env.EMAIL_FROM_NAME
        ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`
        : env.EMAIL_FROM,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc
        ? Array.isArray(options.cc)
          ? options.cc.join(', ')
          : options.cc
        : undefined,
      bcc: options.bcc
        ? Array.isArray(options.bcc)
          ? options.bcc.join(', ')
          : options.bcc
        : undefined,
      replyTo: options.replyTo,
      attachments: options.attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    logger.info('Email sent successfully', {
      messageId: info.messageId,
      to: options.to,
      subject: options.subject,
    });

    return true;
  } catch (error) {
    logger.error('Failed to send email:', {
      error: error instanceof Error ? error.message : String(error),
      to: options.to,
      subject: options.subject,
    });
    return false;
  }
};

/**
 * Get email transporter (for advanced usage)
 */
export const getTransporter = (): Transporter | null => {
  return transporter;
};

export default {
  sendEmail,
  getTransporter,
};
