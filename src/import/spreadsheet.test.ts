import { describe, expect, it } from 'vitest'
import {
  describeImport,
  guestEntriesFromRows,
  guestEntriesFromText,
  guestImportFromText,
  parseDelimited,
  readSpreadsheet,
  SpreadsheetError,
} from './spreadsheet'

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

// ---- planning-site exports -------------------------------------------------
//
// Fixtures shaped like each site's guest-list export, address/contact/gift
// columns and all. FINGERPRINTS in spreadsheet.ts notes how sure we are of
// each site's headers.

const ZOLA_CSV = [
  'Title,First Name,Last Name,Suffix,Partner Title,Partner First Name,Partner Last Name,Partner Suffix,Child 1 First Name,Child 1 Last Name,Address Line 1,Address Line 2,City,State/Province,Zip/Postal Code,Country,Email,Phone,Relationship,Wedding RSVP,Wedding Meal,Partner Wedding Meal,Rehearsal Dinner RSVP,Notes',
  'Dr.,Nora,Flynn,,Mr.,Sam,,,,,12 Elm St,Apt 4,Boston,MA,02110,United States,nora@example.com,(617) 555-0101,Bride\'s college friends,Attending,Salmon,Short rib,Not Invited,"Sam is gluten-free, bring the card"',
  'Mr.,Raj,Iyer,Jr.,,Guest,,,,,"88 Oak Ave, Unit 2",,Austin,TX,78701,United States,raj@example.com,512-555-0199,Groom\'s family,Declined,,,Declined,',
  'Mrs.,Ana,Ruiz,,Mr.,Luis,Ruiz,,Mateo,,4 Pine Rd,,Denver,CO,80202,United States,ana@example.com,,Bride\'s family,No Response,,,Attending,',
].join('\r\n')

const THE_KNOT_CSV = [
  'Party,First Name,Last Name,Side,Email,Phone,Street Address,City,State,Zip,Ceremony - RSVP,Reception - RSVP,Reception - Meal,Dietary Restrictions,Gift Received,Thank You Sent,Notes',
  'The Okafor Family,Chidi,Okafor,Groom,chidi@example.com,555-0110,1 Main St,Chicago,IL,60601,Attending,Attending,Beef,,Yes,No,',
  'The Okafor Family,Ada,Okafor,Groom,,,1 Main St,Chicago,IL,60601,Attending,Declined,,,,,Leaving after the ceremony',
  'Lena Park,Lena,Park,Bride,lena@example.com,555-0111,9 Bay Rd,Seattle,WA,98101,No Response,Awaiting,Vegetarian,Nut allergy,,,',
  'Lena Park,Guest,,Bride,,,,,,,No Response,Awaiting,,,,,',
].join('\n')

const WEDDINGWIRE_CSV = [
  'First Name,Last Name,Group,Age,Menu,Attendance,Table,Email,Phone,Address,City,State,Zip code,Notes',
  'Maya,Chen,Bride\'s family,Adult,Fish,Confirmed,Table 3,maya@example.com,555-0120,5 Lake Dr,Portland,OR,97201,',
  'Leo,Chen,Bride\'s family,Child,Kids menu,Confirmed,Table 3,,,5 Lake Dr,Portland,OR,97201,',
  'Omar,Haddad,Groom\'s friends,Adult,Vegetarian,Pending,,omar@example.com,,,,,,',
  'Iris,Novak,Groom\'s friends,Adult,,Declined,,iris@example.com,,,,,,Sends her love',
].join('\n')

