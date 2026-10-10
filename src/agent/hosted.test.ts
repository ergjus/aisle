import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { conversationForTest, probeHostedAgent, resetConversation, runTool, sendToAgent, toolSpecs, useHostedAgent } from './hosted'
import { AGENT_LIMITS, validateStepRequest } from './protocol'

type Reply = { content: Record<string, unknown>[]; stop_reason: string }

/** Stub the step endpoint with a scripted series of assistant replies. */
function scriptAgent(replies: Reply[]) {
  const bodies: { messages: unknown[]; tools: { name: string }[] }[] = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    const message = replies.shift()
    if (!message) return new Response(JSON.stringify({ error: 'no more replies' }), { status: 500 })
    return new Response(JSON.stringify({ message }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies, fetchMock }
}

beforeEach(() => {
  useStore.getState().resetAll()
  resetConversation()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the hosted agent', () => {
  it('runs tools on the live chart and keeps the conversation append-only', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' }
    const { bodies } = scriptAgent([
      {
        content: [thinking, { type: 'text', text: 'Loading the sample.' }, { type: 'tool_use', id: 'tu_1', name: 'load_sample_wedding', input: {} }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Done — 72 guests are in.' }], stop_reason: 'end_turn' },
    ])

    await sendToAgent('Load the sample wedding')

    expect(useStore.getState().guestOrder.length).toBe(72)
    const convo = conversationForTest()
    expect(convo.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // The assistant turn goes back exactly as it came, thinking block included.
    expect(convo[1].content[0]).toEqual(thinking)
    expect(convo[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    // The second step resent the first step's prefix unchanged.
    expect(bodies[1].messages.slice(0, 1)).toEqual(bodies[0].messages)
    expect(bodies[1].messages[1]).toEqual(convo[1])
    expect(bodies[0].tools.map((t) => t.name)).toEqual(bodies[1].tools.map((t) => t.name))

    const kinds = useHostedAgent.getState().entries.map((e) => e.kind)
    expect(kinds).toEqual(['user', 'agent', 'tool', 'agent'])
    expect(useHostedAgent.getState().busy).toBe(false)
  })

  it('offers the whole toolset even when the chart gates some of it', () => {
    const names = toolSpecs().map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['seat_guest', 'export_chart', 'finalize_chart']))
    expect(new Set(names).size).toBe(names.length)
  })

  it('explains what unlocks a gated tool instead of running it', async () => {
    const result = await runTool('seat_guest', { guest: 'Ana', table: 'Table 1' })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/at least one table/)
    expect((await runTool('teleport_guest', {})).text).toMatch(/no tool called/)
  })

  it('answers every tool call even when the reply was cut off', async () => {
    scriptAgent([
      { content: [{ type: 'tool_use', id: 'tu_9', name: 'add_table', input: {} }], stop_reason: 'max_tokens' },
    ])
    await sendToAgent('Add a table')
    const convo = conversationForTest()
    expect(convo.at(-1)?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_9', is_error: true })
    expect(useStore.getState().tableOrder.length).toBe(0)
  })

  it('drops a refused turn and tells the person', async () => {
    scriptAgent([{ content: [], stop_reason: 'refusal' }])
    await sendToAgent('Something off-topic')
    expect(conversationForTest().map((m) => m.role)).toEqual(['user'])
    expect(useHostedAgent.getState().entries.at(-1)).toMatchObject({ kind: 'notice' })
  })

  it('surfaces server errors without breaking the conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The agent is busy right now.' }), { status: 429 })))
    await sendToAgent('Seat everyone')
    expect(useHostedAgent.getState().entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'The agent is busy right now.' })
    expect(useHostedAgent.getState().busy).toBe(false)
  })

  it('only shows itself when the deployment has a key', async () => {
    await probeHostedAgent(vi.fn(async () => new Response(JSON.stringify({ enabled: true }))) as unknown as typeof fetch)
    expect(useHostedAgent.getState().status).toBe('ready')
    await probeHostedAgent(vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch)
    expect(useHostedAgent.getState().status).toBe('unavailable')
  })
})

describe('step request validation', () => {
  const tool = { name: 'list_guests', description: 'List guests', input_schema: { type: 'object', properties: {} } }

  it('accepts a well-formed step', () => {
    expect(validateStepRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [tool] })).toBeNull()
  })

  it('rejects malformed or oversized steps', () => {
    expect(validateStepRequest(null)).not.toBeNull()
    expect(validateStepRequest({ messages: [], tools: [] })).not.toBeNull()
    expect(validateStepRequest({ messages: [{ role: 'assistant', content: 'x' }], tools: [] })).not.toBeNull()
    expect(validateStepRequest({ messages: [{ role: 'system', content: 'x' }], tools: [] })).not.toBeNull()
    expect(validateStepRequest({ messages: [{ role: 'user', content: 'x' }], tools: [{ ...tool, name: 'Bad Name' }] })).not.toBeNull()
    const many = Array.from({ length: AGENT_LIMITS.maxTools + 1 }, (_, i) => ({ ...tool, name: `t_${i}` }))
    expect(validateStepRequest({ messages: [{ role: 'user', content: 'x' }], tools: many })).not.toBeNull()
  })

  it('accepts the real toolset', () => {
    expect(validateStepRequest({ messages: [{ role: 'user', content: 'hi' }], tools: toolSpecs() })).toBeNull()
  })
})
