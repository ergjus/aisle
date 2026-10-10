import { afterEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static RateLimitError = RateLimitError
    static BadRequestError = BadRequestError
    beta = { messages: { create } }
  }
  return { default: Anthropic }
})

const { GET, POST } = await import('./agent')

const step = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/agent', { method: 'POST', body: JSON.stringify(body), headers })

const validBody = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Seat everyone' }] }],
  tools: [{ name: 'auto_arrange', description: 'Arrange the room', input_schema: { type: 'object', properties: {} } }],
}

afterEach(() => {
  vi.unstubAllEnvs()
  create.mockReset()
})

describe('the agent step function', () => {
  it('reports itself disabled, and refuses steps, without a key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(await (await GET()).json()).toEqual({ enabled: false })
    expect((await POST(step(validBody))).status).toBe(503)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects malformed steps before calling the model', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    expect((await POST(step({ messages: [] }))).status).toBe(400)
    expect((await POST(new Request('http://localhost/api/agent', { method: 'POST', body: '{nope' }))).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes one model step with a server-owned prompt, stable caching, and refusal fallback', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    create.mockResolvedValue({ content: [{ type: 'text', text: 'On it.' }], stop_reason: 'end_turn' })
    const res = await POST(step(validBody, { 'x-forwarded-for': '203.0.113.7' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message.stop_reason).toBe('end_turn')

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

  it('honors the model and effort overrides', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('AISLE_AGENT_MODEL', 'claude-sonnet-5-5')
    vi.stubEnv('AISLE_AGENT_EFFORT', 'low')
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    await POST(step(validBody, { 'x-forwarded-for': '203.0.113.8' }))
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } })
    expect(await (await GET()).json()).toEqual({ enabled: true, model: 'claude-sonnet-5-5' })
  })

  it('throttles a single client that floods it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    let last = 0
    for (let i = 0; i < 125; i++) last = (await POST(step(validBody, { 'x-forwarded-for': '198.51.100.1' }))).status
    expect(last).toBe(429)
  })
})
