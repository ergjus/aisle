import { describe, expect, it } from 'vitest'
import type { AisleState, Guest, Table } from '../types'
import { freshVenue, freshVenueDimensions } from '../geometry'
import {
  DEFAULT_EXPORT_OPTIONS,
  availableSections,
  buildCatering,
  buildDirectory,
  buildDocModel,
  buildStats,
  buildTableCards,
  chartCSV,
  dietaryLegend,
  dietaryMarkers,
  exportFileName,
  paginateColumns,
} from './model'

function guest(id: string, name: string, extra: Partial<Guest> = {}): Guest {
  return { id, name, group: 'Guests', dietary: [], rsvp: 'yes', ...extra }
}

function table(id: string, name: string, seats = 8, extra: Partial<Table> = {}): Table {
  return { id, name, shape: 'round', seats, x: 300, y: 300, rotation: 0, ...extra }
}

function makeState(partial: Partial<AisleState> = {}): AisleState {
  const guests = partial.guests ?? {}
  const tables = partial.tables ?? {}
  return {
    layoutVersion: 3,
    guests,
    guestOrder: partial.guestOrder ?? Object.keys(guests),
    tables,
    tableOrder: partial.tableOrder ?? Object.keys(tables),
    constraints: [],
    seating: {},
    finalized: false,
    groupOrder: [],
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    ...partial,
    pinned: partial.pinned ?? {},
  }
}

describe('dietaryLegend', () => {
  it('dedupes case-insensitively, keeps first spelling, skips declined guests', () => {
    const s = makeState({
      guests: {
        a: guest('a', 'Ana', { dietary: ['Vegetarian', 'gluten-free'] }),
        b: guest('b', 'Ben', { dietary: ['vegetarian'] }),
        c: guest('c', 'Cara', { dietary: ['Kosher'], rsvp: 'no' }),
      },
    })
    expect(dietaryLegend(s)).toEqual([
      { key: 'vegetarian', label: 'Vegetarian' },
      { key: 'gluten-free', label: 'gluten-free' },
    ])
  })

  it('maps a guest to sorted, deduped 1-based markers', () => {
    const legend = [
      { key: 'vegetarian', label: 'Vegetarian' },
      { key: 'gluten-free', label: 'GF' },
      { key: 'vegan', label: 'Vegan' },
    ]
    expect(dietaryMarkers(legend, ['vegan', 'Vegetarian', 'VEGAN'])).toEqual([1, 3])
    expect(dietaryMarkers(legend, ['unknown thing'])).toEqual([])
  })
})

describe('buildTableCards', () => {
  it('orders rows by seat and appends a synthetic unseated card', () => {
    const s = makeState({
      guests: {
        a: guest('a', 'Ana'),
        b: guest('b', 'Ben'),
        c: guest('c', 'Cara'),
        d: guest('d', 'Dan', { rsvp: 'no' }),
      },
      tables: { t1: table('t1', 'Table 1', 4) },
      seating: { b: { tableId: 't1', seat: 2 }, a: { tableId: 't1', seat: 0 } },
    })
    const cards = buildTableCards(s, [])
    expect(cards).toHaveLength(2)
    expect(cards[0].rows.map((r) => r.name)).toEqual(['Ana', 'Ben'])
    expect(cards[0].openSeats).toBe(2)
    expect(cards[1].unseated).toBe(true)
    // Cara is unseated; declined Dan is not.
    expect(cards[1].rows.map((r) => r.name)).toEqual(['Cara'])
  })
})

describe('buildDirectory', () => {
  it('sorts A→Z with letter headings and marks unseated and pending guests', () => {
    const s = makeState({
      guests: {
        z: guest('z', 'Zoe Quinn'),
        a: guest('a', 'ana lowercase'),
        n: guest('n', '4th Wall Crew'),
        p: guest('p', 'Ana Pending', { rsvp: 'pending' }),
        x: guest('x', 'Declined', { rsvp: 'no' }),
      },
      tables: { t1: table('t1', 'Table 1') },
      seating: { z: { tableId: 't1', seat: 0 } },
    })
    const items = buildDirectory(s)
    const kinds = items.map((i) => (i.kind === 'letter' ? i.letter : i.name))
    expect(kinds).toEqual(['#', '4th Wall Crew', 'A', 'ana lowercase', 'Ana Pending', 'Z', 'Zoe Quinn'])
    const zoe = items.find((i) => i.kind === 'guest' && i.name === 'Zoe Quinn')
    const ana = items.find((i) => i.kind === 'guest' && i.name === 'ana lowercase')
    const pending = items.find((i) => i.kind === 'guest' && i.name === 'Ana Pending')
    expect(zoe && zoe.kind === 'guest' && zoe.table).toBe('Table 1')
    expect(ana && ana.kind === 'guest' && ana.table).toBeNull()
    expect(pending && pending.kind === 'guest' && pending.pending).toBe(true)
  })
})

