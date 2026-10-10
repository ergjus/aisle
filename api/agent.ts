import Anthropic from '@anthropic-ai/sdk'
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
 * Configuration (environment variables):
 *   ANTHROPIC_API_KEY   required; without it GET reports { enabled: false }
 *   AISLE_AGENT_MODEL   optional model override (default claude-opus-5-5)
 *   AISLE_AGENT_EFFORT  optional effort override: low | medium | high
 */

const DEFAULT_MODEL = 'claude-opus-5-5'
type Effort = 'low' | 'medium' | 'high'

function config() {
  const effort = process.env.AISLE_AGENT_EFFORT
  return {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AISLE_AGENT_MODEL || DEFAULT_MODEL,
    effort: (effort === 'low' || effort === 'high' ? effort : 'medium') as Effort,
  }
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

export async function GET(): Promise<Response> {
  const { apiKey, model } = config()
  const status: AgentStatus = apiKey ? { enabled: true, model } : { enabled: false }
  return json(status)
}

export async function POST(request: Request): Promise<Response> {
  const { apiKey, model, effort } = config()
  if (!apiKey) return json({ error: 'The hosted agent is not configured on this deployment.' }, 503)
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

  const client = new Anthropic({ apiKey })
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
