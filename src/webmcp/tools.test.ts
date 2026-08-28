/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
// The tool file's own text, so the guard below can read what it actually says.
import toolsSource from './tools.ts?raw'
import { useStore } from '../store'
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
