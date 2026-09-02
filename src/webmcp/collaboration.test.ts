import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE } from '../sample'
import { useStore } from '../store'
import { currentTools } from './tools'

/**
 * Tool executions hold their reply until the cursor has acted the change out.
 * There is no canvas in a unit test, so ask for reduced motion: the
 * choreographer then resolves immediately and replies come straight back.
 */
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const tool = currentTools().find((t) => t.name === name)
  if (!tool) throw new Error(`no tool ${name}; have ${currentTools().map((t) => t.name).join(', ')}`)
  const result = (await tool.execute(args)) as { content: { text: string }[]; isError?: boolean }
  return { text: result.content[0].text, isError: result.isError === true }
}

function seedRoom() {
  useStore.getState().resetAll()
  useStore.getState().loadSample(SAMPLE)
  useStore.setState({
    undoStack: [],
    redoStack: [],
    proposal: null,
    lastProposalDecision: null,
    checkpoints: {},
    question: null,
    lastAnswer: null,
    agentLog: [],
  })
}

describe('pins — the human’s hand-placed seats are law', () => {
  beforeEach(seedRoom)

  it('pin_guest marks a seated guest and seat_guest refuses to move them', async () => {
    useStore.getState().seatGuest('g-rosa', 't3')
    const pinned = await call('pin_guest', { guest: 'Grandma Rosa' })
    expect(pinned.isError).toBe(false)
    expect(useStore.getState().pinned['g-rosa']).toBe(true)

    const moved = await call('seat_guest', { guest: 'Grandma Rosa', table: 'Table 1' })
    expect(moved.isError).toBe(true)
    expect(moved.text).toMatch(/pinned/)
    expect(useStore.getState().seating['g-rosa'].tableId).toBe('t3')

    const swapped = await call('swap_guests', { guest_a: 'Grandma Rosa', guest_b: 'Sam Whitfield' })
    expect(swapped.isError).toBe(true)

    const unseated = await call('unseat_guest', { guest: 'Grandma Rosa' })
    expect(unseated.isError).toBe(true)
  })

  it('unpin_guest lifts the pin and the guest can move again', async () => {
    useStore.getState().seatGuest('g-rosa', 't3')
    useStore.getState().pinGuest('g-rosa', true)
    const lifted = await call('unpin_guest', { guest: 'Rosa' })
    expect(lifted.isError).toBe(false)
    const moved = await call('seat_guest', { guest: 'Rosa', table: 'Table 1' })
    expect(moved.isError).toBe(false)
    expect(useStore.getState().seating['g-rosa'].tableId).toBe('t1')
  })

  it('only seated guests can be pinned, and a pin falls away with the seat', async () => {
    const early = await call('pin_guest', { guest: 'Rosa' })
    expect(early.isError).toBe(true)
    useStore.getState().seatGuest('g-rosa', 't3')
    useStore.getState().pinGuest('g-rosa', true)
    useStore.getState().unseatGuest('g-rosa')
    expect(useStore.getState().pinned['g-rosa']).toBeUndefined()
  })

  it('the room summary tells the agent who is pinned', async () => {
    useStore.getState().seatGuest('g-rosa', 't3')
    useStore.getState().pinGuest('g-rosa', true)
    const chart = await call('get_seating_chart')
    expect(chart.text).toMatch(/Pinned by hand/)
    expect(chart.text).toMatch(/Grandma Rosa Rossi at Table 3/)
  })
})

describe('ask_human — a tool call that waits for a person', () => {
  beforeEach(seedRoom)

  it('puts the question on the canvas and returns the human’s answer', async () => {
    const pending = call('ask_human', {
      question: 'Which side should the Pembertons sit on?',
      options: ["Bride's side", "Groom's side"],
    })
    // The card is up; the reply is still open.
    await new Promise((r) => setTimeout(r, 0))
    const q = useStore.getState().question
    expect(q?.text).toBe('Which side should the Pembertons sit on?')
    expect(q?.options).toEqual(["Bride's side", "Groom's side"])

    useStore.getState().answerQuestion(q!.id, "Groom's side")
    const result = await pending
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/answered: “Groom's side”/)
    expect(useStore.getState().question).toBeNull()
    // The answer is in the shared feed as the human's own action.
    expect(useStore.getState().agentLog.some((e) => e.source === 'you' && /Groom's side/.test(e.summary))).toBe(true)
  })

  it('a skipped question reports that the decision is the agent’s', async () => {
    const pending = call('ask_human', { question: 'Kids at their own table?', options: ['Yes', 'No'] })
    await new Promise((r) => setTimeout(r, 0))
    useStore.getState().answerQuestion(useStore.getState().question!.id, '')
    const result = await pending
    expect(result.text).toMatch(/skipped/)
  })

  it('refuses a second question while one is still waiting', async () => {
    const first = call('ask_human', { question: 'One?', options: ['a', 'b'] })
    await new Promise((r) => setTimeout(r, 0))
    const second = await call('ask_human', { question: 'Two?', options: ['c'] })
    expect(second.isError).toBe(true)
    useStore.getState().answerQuestion(useStore.getState().question!.id, 'a')
    await first
  })
})

describe('the rest of the conversation', () => {
  beforeEach(seedRoom)

  it('get_recent_activity shows the agent what the human did, newest first', async () => {
    useStore.getState().logActivity('drag', 'Seated Sam Whitfield at Table 4.', 'you')
    useStore.getState().logActivity('seat_guest', 'Seated Ana at Table 1.', 'agent')
    const humanOnly = await call('get_recent_activity', { who: 'human' })
    expect(humanOnly.text).toMatch(/human · Seated Sam Whitfield/)
    expect(humanOnly.text).not.toMatch(/Ana/)
    const all = await call('get_recent_activity', { limit: 1 })
    expect(all.text.split('\n')).toHaveLength(1)
    expect(all.text).toMatch(/Ana/)
  })

  it('point_at resolves guests, tables, and amenities and changes nothing', async () => {
    const before = structuredClone(useStore.getState().seating)
    const ok = await call('point_at', { targets: ['Grandma Rosa', 'Table 4', 'band'], note: 'Table 4 is under the speakers.' })
    expect(ok.isError).toBe(false)
    expect(ok.text).toMatch(/Grandma Rosa Rossi, Table 4, Band & speakers/)
    expect(useStore.getState().seating).toEqual(before)
    const bad = await call('point_at', { targets: ['Nobody Here'] })
    expect(bad.isError).toBe(true)
  })
})
