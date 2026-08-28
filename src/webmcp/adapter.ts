/**
 * Thin adapter over the WebMCP API surface.
 *
 * The spec is in early preview and has moved between releases:
 *  - Chrome 146+ ships `navigator.modelContext.registerTool()` /
 *    `unregisterTool()` (behind chrome://flags/#enable-webmcp-for-testing).
 *  - Newer Chromium guidance points at `document.modelContext`.
 *  - Older drafts exposed `provideContext({ tools })`, which atomically
 *    replaces the full toolset.
 *
 * We detect whichever surface exists and prefer incremental registration,
 * falling back to full-set replacement. `syncTools` may be called any time
 * app state changes which tools should exist.
 */

export interface WebTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

type Surface = {
  registerTool?: (tool: unknown) => unknown
  unregisterTool?: (name: string) => void
  provideContext?: (ctx: { tools: unknown[] }) => void
}

function surface(): Surface | null {
  const candidates = [
    (document as unknown as { modelContext?: Surface }).modelContext,
    (navigator as unknown as { modelContext?: Surface }).modelContext,
    (window as unknown as { modelContext?: Surface }).modelContext,
  ]
  for (const c of candidates) {
    if (c && (typeof c.registerTool === 'function' || typeof c.provideContext === 'function')) {
      return c
    }
  }
  return null
}

export function webmcpAvailable(): boolean {
  return surface() !== null
}

function toDescriptor(tool: WebTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    execute: tool.execute,
    // Some early builds used MCP's callback naming.
    callback: tool.execute,
  }
}

const registered = new Map<string, unknown>()
let lastNames = ''

/** Make the given list the complete registered toolset. Returns true if a WebMCP surface exists. */
export function syncTools(tools: WebTool[]): boolean {
  const mc = surface()
  if (!mc) return false

  const names = tools.map((t) => t.name).join(',')

  if (typeof mc.registerTool === 'function') {
    const wanted = new Set(tools.map((t) => t.name))
    for (const [name, handle] of [...registered]) {
      if (wanted.has(name)) continue
      try {
        const h = handle as { unregister?: () => void } | undefined
        if (h && typeof h.unregister === 'function') h.unregister()
        else mc.unregisterTool?.(name)
      } catch {
        // Tool may already be gone; that's the state we wanted.
      }
      registered.delete(name)
    }
    for (const t of tools) {
      if (registered.has(t.name)) continue
      try {
        const handle = mc.registerTool(toDescriptor(t))
        registered.set(t.name, handle)
      } catch (err) {
        console.warn(`[aisle] failed to register tool ${t.name}`, err)
      }
    }
  } else if (typeof mc.provideContext === 'function' && names !== lastNames) {
    try {
      mc.provideContext({ tools: tools.map(toDescriptor) })
      registered.clear()
      for (const t of tools) registered.set(t.name, undefined)
    } catch (err) {
      console.warn('[aisle] provideContext failed', err)
    }
  }

  lastNames = names
  return true
}
