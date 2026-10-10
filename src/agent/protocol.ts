/**
 * The wire contract between the in-page hosted agent (src/agent/hosted.ts)
 * and the serverless step function (api/agent.ts). Dependency-free so both
 * sides can import it.
 *
 * The page runs the agent loop and executes every tool locally — the same
 * WebMCP tool objects an agent browser would call — while the server only
 * holds the API key and the system prompt and takes one model step per
 * request. That keeps the chart (and its guest list) in the browser, and
 * lets the hosted agent drive the cursor choreography exactly like a WebMCP
 * agent does.
 */

export const AGENT_ENDPOINT = '/api/agent'

/** One tool the page offers, in the Messages API's shape. */
export interface AgentToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** POST body: the whole conversation so far (append-only) and the toolset. */
export interface AgentStepRequest {
  messages: unknown[]
  tools: AgentToolSpec[]
}

/** GET reply: whether a key is configured on this deployment. */
export interface AgentStatus {
  enabled: boolean
  model?: string
}

/**
 * Guard rails the server enforces on every step. The real budget control
 * arrives with accounts; until then these keep one request from becoming an
 * unbounded bill.
 */
export const AGENT_LIMITS = {
  maxBodyBytes: 2_000_000,
  maxMessages: 400,
  maxTools: 80,
  maxOutputTokens: 16_000,
  /** Steps per IP per window, per server instance (best effort). */
  stepsPerWindow: 120,
  windowMs: 10 * 60_000,
} as const

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/

/** Returns an error message, or null when the body is acceptable. */
export function validateStepRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Expected a JSON object.'
  const { messages, tools } = body as Partial<AgentStepRequest>
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array.'
  if (messages.length > AGENT_LIMITS.maxMessages) return 'This conversation is too long — start a new one.'
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role
    if (role !== 'user' && role !== 'assistant') return 'Each message needs a user or assistant role.'
  }
  if ((messages[0] as { role: string }).role !== 'user') return 'The first message must be from the user.'
  if (!Array.isArray(tools) || tools.length > AGENT_LIMITS.maxTools) return 'tools must be an array of at most 80 tools.'
  for (const t of tools) {
    if (!t || typeof t !== 'object') return 'Each tool must be an object.'
    if (typeof t.name !== 'string' || !TOOL_NAME.test(t.name)) return 'Tool names must be snake_case.'
    if (typeof t.description !== 'string') return `Tool ${t.name} needs a description.`
    if (!t.input_schema || typeof t.input_schema !== 'object' || t.input_schema.type !== 'object') {
      return `Tool ${t.name} needs an object input_schema.`
    }
  }
  return null
}
