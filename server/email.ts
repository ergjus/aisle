import { createHash } from 'node:crypto'

const REQUEST_TIMEOUT_MS = 10_000

type SendEmail = {
  to: string
  subject: string
  html: string
  text: string
  /** Stable key so a retried request can't send the same email twice. */
  idempotencyKey?: string
}

/** Sends through Resend's REST API. No SDK: one fetch is all it takes. */
export async function sendEmail({ to, subject, html, text, idempotencyKey }: SendEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Local development without a key: print instead of sending.
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[email] to ${to}: ${subject}\n${text}`)
      return
    }
    throw new Error('RESEND_API_KEY is not set')
  }
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) throw new Error('RESEND_FROM_EMAIL is not set')

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({ from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[email] Resend refused the message (${res.status}): ${detail}`)
  }
}

export function idempotencyKey(scope: string, value: string): string {
  return `${scope}/${createHash('sha256').update(value).digest('base64url')}`
}

/** The sign-in code email. Plain and short so it reads well on a phone lock screen. */
export function signInCodeEmail(code: string) {
  const subject = `${code} is your Aisle sign-in code`
  const text = `Your Aisle sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1e7;font-family:Georgia,'Times New Roman',serif;color:#29241d">
  <div style="max-width:440px;margin:0 auto;padding:40px 24px">
    <p style="font-size:20px;margin:0 0 24px">❦ Aisle</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">Here is your sign-in code:</p>
    <p style="font-size:32px;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace;margin:0 0 16px">${code}</p>
    <p style="font-size:13px;line-height:1.5;color:#6b6152;margin:0">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
  </div></body></html>`
  return { subject, text, html }
}
