import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const constructed: Record<string, unknown>[] = []
const loadConfig = vi.fn(async () => null as unknown)
const oidcFederationProvider = vi.fn((config: Record<string, unknown>) => ({ kind: 'oidc', config }))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    static RateLimitError = RateLimitError
    static BadRequestError = BadRequestError
    beta = { messages: { create } }
    constructor(options: Record<string, unknown> = {}) {
      constructed.push(options)
    }
  }
  return { default: Anthropic }
})
vi.mock('@anthropic-ai/sdk/lib/credentials', () => ({ loadConfig }))
vi.mock('@anthropic-ai/sdk/lib/credentials/oidc-federation', () => ({ oidcFederationProvider }))

/** A fresh copy of the function, so its per-instance client cache starts empty. */
async function load() {
  vi.resetModules()
  return import('./agent')
}

const url = 'http://localhost/api/agent'
const step = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers })

const validBody = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Seat everyone' }] }],
  tools: [{ name: 'auto_arrange', description: 'Arrange the room', input_schema: { type: 'object', properties: {} } }],
}

const CREDENTIAL_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID', 'VERCEL_OIDC_TOKEN', 'AISLE_AGENT_MODEL', 'AISLE_AGENT_EFFORT',
]

beforeEach(() => {
  for (const key of CREDENTIAL_VARS) vi.stubEnv(key, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  create.mockReset()
  loadConfig.mockClear()
  oidcFederationProvider.mockClear()
  constructed.length = 0
})

describe('the agent step function', () => {
  it('reports itself disabled, and refuses steps, with no credential at all', async () => {
    const { GET, POST } = await load()
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: false })
    expect((await POST(step(validBody))).status).toBe(503)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects malformed steps before calling the model', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const { POST } = await load()
    expect((await POST(step({ messages: [] }))).status).toBe(400)
    expect((await POST(new Request(url, { method: 'POST', body: '{nope' }))).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes one model step with a server-owned prompt, stable caching, and refusal fallback', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const { POST } = await load()
    create.mockResolvedValue({ content: [{ type: 'text', text: 'On it.' }], stop_reason: 'end_turn' })
    const res = await POST(step(validBody, { 'x-forwarded-for': '203.0.113.7' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message.stop_reason).toBe('end_turn')
    expect(constructed[0]).toEqual({ apiKey: 'test-key' })

    const params = create.mock.calls[0][0]
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.system).toMatch(/planning agent inside Aisle/)
    expect(params.messages).toEqual(validBody.messages)
    expect(params.tools[0].name).toBe('auto_arrange')
    expect(params.cache_control).toEqual({ type: 'ephemeral' })
    expect(params.fallbacks).toBe('default')
    expect(params.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
    expect(params.betas).toEqual(expect.arrayContaining(['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01']))
  })

  it('uses workload identity federation with the Vercel OIDC token, and reuses the client', async () => {
    vi.stubEnv('ANTHROPIC_FEDERATION_RULE_ID', 'fdrl_test')
    vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', 'org_test')
    vi.stubEnv('ANTHROPIC_SERVICE_ACCOUNT_ID', 'svac_test')
    const { GET, POST } = await load()
    // No token yet: nothing to exchange, so the agent stays off.
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: false })

    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    const headers = { 'x-vercel-oidc-token': 'jwt-1', 'x-forwarded-for': '203.0.113.9' }
    expect((await POST(step(validBody, headers))).status).toBe(200)
    expect((await POST(step(validBody, { ...headers, 'x-vercel-oidc-token': 'jwt-2' }))).status).toBe(200)

    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toHaveProperty('credentials')
    const config = oidcFederationProvider.mock.calls[0][0] as Record<string, unknown> & { identityTokenProvider: () => string }
    expect(config).toMatchObject({ federationRuleId: 'fdrl_test', organizationId: 'org_test', serviceAccountId: 'svac_test' })
    // The exchange always presents the newest token Vercel handed over.
    expect(config.identityTokenProvider()).toBe('jwt-2')
  })

  it('falls back to whatever the SDK resolves, such as an ant auth login profile', async () => {
    loadConfig.mockResolvedValueOnce({ authentication: { type: 'user_oauth' } })
    const { GET } = await load()
    expect(await (await GET(new Request(url))).json()).toMatchObject({ enabled: true })
    // A bare client: the SDK runs its own credential chain.
    expect(constructed[0]).toEqual({})
  })

  it('honors the model and effort overrides', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('AISLE_AGENT_MODEL', 'claude-sonnet-5-5')
    vi.stubEnv('AISLE_AGENT_EFFORT', 'low')
    const { GET, POST } = await load()
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    await POST(step(validBody, { 'x-forwarded-for': '203.0.113.8' }))
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } })
    expect(await (await GET(new Request(url))).json()).toEqual({ enabled: true, model: 'claude-sonnet-5-5' })
  })

  it('throttles a single client that floods it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const { POST } = await load()
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    let last = 0
    for (let i = 0; i < 125; i++) last = (await POST(step(validBody, { 'x-forwarded-for': '198.51.100.1' }))).status
    expect(last).toBe(429)
  })
})