describe('importing a planning site’s export', () => {
  it('reads a Zola export: one row per invitation, partner and children included', async () => {
    const sheet = await readSpreadsheet(new File([ZOLA_CSV], 'zola-guest-list.csv'))
    expect(sheet.format).toBe('zola')
    expect(sheet.entries).toEqual([
      {
        name: 'Dr. Nora Flynn',
        group: 'Bride\'s college friends',
        rsvp: 'yes',
        dietary: ['Salmon'],
        notes: 'Sam is gluten-free, bring the card',
      },
      // A partner with no surname of their own takes the row's.
      { name: 'Sam Flynn', group: 'Bride\'s college friends', rsvp: 'yes', dietary: ['Short rib'], notes: 'Same party as Dr. Nora Flynn' },
      { name: 'Raj Iyer Jr.', group: 'Groom\'s family', rsvp: 'no', dietary: undefined, notes: undefined },
      // An unnamed plus-one is named for their host, not left as "Guest".
      { name: 'Raj Iyer Jr.’s guest', group: 'Groom\'s family', rsvp: 'no', dietary: undefined, notes: 'Same party as Raj Iyer Jr.' },
      // The wedding RSVP wins over the rehearsal dinner's.
      { name: 'Ana Ruiz', group: 'Bride\'s family', rsvp: 'pending', dietary: undefined, notes: undefined },
      { name: 'Luis Ruiz', group: 'Bride\'s family', rsvp: 'pending', dietary: undefined, notes: 'Same party as Ana Ruiz' },
      { name: 'Mateo Ruiz', group: 'Bride\'s family', rsvp: 'pending', dietary: undefined, notes: 'Same party as Ana Ruiz' },
    ])
    expect(describeImport(sheet)).toBe('Looks like a Zola export: 7 guests in 3 parties')
  })

  it('reads a The Knot export: per-event RSVPs, reception first, households as parties', async () => {
    const sheet = await readSpreadsheet(new File([THE_KNOT_CSV], 'TheKnot_GuestList.csv'))
    expect(sheet.format).toBe('theknot')
    expect(sheet.entries).toEqual([
      { name: 'Chidi Okafor', group: 'The Okafor Family', rsvp: 'yes', dietary: ['Beef'], notes: undefined },
      // Attending the ceremony but not the reception: the reception decides.
      { name: 'Ada Okafor', group: 'The Okafor Family', rsvp: 'no', dietary: undefined, notes: 'Leaving after the ceremony' },
      { name: 'Lena Park', group: 'Lena Park', rsvp: 'pending', dietary: ['Vegetarian', 'Nut allergy'], notes: undefined },
      { name: 'Lena Park’s guest', group: 'Lena Park', rsvp: 'pending', dietary: undefined, notes: 'Same party as Lena Park' },
    ])
    expect(describeImport(sheet)).toBe('Looks like an export from The Knot: 4 guests in 2 parties')
  })

  it('reads a WeddingWire export: groups, menus, attendance, children noted', async () => {
    const sheet = await readSpreadsheet(new File([WEDDINGWIRE_CSV], 'guests.csv'))
    expect(sheet.format).toBe('weddingwire')
    expect(sheet.entries).toEqual([
      { name: 'Maya Chen', group: 'Bride\'s family', rsvp: 'yes', dietary: ['Fish'], notes: undefined },
      { name: 'Leo Chen', group: 'Bride\'s family', rsvp: 'yes', dietary: ['Kids menu'], notes: 'Child' },
      { name: 'Omar Haddad', group: 'Groom\'s friends', rsvp: 'pending', dietary: ['Vegetarian'], notes: undefined },
      { name: 'Iris Novak', group: 'Groom\'s friends', rsvp: 'no', dietary: undefined, notes: 'Sends her love' },
    ])
    expect(describeImport(sheet)).toBe('Looks like a WeddingWire export: 4 guests')
  })

  it('reads an export the same way when an agent pastes it into import_guests', async () => {
    const fromFile = await readSpreadsheet(new File([ZOLA_CSV], 'zola.csv'))
    const pasted = guestImportFromText(ZOLA_CSV)
    expect(pasted.entries).toEqual(fromFile.entries)
    expect(describeImport(pasted)).toBe(describeImport(fromFile))
  })

  it('never turns contact, address or gift columns into guests or notes', () => {
    const sheet = guestEntriesFromRows([
      ['Guest Email', 'Guest Name', 'Mailing Address', 'Guest Phone', 'Gift', 'Invitation Sent', 'Table'],
      ['nora@example.com', 'Nora Flynn', '12 Elm St', '555-0101', 'Toaster', 'Yes', '4'],
    ])
    expect(sheet.entries).toEqual([{ name: 'Nora Flynn', group: undefined, rsvp: undefined, dietary: undefined, notes: undefined }])
    expect(sheet.format).toBe('sheet')
  })

  it('skips a title line above the header', () => {
    const sheet = guestEntriesFromRows([['Our guest list (exported 3 May)'], [], ['Name', 'RSVP'], ['Nora Flynn', 'Attending']])
    expect(sheet.usedHeader).toBe(true)
    expect(sheet.entries).toEqual([{ name: 'Nora Flynn', group: undefined, rsvp: 'yes', dietary: undefined, notes: undefined }])
  })
})

