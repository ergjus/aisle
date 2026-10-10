import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'

/** Talks to /api/auth on the same origin, so the session cookie is first-party. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] })

export const { useSession, signOut } = authClient

/** Step one of sign-in: email the address a 6-digit code. */
export async function requestSignInCode(email: string): Promise<string | null> {
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
  return error ? describeError(error) : null
}

/** Step two: trade the code for a session. Creates the account on first sign-in. */
export async function signInWithCode(email: string, otp: string): Promise<string | null> {
  const { error } = await authClient.signIn.emailOtp({ email, otp })
  return error ? describeError(error) : null
}

function describeError(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429) return 'Too many tries. Wait a minute, then try again.'
  if (error.code === 'INVALID_OTP') return 'That code doesn’t match. Check the latest email and try again.'
  if (error.code === 'OTP_EXPIRED') return 'That code has expired. Send a new one.'
  if (error.code === 'TOO_MANY_ATTEMPTS') return 'Too many wrong codes. Send a new one.'
  return error.message || 'Something went wrong. Try again.'
}