describe('buildCatering', () => {
  it('aggregates per need and per table', () => {
    const s = makeState({
      guests: {
        a: guest('a', 'Ana', { dietary: ['Vegetarian'] }),
        b: guest('b', 'Ben', { dietary: ['vegetarian', 'Nut allergy'] }),
        c: guest('c', 'Cara'),
      },
      tables: { t1: table('t1', 'Table 1'), t2: table('t2', 'Table 2') },
      seating: { a: { tableId: 't1', seat: 0 }, b: { tableId: 't2', seat: 0 } },
    })
    const legend = dietaryLegend(s)
    const blocks = buildCatering(s, legend, buildStats(s))
    const titles = blocks.map((b) => b.title)
    expect(titles).toEqual(['At a glance', 'Vegetarian · 2', 'Nut allergy · 1', 'By table, for the kitchen'])
    const byTable = blocks[3]
    expect(byTable.lines.map((l) => l.text)).toEqual([
      'Table 1: 1× vegetarian',
      'Table 2: 1× vegetarian, 1× nut allergy',
    ])
  })

  it('notes when no dietary needs exist', () => {
    const s = makeState({ guests: { a: guest('a', 'Ana') } })
    const blocks = buildCatering(s, [], buildStats(s))
    expect(blocks[1].lines[0].text).toMatch(/No dietary needs/)
  })
})

describe('chartCSV', () => {
  it('escapes cells and uses 1-based seats; declined guests keep an empty table', () => {
    const s = makeState({
      guests: {
        a: guest('a', 'Ana "Banana", Jr.', { dietary: ['vegan', 'gluten-free'] }),
        b: guest('b', 'Ben', { rsvp: 'no' }),
      },
      tables: { t1: table('t1', 'Head Table') },
      seating: { a: { tableId: 't1', seat: 2 } },
    })
    const lines = chartCSV(s).trimEnd().split('\n')
    expect(lines[0]).toBe('Guest,Group,RSVP,Dietary,Table,Seat')
    expect(lines[1]).toBe('"Ana ""Banana"", Jr.",Guests,yes,vegan; gluten-free,Head Table,3')
    expect(lines[2]).toBe('Ben,Guests,no,,,')
  })

  it('keeps formula-like guest data inert in spreadsheet apps', () => {
    const s = makeState({
      guests: {
        a: guest('a', '=HYPERLINK("https://example.test")', {
          group: '+Guests',
          dietary: ['-cmd', '@mention'],
        }),
        b: guest('b', '@mention'),
      },
      tables: { t1: table('t1', '=Head Table') },
      seating: { a: { tableId: 't1', seat: 0 } },
    })

    expect(chartCSV(s).trimEnd().split('\n')[1]).toBe(
      '"\'=HYPERLINK(""https://example.test"")",\'+Guests,yes,\'-cmd; @mention,\'=Head Table,1',
    )
    expect(chartCSV(s).trimEnd().split('\n')[2]).toBe("'@mention,Guests,yes,,,")
  })
})

