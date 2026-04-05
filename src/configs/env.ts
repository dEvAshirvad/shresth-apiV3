/* eslint-disable node/no-process-env */
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import path from 'path';
import { z } from 'zod';

expand(
  config({
    path: path.resolve(
      process.cwd(),
      process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
    ),
  })
);

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine(
      (val) => Number.isFinite(val) && val > 0,
      'PORT must be a positive number'
    )
    .default('3000' as unknown as number),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
  COOKIE_DOMAIN: z.string().optional(),

  // MongoDB
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid URL'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default('root'),

  /**
   * When **`true`**, heavy KPI jobs (WhatsApp batch, nodal bulk invite/sync) run **inline** in the API process
   * (slower HTTP, but no worker). When **`false`**, jobs go to **BullMQ** — you **must** run `pnpm worker:dev` / `pnpm start:worker` or nothing runs (no emails, job stays `waiting`).
   * If **unset**: **`development`** and **`test`** default to **`true`** (inline); **`production`** defaults to **`false`** (queue).
   */
  BACKGROUND_JOBS_SYNC: z
    .string()
    .optional()
    .transform((v) => {
      if (v !== undefined && String(v).trim() !== '') {
        return ['true', '1', 'yes'].includes(String(v).toLowerCase());
      }
      const nodeEnv = process.env.NODE_ENV || 'development';
      return nodeEnv === 'development' || nodeEnv === 'test';
    }),

  // Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Misc
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  /** Daily cron (node-cron syntax) for year/period automation; see `yearPeriodAutomation.schedule.ts`. */
  YEAR_PERIOD_AUTOMATION_CRON: z.string().default('0 2 * * *'),
  YEAR_PERIOD_AUTOMATION_DISABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => ['true', '1', 'yes'].includes(String(v).toLowerCase())),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('Clashers Academy'),

  /** Optional: WhatsApp provider for KPI performance notifications (see `whatsappPerformance.service.ts`). */
  WHATSAPP_API_URL: z.string().url().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_DISPLAY_NAME: z.string().optional(),
  WHATSAPP_SOURCE: z.string().optional(),
  WHATSAPP_CAMPAIGN_TOP: z.string().optional(),
  WHATSAPP_CAMPAIGN_MEDIUM: z.string().optional(),
  WHATSAPP_CAMPAIGN_BOTTOM: z.string().optional(),
  WHATSAPP_AUTO_DELAY_MS: z.coerce.number().optional(),
});

export type env = z.infer<typeof EnvSchema>;

// eslint-disable-next-line ts/no-redeclare
const { data: env, error } = EnvSchema.safeParse(process.env);

if (error) {
  console.error('❌ Invalid env:');
  console.error(JSON.stringify(error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export default env!;
