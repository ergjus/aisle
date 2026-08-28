import { describe, expect, it } from 'vitest'
import { guestEntriesFromRows, guestEntriesFromText, parseDelimited, readSpreadsheet, SpreadsheetError } from './spreadsheet'

// ---- a real .xlsx, assembled byte by byte -----------------------------------

interface ZipPart {
  name: string
  body: string
  /** Deflated when true, stored as-is otherwise — both paths the reader takes. */
  deflate?: boolean
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const deflated = source.pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(deflated).arrayBuffer())
}

/** Builds a ZIP archive; the reader never verifies CRCs, so they stay zero. */
async function buildZip(parts: ZipPart[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const part of parts) {
    const name = encoder.encode(part.name)
    const raw = encoder.encode(part.body)
    const payload = part.deflate ? await deflateRaw(raw) : raw
    const method = part.deflate ? 8 : 0

    const local = new DataView(new ArrayBuffer(30 + name.length + payload.length))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, method, true)
    local.setUint32(18, payload.length, true)
    local.setUint32(22, raw.length, true)
    local.setUint16(26, name.length, true)
    const localBytes = new Uint8Array(local.buffer)
    localBytes.set(name, 30)
    localBytes.set(payload, 30 + name.length)
    locals.push(localBytes)

    const central = new DataView(new ArrayBuffer(46 + name.length))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(10, method, true)
    central.setUint32(20, payload.length, true)
    central.setUint32(24, raw.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    const centralBytes = new Uint8Array(central.buffer)
    centralBytes.set(name, 46)
    centrals.push(centralBytes)

    offset += localBytes.length
  }

  const directorySize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, parts.length, true)
  end.setUint16(10, parts.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)

  const chunks = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out.buffer
}

const SHARED_STRINGS = [
  'Guest name', 'Party', 'RSVP', 'Dietary', 'Notes',
  'Nora Flynn', 'Childhood friends', 'yes', 'gluten-free, no nuts', 'Bringing the dog',
  'Raj Iyer', 'Work friends', 'declined',
]

/** A sheet row whose cells all point into SHARED_STRINGS by index. */
function sheetRow(rowNumber: number, indices: (number | null)[]): string {
  const cells = indices
    .map((index, column) =>
      index === null ? '' : `<c r="${String.fromCharCode(65 + column)}${rowNumber}" t="s"><v>${index}</v></c>`,
    )
    .join('')
  return `<row r="${rowNumber}">${cells}</row>`
}

