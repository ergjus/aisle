/**
 * Thin adapter over the WebMCP API surface.
 *
 * The spec has moved between preview releases, and Aisle has to work on all
 * of them at once — the judges' ChatGPT browser, Chrome behind its flag, and
 * older drafts:
 *  - Current spec: `document.modelContext.registerTool(tool, { signal })`;
 *    a tool is unregistered by aborting the AbortSignal it was registered
 *    with. `unregisterTool()` was removed from the spec in April 2026.
 *  - Chrome 146–150: `navigator.modelContext` (now a deprecated alias) with
 *    `registerTool()` / `unregisterTool()`.
 *  - Older drafts: `provideContext({ tools })`, which atomically replaces the
 *    whole toolset.
 *
 * We detect whichever surface exists, preferring `document.modelContext`,
 * and unregister through every mechanism the surface offers. `syncTools` is
 * called any time app state changes which tools should exist — that is what
 * makes the toolset itself a live signal of the chart's state.
 */

export interface WebTool {
  name: string
  /** Human-readable name, e.g. "seat guest". */
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * WebMCP annotations: `readOnlyHint` (lets agent surfaces auto-approve the
   * call) and `untrustedContentHint` (the reply echoes text people typed —
   * guest names and notes — which the agent should treat as data, not
   * instructions).
   */
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean } & Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

type Surface = {
  registerTool?: (tool: unknown, options?: { signal?: AbortSignal }) => unknown
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
    title: tool.title ?? tool.name.replace(/_/g, ' '),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    execute: tool.execute,
    // Some early builds used MCP's callback naming.
    callback: tool.execute,
  }
}

interface Registration {
  /** Aborting this is how the current spec unregisters a tool. */
  controller: AbortController
  /** Whatever registerTool returned — older builds handed back an object with unregister(). */
  handle: unknown
}

const registered = new Map<string, Registration>()
let lastNames = ''

function unregister(mc: Surface, name: string, reg: Registration): void {
  // Belt and braces: every removal path the surface might honor, in order.
  try {
    reg.controller.abort()
  } catch {
    // Not every build watches the signal.
  }
  try {
    const h = reg.handle as { unregister?: () => void } | undefined
    if (h && typeof h.unregister === 'function') h.unregister()
    else mc.unregisterTool?.(name)
  } catch {
    // Tool may already be gone; that's the state we wanted.
  }
}

/** Make the given list the complete registered toolset. Returns true if a WebMCP surface exists. */
export function syncTools(tools: WebTool[]): boolean {
  const mc = surface()
  if (!mc) return false

  const names = tools.map((t) => t.name).join(',')

  if (typeof mc.registerTool === 'function') {
    const wanted = new Set(tools.map((t) => t.name))
    for (const [name, reg] of [...registered]) {
      if (wanted.has(name)) continue
      unregister(mc, name, reg)
      registered.delete(name)
    }
    for (const t of tools) {
      if (registered.has(t.name)) continue
      const controller = new AbortController()
      try {
        const handle = mc.registerTool(toDescriptor(t), { signal: controller.signal })
        // The current spec returns a promise; a rejection means the tool did
        // not land, so forget it and try again on the next sync.
        if (handle && typeof (handle as Promise<unknown>).catch === 'function') {
          ;(handle as Promise<unknown>).catch((err: unknown) => {
            console.warn(`[aisle] tool ${t.name} was not accepted`, err)
            registered.delete(t.name)
          })
        }
        registered.set(t.name, { controller, handle })
      } catch (err) {
        console.warn(`[aisle] failed to register tool ${t.name}`, err)
      }
    }
  } else if (typeof mc.provideContext === 'function' && names !== lastNames) {
    try {
      mc.provideContext({ tools: tools.map(toDescriptor) })
      registered.clear()
      for (const t of tools) registered.set(t.name, { controller: new AbortController(), handle: undefined })
    } catch (err) {
      console.warn('[aisle] provideContext failed', err)
    }
  }

  lastNames = names
  return true
}
