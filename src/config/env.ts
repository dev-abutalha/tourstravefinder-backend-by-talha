import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, validated runtime configuration.
 * Every value is read once at boot so a misconfigured deployment fails fast
 * instead of failing at the first request that needs the value.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:4000'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/tourstravelfinder'),

  JWT_SECRET: z.string().min(32).default('dev-only-insecure-secret-change-me-000000000'),
  JWT_REFRESH_SECRET: z.string().min(32).default('dev-only-insecure-refresh-change-me-00000'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECRET: z.string().min(16).default('dev-cookie-secret-change-me'),
  COOKIE_DOMAIN: z.string().optional(),

  MAIL_HOST: z.string().default('smtp.example.com'),
  MAIL_PORT: z.coerce.number().int().default(587),
  MAIL_SECURE: booleanish.default(false),
  MAIL_USER: z.string().default(''),
  MAIL_PASSWORD: z.string().default(''),
  MAIL_FROM_NAME: z.string().default('Tours & Travel'),
  MAIL_FROM_ADDRESS: z.string().default('noreply@example.com'),

  SITE_NAME: z.string().default('Tours & Travel'),
  SITE_URL: z.string().url().default('http://localhost:3000'),
  SUPPORT_EMAIL: z.string().email().default('support@example.com'),
  ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  PHONE_COUNTRIES: z.string().default(''),

  UPLOAD_DIR: z.string().default('./uploads'),
  SECURE_UPLOAD_DIR: z.string().default('./uploads/secure'),
  MAX_UPLOAD_MB: z.coerce.number().int().default(20),

  TURNSTILE_SECRET_KEY: z.string().default(''),
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_MODE: z.enum(['off', 'managed', 'invisible']).default('off'),

  FPJS_PUBLIC_API_KEY: z.string().default(''),
  FPJS_REGION: z.string().default('us'),

  CURRENCY: z.string().default('EUR'),
  CURRENCY_SYMBOL: z.string().default('€'),
  BOOKING_RESERVATION_MINUTES: z.coerce.number().int().default(30),
  FREE_CANCELLATION_HOURS: z.coerce.number().int().default(24),
  DEFAULT_TIMEZONE: z.string().default('Europe/Madrid'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