describe('paginateColumns', () => {
  const items = (hs: number[]) => hs.map((h, i) => ({ id: i, h }))

  it('flows items into columns then pages', () => {
    const pages = paginateColumns(items([40, 40, 40, 40, 40, 40]), {
      heightOf: (i) => i.h,
      columnHeight: 100,
      columns: 2,
    })
    // 2 per column, 2 columns per page → 4 on page one, 2 on page two
    // (balanced across the last page's columns).
    expect(pages).toHaveLength(2)
    expect(pages[0][0].map((i) => i.id)).toEqual([0, 1])
    expect(pages[0][1].map((i) => i.id)).toEqual([2, 3])
    expect(pages[1][0].map((i) => i.id)).toEqual([4])
    expect(pages[1][1].map((i) => i.id)).toEqual([5])
  })

  it('balances the ragged last page instead of stacking everything leftmost', () => {
    const pages = paginateColumns(items([40, 40, 40, 40]), {
      heightOf: (i) => i.h,
      columnHeight: 500,
      columns: 2,
    })
    expect(pages).toHaveLength(1)
    expect(pages[0][0].map((i) => i.id)).toEqual([0, 1])
    expect(pages[0][1].map((i) => i.id)).toEqual([2, 3])
  })

  it('respects the first-page offset', () => {
    const pages = paginateColumns(items([40, 40, 40, 40]), {
      heightOf: (i) => i.h,
      columnHeight: 100,
      columns: 1,
      firstPageOffset: 50,
    })
    // First page fits only one 40 in (100−50); later pages fit two.
    expect(pages[0][0]).toHaveLength(1)
    expect(pages[1][0]).toHaveLength(2)
    expect(pages[2][0]).toHaveLength(1)
  })

  it('never strands a keep-with-next item at the bottom of a column', () => {
    const list = [
      { id: 'a', h: 40, letter: false },
      { id: 'L', h: 40, letter: true },
      { id: 'b', h: 40, letter: false },
    ]
    const pages = paginateColumns(list, {
      heightOf: (i) => i.h,
      columnHeight: 90,
      columns: 2,
      keepWithNext: (i) => i.letter,
    })
    expect(pages[0][0].map((i) => i.id)).toEqual(['a'])
    expect(pages[0][1].map((i) => i.id)).toEqual(['L', 'b'])
  })

  it('gives an oversized item its own column instead of dropping it', () => {
    const pages = paginateColumns(items([500, 40]), {
      heightOf: (i) => i.h,
      columnHeight: 100,
      columns: 2,
    })
    expect(pages[0][0].map((i) => i.id)).toEqual([0])
    expect(pages[0][1].map((i) => i.id)).toEqual([1])
  })

  it('returns no pages for no items', () => {
    expect(paginateColumns([], { heightOf: () => 1, columnHeight: 100, columns: 2 })).toEqual([])
  })
})

describe('buildDocModel', () => {
  const populated = () =>
    makeState({
      guests: {
        a: guest('a', 'Ana', { dietary: ['vegan'] }),
        b: guest('b', 'Ben', { rsvp: 'pending' }),
      },
      tables: { t1: table('t1', 'Table 1', 4) },
      seating: { a: { tableId: 't1', seat: 0 } },
    })

  it('places the masthead exactly once, on the first page', () => {
    const model = buildDocModel(populated(), DEFAULT_EXPORT_OPTIONS)
    expect(model.pages[0]).toMatchObject({ kind: 'plan', masthead: true })
    expect(model.pages.slice(1).every((p) => !p.masthead)).toBe(true)
  })

  it('moves the masthead when the floor plan is excluded', () => {
    const model = buildDocModel(populated(), {
      ...DEFAULT_EXPORT_OPTIONS,
      sections: { ...DEFAULT_EXPORT_OPTIONS.sections, floorPlan: false },
    })
    expect(model.pages[0]).toMatchObject({ kind: 'tables', masthead: true })
  })

  it('drops sections that are unavailable, even when requested', () => {
    const empty = makeState({})
    expect(availableSections(empty)).toMatchObject({ tables: false, directory: false, catering: false })
    const model = buildDocModel(empty, DEFAULT_EXPORT_OPTIONS)
    expect(model.pages.map((p) => p.kind)).toEqual(['plan'])
  })

  it('falls back to a default title', () => {
    const model = buildDocModel(populated(), { ...DEFAULT_EXPORT_OPTIONS, eventTitle: '   ' })
    expect(model.displayTitle).toBe('Seating Chart')
  })
})

describe('exportFileName', () => {
  it('slugifies the title and falls back when nothing survives', () => {
    expect(exportFileName('June & Ravi — Wedding', 'csv')).toBe('june-ravi-wedding.csv')
    expect(exportFileName('Café Célébration', 'md')).toBe('cafe-celebration.md')
    expect(exportFileName('❦❦❦', 'csv')).toBe('seating-chart.csv')
  })
})
