import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { db } from './db'
import { idempotencyKey, sendEmail, signInCodeEmail } from './email'
import { requireEnv } from './env'

const OTP_TTL_SECONDS = 10 * 60

/** Extra origins allowed to call the auth API, e.g. Vercel preview URLs. Comma-separated. */
const extraOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/**
 * Accounts. Email-only, passwordless: the user types an email, gets a 6-digit
 * code, and the first successful code creates the account.
 *
 * Everything that has to be shared across serverless instances — sessions,
 * codes, rate-limit counters — lives in Postgres, so any instance can answer
 * any request. Sessions are also cached in a signed cookie for five minutes,
 * which keeps most requests from touching the database at all.
 */
export const auth = betterAuth({
  appName: 'Aisle',
  baseURL: requireEnv('BETTER_AUTH_URL'),
  secret: requireEnv('BETTER_AUTH_SECRET'),
  trustedOrigins: [requireEnv('BETTER_AUTH_URL'), ...extraOrigins],

  database: drizzleAdapter(db, { provider: 'pg' }),

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  rateLimit: {
    // Memory counters would reset per instance; the database is shared.
    storage: 'database',
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_TTL_SECONDS,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      // Three code requests per address per minute.
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') return
        const message = signInCodeEmail(otp)
        await sendEmail({ to: email, ...message, idempotencyKey: idempotencyKey('sign-in-code', `${email}:${otp}`) })
      },
    }),
  ],
})

export type Session = typeof auth.$Infer.Session
