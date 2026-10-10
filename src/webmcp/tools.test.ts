/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest'
// The tool file's own text, so the guard below can read what it actually says.
import toolsSource from './tools.ts?raw'
import { useStore } from '../store'
import { SAMPLE } from '../sample'
import { currentTools } from './tools'

/** A chart with guests, tables, seating, and no violations registers every tool group. */
function everyTool() {
  const store = useStore.getState()
  store.resetAll()
  const table = useStore.getState().addTable({ name: 'Table 1', seats: 4 })
  const guest = useStore.getState().addGuest({ name: 'Ana Ruiz' })
  useStore.getState().seatGuest(guest.id, table.id)
  return currentTools()
}

describe('the tool surface', () => {
  it('registers every group once the chart has guests, tables, and clean seating', () => {
    const names = everyTool().map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    // One from each group: base, seating-only, export-only, finalize-only.
    expect(names).toEqual(expect.arrayContaining(['add_table', 'seat_guest', 'export_chart', 'finalize_chart']))
  })

  it('gives the agent every action the interface offers a person', () => {
    const names = new Set(everyTool().map((tool) => tool.name))
    for (const name of [
      'add_table', 'update_table', 'remove_table',
      'add_guest', 'update_guest', 'remove_guest', 'import_guests',
      'add_group', 'remove_group',
      'add_constraint', 'remove_constraint',
      'seat_guest', 'unseat_guest', 'swap_guests', 'clear_seating', 'auto_arrange',
      'update_venue', 'update_venue_dimensions',
      'undo', 'redo', 'reset_chart',
      'load_sample_wedding', 'export_chart',
    ]) {
      expect(names, `${name} is missing`).toContain(name)
    }
  })

  /**
   * Tool descriptions and replies point the agent at other tools by name. A
   * renamed or imagined tool sends it chasing something that is not there, so
   * every word in this file shaped like a tool call has to be one. The
   * codebase is camelCase, so anything matching this shape is a reference in
   * prose, not an identifier.
   */
  it('never tells the agent to call a tool that does not exist', () => {
    const tools = everyTool()
    const names = new Set(tools.map((tool) => tool.name))
    const verbs = [
      'add', 'update', 'remove', 'get', 'list', 'set', 'seat', 'unseat', 'swap', 'clear',
      'auto', 'propose', 'save', 'restore', 'load', 'export', 'finalize', 'import', 'share', 'wrap',
    ]
    const looksLikeACall = new RegExp(`\\b(?:${verbs.join('|')})_[a-z0-9_]+\\b`, 'g')

    const offenders = [...new Set(toolsSource.match(looksLikeACall) ?? [])].filter((token) => !names.has(token))
    expect(offenders).toEqual([])
  })
})

describe('apply_rule_preset', () => {
  // No canvas here: ask for reduced motion so the cursor choreography resolves at once.
  beforeAll(() => {
    const matchMedia = window.matchMedia
    window.matchMedia = (query: string) => ({ ...matchMedia(query), matches: query.includes('prefers-reduced-motion') })
  })

  async function call(args: Record<string, unknown>) {
    const tool = currentTools().find((t) => t.name === 'apply_rule_preset')!
    const result = (await tool.execute(args)) as { content: { text: string }[]; isError?: boolean }
    return { text: result.content[0].text, isError: result.isError === true }
  }

  function seed() {
    useStore.getState().resetAll()
    useStore.getState().loadSample(SAMPLE)
    useStore.setState({ undoStack: [], redoStack: [], agentLog: [] })
  }

  it('is always registered, even on an empty chart', () => {
    useStore.getState().resetAll()
    expect(currentTools().map((t) => t.name)).toContain('apply_rule_preset')
  })

  it('resolves guests by fuzzy name and adds the rules as one undoable step', async () => {
    seed()
    const before = useStore.getState().constraints.length
    const reply = await call({ preset: 'head_table', guests: ['Lena Kowalski', 'Dev Patel', 'Rosie'] })
    expect(reply.isError).toBe(false)
    expect(reply.text).toMatch(/Head \/ sweetheart table: added 3 rules/)
    expect(useStore.getState().constraints.length).toBe(before + 3)
    expect(useStore.getState().agentLog[0]).toMatchObject({ tool: 'apply_rule_preset', source: 'agent' })

    useStore.getState().undo()
    expect(useStore.getState().constraints.length).toBe(before)
  })

  it('says so when the rules are already in place', async () => {
    seed()
    const reply = await call({ preset: 'divorced_parents_apart', guests: ['Marta', 'Dario'] })
    expect(reply.isError).toBe(false)
    expect(reply.text).toMatch(/nothing to add/)
    expect(useStore.getState().undoStack).toHaveLength(0)
  })

  it('without guests, lists suggestions and changes nothing', async () => {
    seed()
    const before = useStore.getState().constraints
    const reply = await call({ preset: 'away_from_band' })
    expect(reply.text).toMatch(/Nothing applied yet/)
    expect(reply.text).toMatch(/Grandma Adaeze Okafor/)
    expect(useStore.getState().constraints).toBe(before)
  })

  it('reports ambiguous guests and contradictions as errors', async () => {
    seed()
    expect((await call({ preset: 'plus_ones_together', guests: ['Rossi', 'Maya'] })).text).toMatch(/matches several guests/)
    const clash = await call({ preset: 'kids_table', guests: ['Jordan', 'Sam'] })
    expect(clash.isError).toBe(true)
    expect(clash.text).toMatch(/keeps them apart/)
    expect((await call({ preset: 'seat_the_dog' })).isError).toBe(true)
  })
})
