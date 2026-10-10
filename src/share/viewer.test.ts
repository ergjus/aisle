import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCore, useStore } from '../store'
import { currentTools } from '../webmcp/tools'
import type { AisleState } from '../types'
import { decodeShareLink, encodeShareData } from './codec'
import { copySharedChartToMine, exitSharedView, initShareRouting } from './viewer'

const CHART_KEY = 'aisle:v1'
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Builds a small chart in the (editable) store and returns it, then clears the store again. */
function makeChart(guestName: string): AisleState {
  const store = useStore.getState()
  store.resetAll()
  const table = useStore.getState().addTable({ name: 'Table 1', seats: 4 })
  const guest = useStore.getState().addGuest({ name: guestName, notes: 'Private note' })
  useStore.getState().addGuest({ name: `${guestName} Plus One` })
  useStore.getState().seatGuest(guest.id, table.id)
  const chart = structuredClone(getCore())
  useStore.getState().resetAll()
  return chart
}

async function openShared(chart: AisleState, title?: string) {
  const decoded = await decodeShareLink(await encodeShareData(chart, { title }))
  useStore.getState().showSharedChart(decoded.state, { title: decoded.title, hasNotes: decoded.hasNotes })
}

const guestNames = () => {
  const s = useStore.getState()
  return s.guestOrder.map((id) => s.guests[id].name)
}

/** Saves an own chart with one guest, waiting out the persistence debounce. */
async function saveOwnChart(name = 'My Own Guest') {
  useStore.getState().resetAll()
  useStore.getState().addGuest({ name })
  await sleep(350)
  return localStorage.getItem(CHART_KEY)
}

describe('viewing a share link', () => {
  beforeEach(() => {
    if (useStore.getState().viewMode === 'shared') exitSharedView()
    localStorage.clear()
    history.replaceState(null, '', '/')
  })

  afterEach(() => {
    if (useStore.getState().viewMode === 'shared') exitSharedView()
  })

  it('shows the shared chart without reading over or writing the viewer’s own', async () => {
    const shared = makeChart('Shared Guest')
    const saved = await saveOwnChart()
    expect(saved).toContain('My Own Guest')

    const setItem = vi.spyOn(localStorage, 'setItem')
    await openShared(shared, 'June & Ravi')
    expect(useStore.getState().viewMode).toBe('shared')
    expect(useStore.getState().sharedView).toMatchObject({ status: 'ready', title: 'June & Ravi' })
    expect(guestNames()).toEqual(['Shared Guest', 'Shared Guest Plus One'])
    // Notes were stripped by default.
    expect(Object.values(useStore.getState().guests).every((g) => g.notes === undefined)).toBe(true)

    // Even a stray edit while viewing is never persisted.
    useStore.getState().addGuest({ name: 'Stray' })
    await sleep(350)
    expect(setItem.mock.calls.filter(([key]) => key === CHART_KEY)).toEqual([])
    expect(localStorage.getItem(CHART_KEY)).toBe(saved)

    exitSharedView()
    expect(useStore.getState().viewMode).toBe('edit')
    expect(guestNames()).toEqual(['My Own Guest'])
  })

  it('explains a broken link and leaves the viewer’s chart alone', async () => {
    const saved = await saveOwnChart()
    initShareRouting()
    location.hash = '#share=v1.this-is-not-a-chart'
    await vi.waitFor(() => expect(useStore.getState().sharedView?.status).toBe('error'))
    expect(useStore.getState().sharedView?.error).toMatch(/link/i)
    expect(useStore.getState().guestOrder).toEqual([])
    expect(localStorage.getItem(CHART_KEY)).toBe(saved)

    exitSharedView()
    expect(location.hash).toBe('')
    expect(guestNames()).toEqual(['My Own Guest'])
  })

  it('asks before a copy replaces a chart the viewer already has', async () => {
    const shared = makeChart('Shared Guest')
    await saveOwnChart()
    await openShared(shared)

    const decline = vi.fn(() => false)
    expect(copySharedChartToMine(decline)).toBe(false)
    expect(decline).toHaveBeenCalledOnce()
    expect(useStore.getState().viewMode).toBe('shared')
    expect(localStorage.getItem(CHART_KEY)).toContain('My Own Guest')

    expect(copySharedChartToMine(() => true)).toBe(true)
    expect(useStore.getState().viewMode).toBe('edit')
    expect(useStore.getState().undoStack).toEqual([])
    expect(localStorage.getItem(CHART_KEY)).toContain('Shared Guest')
    expect(localStorage.getItem(CHART_KEY)).not.toContain('My Own Guest')
  })

  it('copies without asking when the viewer has no chart of their own', async () => {
    const shared = makeChart('Shared Guest')
    await openShared(shared)
    const confirm = vi.fn(() => false)
    expect(copySharedChartToMine(confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CHART_KEY)!).guestOrder).toHaveLength(2)
  })

  it('registers only read-only tools while a shared chart is on screen', async () => {
    await openShared(makeChart('Shared Guest'))
    const tools = currentTools()
    const names = tools.map((t) => t.name)
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(names).toEqual(expect.arrayContaining(['get_seating_chart', 'explain_seating', 'get_share_link']))
    for (const name of ['add_guest', 'seat_guest', 'auto_arrange', 'reset_chart', 'undo', 'export_chart', 'load_sample_wedding']) {
      expect(names).not.toContain(name)
    }

    exitSharedView()
    expect(currentTools().map((t) => t.name)).toContain('add_guest')
  })
})

describe('the get_share_link tool', () => {
  it('hands back a link that opens to the same chart, notes left out', async () => {
    const chart = makeChart('Ana Ruiz')
    useStore.setState({ ...structuredClone(chart) })
    const tool = currentTools().find((t) => t.name === 'get_share_link')
    expect(tool).toBeDefined()
    const result = (await tool!.execute({ title: 'June & Ravi' })) as { content: { text: string }[]; isError?: boolean }
    expect(result.isError).toBeUndefined()
    const text = result.content[0].text
    const url = /\S*#share=v1\.[A-Za-z0-9_-]+/.exec(text)?.[0]
    expect(url).toBeDefined()

    const decoded = await decodeShareLink(url!)
    expect(decoded.title).toBe('June & Ravi')
    expect(decoded.hasNotes).toBe(false)
    expect(decoded.state.guestOrder.map((id) => decoded.state.guests[id].name)).toEqual(['Ana Ruiz', 'Ana Ruiz Plus One'])
    useStore.getState().resetAll()
  })

  it('is only registered once the chart has something in it', () => {
    useStore.getState().resetAll()
    expect(currentTools().map((t) => t.name)).not.toContain('get_share_link')
  })
})