describe('mapping hand-made sheets', () => {
  it('turns Guest 2 and plus-one columns into guests in the same party', () => {
    const sheet = guestEntriesFromRows([
      ['Guest 1', 'Guest 2', 'Plus One', 'Bride or Groom', 'Attending?'],
      ['Nora Flynn', 'Sam Lee', 'no', 'Bride', 'Yes'],
      ['Raj Iyer', '', 'Yes', 'groom', "Can't make it"],
    ])
    expect(sheet.entries).toEqual([
      { name: 'Nora Flynn', group: 'Bride’s side', rsvp: 'yes', dietary: undefined, notes: undefined },
      { name: 'Sam Lee', group: 'Bride’s side', rsvp: 'yes', dietary: undefined, notes: 'Same party as Nora Flynn' },
      { name: 'Raj Iyer', group: 'Groom’s side', rsvp: 'no', dietary: undefined, notes: undefined },
      { name: 'Raj Iyer’s guest', group: 'Groom’s side', rsvp: 'no', dietary: undefined, notes: 'Same party as Raj Iyer' },
    ])
    expect(describeImport(sheet)).toBe('Read the sheet by its header row: 4 guests in 2 parties')
  })

  it('prefers a group column over household, and household over side', () => {
    const sheet = guestEntriesFromRows([
      ['Name', 'Side', 'Household', 'Group'],
      ['Ana', 'Bride', 'Ruiz household', 'Book club'],
      ['Bo', 'Bride', 'Ruiz household', ''],
      ['Cy', 'Groom', '', ''],
    ])
    expect(sheet.entries.map((e) => e.group)).toEqual(['Book club', 'Ruiz household', 'Groom’s side'])
    expect(sheet.parties).toBe(2)
  })

  it('reads the platforms’ RSVP wording', () => {
    const words = ['Attending', 'Not Attending', 'Declined', 'Awaiting', 'No Response', 'Accepted', 'Regrets', 'Confirmed', 'Pending']
    const sheet = guestEntriesFromRows([['Name', 'RSVP Status'], ...words.map((w, i) => [`Guest ${i}`, w])])
    expect(sheet.entries.map((e) => e.rsvp)).toEqual(['yes', 'no', 'no', 'pending', 'pending', 'yes', 'no', 'yes', 'pending'])
  })

  it('keeps meaningful titles and suffixes but drops plain courtesy titles', () => {
    const sheet = guestEntriesFromRows([
      ['Prefix', 'First', 'Last', 'Suffix'],
      ['Rev.', 'Ada', 'Okafor', ''],
      ['Mrs.', 'Ana', 'Ruiz', ''],
      ['', 'John', 'Smith', 'III'],
    ])
    expect(sheet.entries.map((e) => e.name)).toEqual(['Rev. Ada Okafor', 'Ana Ruiz', 'John Smith III'])
  })

  it('combines a meal choice with dietary restrictions, ignoring "none"', () => {
    const sheet = guestEntriesFromRows([
      ['Full Name', 'Entrée', 'Allergies'],
      ['Nora Flynn', 'Chicken', 'None'],
      ['Raj Iyer', 'No preference', 'shellfish; dairy'],
    ])
    expect(sheet.entries.map((e) => e.dietary)).toEqual([['Chicken'], ['shellfish', 'dairy']])
  })
})

describe('pasting from Google Sheets or Excel', () => {
  it('reads tab-separated rows with no header by what each column holds', () => {
    const pasted = [
      'Nora Flynn\tCollege friends\tnora@example.com\tyes\tvegetarian',
      'Raj Iyer\tWork\traj@example.com\tno\t',
      'Ana Ruiz\tCollege friends\tana@example.com\tmaybe\tgluten-free',
    ].join('\n')
    const sheet = guestImportFromText(pasted)
    expect(sheet.format).toBe('rows')
    expect(sheet.entries).toEqual([
      { name: 'Nora Flynn', group: 'College friends', rsvp: 'yes', dietary: ['vegetarian'], notes: undefined },
      { name: 'Raj Iyer', group: 'Work', rsvp: 'no', dietary: undefined, notes: undefined },
      { name: 'Ana Ruiz', group: 'College friends', rsvp: 'pending', dietary: ['gluten-free'], notes: undefined },
    ])
    expect(describeImport(sheet)).toBe('Read rows without a header: 3 guests')
  })

  it('reads tab-separated rows with a header, including a quoted multi-line cell', () => {
    const pasted =
      'First Name\tLast Name\tSide\tRSVP\tNotes\nNora\tFlynn\tBride\tAttending\t"Arrives late\nfrom the airport"\nRaj\tIyer\tGroom\tDeclined\t'
    const sheet = guestImportFromText(pasted)
    expect(sheet.usedHeader).toBe(true)
    expect(sheet.entries).toEqual([
      { name: 'Nora Flynn', group: 'Bride’s side', rsvp: 'yes', dietary: undefined, notes: 'Arrives late\nfrom the airport' },
      { name: 'Raj Iyer', group: 'Groom’s side', rsvp: 'no', dietary: undefined, notes: undefined },
    ])
  })

  it('says when it read a pasted one-per-line list', () => {
    expect(describeImport(guestImportFromText('Nora Flynn\nRaj Iyer'))).toBe('Read a pasted list: 2 guests')
  })
})
