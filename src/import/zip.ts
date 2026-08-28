/**
 * Just enough ZIP to read an .xlsx: an XLSX file is a ZIP of XML parts, and
 * the browser already ships the inflate half in DecompressionStream. So rather
 * than pull in a spreadsheet library for one import button, we walk the
 * archive's central directory ourselves and inflate the two or three parts we
 * actually need.
 */

const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const SIGNATURE_CENTRAL_FILE_HEADER = 0x02014b50
const SIGNATURE_ZIP64_END_LOCATOR = 0x07064b50

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

export class ZipError extends Error {}

interface Entry {
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/** Offset of the end-of-central-directory record, searched from the tail. */
function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus an optional comment of up to 64 KiB.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let at = view.byteLength - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) === SIGNATURE_END_OF_CENTRAL_DIRECTORY) return at
  }
  throw new ZipError('Not a ZIP archive (no end-of-central-directory record).')
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('This browser cannot unzip spreadsheets. Save the sheet as CSV and import that instead.')
  }
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const inflated = source.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/**
 * Every file in the archive, keyed by its path, read lazily — the caller
 * inflates only the parts it wants.
 */
export function openZip(buffer: ArrayBuffer): Map<string, () => Promise<Uint8Array>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const end = findEndOfCentralDirectory(view)
  let entryCount = view.getUint16(end + 10, true)
  let directoryOffset = view.getUint32(end + 16, true)

  // Zip64: the 32-bit count/offset fields saturate and the real ones live in
  // a separate record that the locator just before the EOCD points at.
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    const locator = end - 20
    if (locator < 0 || view.getUint32(locator, true) !== SIGNATURE_ZIP64_END_LOCATOR) {
      throw new ZipError('Damaged ZIP archive (missing Zip64 directory).')
    }
    const record = Number(view.getBigUint64(locator + 8, true))
    entryCount = Number(view.getBigUint64(record + 32, true))
    directoryOffset = Number(view.getBigUint64(record + 48, true))
  }

  const decoder = new TextDecoder()
  const entries = new Map<string, Entry>()
  let at = directoryOffset
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(at, true) !== SIGNATURE_CENTRAL_FILE_HEADER) {
      throw new ZipError('Damaged ZIP archive (bad central directory entry).')
    }
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    })
    at += 46 + nameLength + extraLength + commentLength
  }

  const readers = new Map<string, () => Promise<Uint8Array>>()
  for (const [name, entry] of entries) {
    readers.set(name, async () => {
      // The local header repeats the name and extra fields at its own lengths,
      // so the payload's start has to be measured there, not in the directory.
      const header = entry.localHeaderOffset
      const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true)
      const payload = bytes.subarray(start, start + entry.compressedSize)
      if (entry.method === METHOD_STORED) return payload.slice()
      if (entry.method !== METHOD_DEFLATE) {
        throw new ZipError(`Unsupported compression in "${name}". Re-save the file from Excel or Numbers.`)
      }
      return inflate(payload)
    })
  }
  return readers
}