async function sampleWorkbook(deflate: boolean): Promise<File> {
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData>' +
    sheetRow(1, [0, 1, 2, 3, 4]) +
    sheetRow(2, [5, 6, 7, 8, 9]) +
    sheetRow(3, [10, 11, 12, null, null]) +
    '</sheetData></worksheet>'
  const buffer = await buildZip([
    {
      name: 'xl/workbook.xml',
      body: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Guests" sheetId="1" r:id="rId7"/></sheets></workbook>',
      deflate,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body: '<?xml version="1.0"?><Relationships><Relationship Id="rId7" Target="worksheets/theOnlySheet.xml"/></Relationships>',
      deflate,
    },
    {
      name: 'xl/sharedStrings.xml',
      body: `<?xml version="1.0"?><sst>${SHARED_STRINGS.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
      deflate,
    },
    { name: 'xl/worksheets/theOnlySheet.xml', body: sheet, deflate },
  ])
  return new File([buffer], 'guests.xlsx')
}

describe('reading a workbook', () => {
  it.each([false, true])('imports guests from an .xlsx (deflated: %s)', async (deflate) => {
    const result = await readSpreadsheet(await sampleWorkbook(deflate))
    expect(result.usedHeader).toBe(true)
    expect(result.entries).toEqual([
      {
        name: 'Nora Flynn',
        group: 'Childhood friends',
        rsvp: 'yes',
        dietary: ['gluten-free', 'no nuts'],
        notes: 'Bringing the dog',
      },
      { name: 'Raj Iyer', group: 'Work friends', rsvp: 'no', dietary: undefined, notes: undefined },
    ])
  })

  it('follows the workbook rels to the real sheet part, whatever it is named', async () => {
    // The fixture's sheet is theOnlySheet.xml, so a hardcoded sheet1.xml misses it.
    const result = await readSpreadsheet(await sampleWorkbook(true))
    expect(result.entries).toHaveLength(2)
  })

  it('explains itself for files it cannot open', async () => {
    await expect(readSpreadsheet(new File(['nope'], 'guests.xls'))).rejects.toThrow(SpreadsheetError)
    await expect(readSpreadsheet(new File(['nope'], 'guests.xlsx'))).rejects.toThrow(/could not be read|ZIP/)
  })
})

describe('reading delimited text', () => {
  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseDelimited('a,"b,c","d\ne"\nf,g,h', ',')).toEqual([['a', 'b,c', 'd\ne'], ['f', 'g', 'h']])
  })

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('"say ""hi""",x', ',')).toEqual([['say "hi"', 'x']])
  })

  it('imports a semicolon-separated CSV with a header in its own column order', async () => {
    const csv = 'Notes;RSVP;Full Name;Side\nplus one;pending;Dot Reyes;Neighbors\n'
    const result = await readSpreadsheet(new File([csv], 'list.csv'))
    expect(result.usedHeader).toBe(true)
    expect(result.entries).toEqual([
      { name: 'Dot Reyes', group: 'Neighbors', rsvp: 'pending', dietary: undefined, notes: 'plus one' },
    ])
  })

  it('falls back to name-first columns when there is no header row', async () => {
    const result = await readSpreadsheet(new File(['Ana Ruiz,Work friends,no\n'], 'list.csv'))
    expect(result.usedHeader).toBe(false)
    expect(result.entries).toEqual([
      { name: 'Ana Ruiz', group: 'Work friends', rsvp: 'no', dietary: undefined, notes: undefined },
    ])
  })
})

describe('mapping rows to guests', () => {
  it('joins split first and last name columns', () => {
    const result = guestEntriesFromRows([['First Name', 'Surname'], ['Nora', 'Flynn']])
    expect(result.entries).toEqual([
      { name: 'Nora Flynn', group: undefined, rsvp: undefined, dietary: undefined, notes: undefined },
    ])
  })

  it('applies the default group only where the sheet leaves one blank', () => {
    const result = guestEntriesFromRows([['Name', 'Group'], ['Ana', ''], ['Bo', 'Cousins']], 'Guests')
    expect(result.entries.map((e) => e.group)).toEqual(['Guests', 'Cousins'])
  })

  it('skips blank rows and rows with no name', () => {
    const result = guestEntriesFromRows([['Name', 'Group'], ['', 'Cousins'], [], ['Ana', 'Cousins']])
    expect(result.entries).toHaveLength(1)
  })

  it('leaves RSVP unset for words it does not recognise, rather than guessing', () => {
    const result = guestEntriesFromRows([['Name', 'RSVP'], ['Ana', 'possibly?']])
    expect(result.entries[0].rsvp).toBeUndefined()
  })
})

describe('reading a list an agent pasted', () => {
  it('reads spreadsheet rows pasted as CSV, header and all', () => {
    const entries = guestEntriesFromText('Name,Side,RSVP\nNora Flynn,Childhood friends,yes\n')
    expect(entries).toEqual([
      { name: 'Nora Flynn', group: 'Childhood friends', rsvp: 'yes', dietary: undefined, notes: undefined },
    ])
  })

  it('reads tab-separated rows, which only ever mean columns', () => {
    const entries = guestEntriesFromText('Nora Flynn\tChildhood friends')
    expect(entries).toEqual([{ name: 'Nora Flynn', group: 'Childhood friends' }])
  })

  it('still reads the paste box’s own em-dash format', () => {
    const entries = guestEntriesFromText('Nora Flynn — Childhood friends — vegetarian')
    expect(entries[0]).toMatchObject({ name: 'Nora Flynn', group: 'Childhood friends', dietary: ['vegetarian'] })
  })

  it('treats a lone comma as part of the name, not a column break', () => {
    // "Last, First" lists are common; two comma-separated fields with no
    // header are not enough evidence to split them into name and group.
    expect(guestEntriesFromText('Flynn, Nora\nIyer, Raj')).toEqual([
      { name: 'Flynn, Nora', group: undefined },
      { name: 'Iyer, Raj', group: undefined },
    ])
  })

  it('does split comma rows once a header names the columns', () => {
    const entries = guestEntriesFromText('Guest,Party\nFlynn Nora,Cousins')
    expect(entries).toEqual([
      { name: 'Flynn Nora', group: 'Cousins', rsvp: undefined, dietary: undefined, notes: undefined },
    ])
  })

  it('still accepts a JSON array', () => {
    const entries = guestEntriesFromText('[{"name":"Ana Ruiz","group":"Work friends"}]')
    expect(entries[0]).toMatchObject({ name: 'Ana Ruiz', group: 'Work friends' })
  })

  it('applies the default group only where a row leaves one out', () => {
    const entries = guestEntriesFromText('Name,Group\nAna,\nBo,Cousins\n', 'Sailing club')
    expect(entries.map((e) => e.group)).toEqual(['Sailing club', 'Cousins'])
  })
})
