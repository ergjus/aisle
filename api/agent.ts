import Anthropic from '@anthropic-ai/sdk'
import { loadConfig } from '@anthropic-ai/sdk/lib/credentials'
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation'
import { AGENT_LIMITS, validateStepRequest, type AgentStatus, type AgentStepRequest } from '../src/agent/protocol'
import { AGENT_SYSTEM_PROMPT } from '../src/agent/systemPrompt'

/**
 * Hosted agent step — a Vercel function (also served by the Vite dev server,
 * see vite.config.ts).
 *
 * The page runs the agent loop and executes the tools itself; this function
 * takes one model step: conversation + toolset in, the assistant's next
 * message out. It owns the API key and the system prompt, so the browser
 * never sees either.
 *
 * Credentials, first match wins (GET reports { enabled: false } with none):
 *   1. ANTHROPIC_API_KEY.
 *   2. Workload identity federation on Vercel: ANTHROPIC_FEDERATION_RULE_ID
 *      and ANTHROPIC_ORGANIZATION_ID (plus optional ANTHROPIC_SERVICE_ACCOUNT_ID
 *      and ANTHROPIC_WORKSPACE_ID), with Vercel's OIDC token — the
 *      x-vercel-oidc-token request header, or VERCEL_OIDC_TOKEN locally after
 *      `vercel env pull` — exchanged for a short-lived Anthropic token. No
 *      long-lived secret is stored anywhere.
 *   3. Whatever else the SDK resolves on its own: ANTHROPIC_AUTH_TOKEN,
 *      federation with ANTHROPIC_IDENTITY_TOKEN(_FILE), or an
 *      `ant auth login` profile (handy for local dev).
 *
 * Other settings:
 *   AISLE_AGENT_MODEL   optional model override (default claude-opus-5-5)
 *   AISLE_AGENT_EFFORT  optional effort override: low | medium | high
 */

const DEFAULT_MODEL = 'claude-opus-5-5'
type Effort = 'low' | 'medium' | 'high'

function config() {
  const effort = process.env.AISLE_AGENT_EFFORT
  return {
    model: process.env.AISLE_AGENT_MODEL || DEFAULT_MODEL,
    effort: (effort === 'low' || effort === 'high' ? effort : 'medium') as Effort,
  }
}

// ---- credentials ------------------------------------------------------------

/** The newest Vercel OIDC token seen; the federation provider reads it at exchange time. */
let vercelOidcToken: string | undefined

function noteVercelToken(request: Request): void {
  vercelOidcToken = request.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || vercelOidcToken
}

function vercelFederation() {
  const federationRuleId = process.env.ANTHROPIC_FEDERATION_RULE_ID
  const organizationId = process.env.ANTHROPIC_ORGANIZATION_ID
  if (!federationRuleId || !organizationId || !vercelOidcToken) return null
  return {
    federationRuleId,
    organizationId,
    serviceAccountId: process.env.ANTHROPIC_SERVICE_ACCOUNT_ID || undefined,
    workspaceId: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
  }
}

// One client per credential mode, kept for the life of a warm instance so a
// federation token is exchanged once and reused until it nears expiry (the
// SDK caches the provider's token per client).
const clients = new Map<string, Anthropic>()

/** A client for whichever credential is available, or null when there is none. */
async function getClient(): Promise<Anthropic | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    if (!clients.has('key')) clients.set('key', new Anthropic({ apiKey }))
    return clients.get('key')!
  }
  const federation = vercelFederation()
  if (federation) {
    if (!clients.has('vercel-oidc')) {
      const baseURL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
      clients.set('vercel-oidc', new Anthropic({
        credentials: oidcFederationProvider({
          ...federation,
          identityTokenProvider: () => {
            if (!vercelOidcToken) throw new Error('No Vercel OIDC token on this request.')
            return vercelOidcToken
          },
          baseURL,
          fetch: (...args) => fetch(...args),
        }),
      }))
    }
    return clients.get('vercel-oidc')!
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN || (await loadConfig().catch(() => null))) {
    if (!clients.has('sdk-default')) clients.set('sdk-default', new Anthropic())
    return clients.get('sdk-default')!
  }
  return null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// Best-effort per-IP throttle. Serverless instances don't share memory, so
// this bounds a single runaway tab rather than a determined abuser; accounts
// (ALI-99) are where real per-user budgets live.
const recent = new Map<string, number[]>()

function throttled(ip: string, now = Date.now()): boolean {
  const since = now - AGENT_LIMITS.windowMs
  const hits = (recent.get(ip) ?? []).filter((t) => t > since)
  hits.push(now)
  recent.set(ip, hits)
  if (recent.size > 5000) recent.clear()
  return hits.length > AGENT_LIMITS.stepsPerWindow
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

export async function GET(request: Request): Promise<Response> {
  noteVercelToken(request)
  const { model } = config()
  const status: AgentStatus = (await getClient()) ? { enabled: true, model } : { enabled: false }
  return json(status)
}

export async function POST(request: Request): Promise<Response> {
  noteVercelToken(request)
  const { model, effort } = config()
  const client = await getClient()
  if (!client) return json({ error: 'The hosted agent is not configured on this deployment.' }, 503)
  if (throttled(clientIp(request))) {
    return json({ error: 'Too many agent steps in a short time. Wait a few minutes and try again.' }, 429)
  }

  const raw = await request.text()
  if (raw.length > AGENT_LIMITS.maxBodyBytes) {
    return json({ error: 'This conversation is too long — start a new one.' }, 413)
  }
  let body: AgentStepRequest
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }
  const invalid = validateStepRequest(body)
  if (invalid) return json({ error: invalid }, 400)

  try {
    const message = await client.beta.messages.create({
      model,
      max_tokens: AGENT_LIMITS.maxOutputTokens,
      system: AGENT_SYSTEM_PROMPT,
      tools: body.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema })),
      messages: body.messages as Anthropic.Beta.BetaMessageParam[],
      // The tool list and system prompt are stable for a whole conversation,
      // so each step re-reads the growing prefix from cache.
      cache_control: { type: 'ephemeral' },
      // The page keeps the conversation append-only, so replayed thinking
      // always passes the API's conversation check; drop_block is the safety
      // net that turns an unexpected mismatch into a dropped block, not a 400.
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort },
      // A safety-classifier decline is retried on Anthropic's recommended
      // fallback model inside the same call.
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    })
    return json({ message })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error('[agent] credentials rejected', err.status, err.message)
      return json({ error: 'The agent is not set up correctly on this deployment.' }, 502)
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'The agent is busy right now. Try again in a moment.' }, 429)
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error('[agent] bad request', err.message)
      return json({ error: 'The agent could not read this conversation. Start a new one.' }, 400)
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[agent] api error', err.status, err.message)
      return json({ error: 'The agent is unavailable right now.' }, 502)
    }
    console.error('[agent] unexpected error', err)
    return json({ error: 'The agent is unavailable right now.' }, 502)
  }
}
