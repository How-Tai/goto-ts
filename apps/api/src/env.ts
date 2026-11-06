import { z } from 'zod'
import { strongSecret } from './utils/secret-policy'

const booleanEnvironment = z.preprocess(value => typeof value === 'string' ? value.trim() : value, z.stringbool())

export const environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  JWT_SECRET: z.string().min(1),
  OTOG_AUTH_PROXY_SECRET: z.string().optional(),

  COOKIE_DOMAIN: z.string(),
  OFFLINE_MODE: booleanEnvironment,

  USE_S3: booleanEnvironment.default(false),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_BUCKET: z.string().default(''),

  DATABASE_URL: z.string(),
  NODE_ENV: z.enum(['development', 'production']).default('production'),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return
  for (const key of ['JWT_SECRET', 'OTOG_AUTH_PROXY_SECRET'] as const) {
    if (!strongSecret(value[key] || '')) context.addIssue({ code: 'custom', path: [key], message: 'Set an independently generated secret of at least 32 characters.' })
  }
}).parse(process.env)
