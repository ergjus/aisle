import { create } from 'zustand'
import { allToolDefinitions, currentTools } from '../webmcp/tools'
import { AGENT_ENDPOINT, type AgentStatus, type AgentToolSpec } from './protocol'

/**
 * The hosted agent: a planning agent for browsers without WebMCP.
 *
 * WebMCP only reaches people in an agent-enabled browser, so the page also
 * carries its own agent. The loop runs here and calls the very same tool
 * objects a WebMCP agent would — cursor choreography, activity feed, undo,
 * pins and all — while api/agent.ts takes one model step per request.
 *
 * The conversation is append-only: assistant turns are stored exactly as the
 * API returned them (thinking blocks included) and never rewritten, which is
 * what lets the API verify replayed thinking and serve the prefix from cache.
 */

interface Block {
  type: string
  [key: string]: unknown
}

interface ToolUseBlock extends Block {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

interface ApiMessage {
  role: 'user' | 'assistant'
  content: Block[]
}

interface StepReply {
  content: Block[]
  stop_reason: string | null
}

export type ChatEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'agent'; text: string }
  | { id: number; kind: 'tool'; name: string; ok: boolean }
  | { id: number; kind: 'notice'; text: string; tone: 'info' | 'error' }

type NewEntry = ChatEntry extends infer E ? (E extends ChatEntry ? Omit<E, 'id'> : never) : never

interface HostedAgentState {
  status: 'unknown' | 'unavailable' | 'ready'
  open: boolean
  busy: boolean
  entries: ChatEntry[]
  setOpen: (open: boolean) => void
}

export const useHostedAgent = create<HostedAgentState>((set) => ({
  status: 'unknown',
  open: false,
  busy: false,
  entries: [],
  setOpen: (open) => set({ open }),
}))

/** Model steps allowed for one message from the person. */
const MAX_STEPS = 40

let conversation: ApiMessage[] = []
let controller: AbortController | null = null
/** Bumped by resetConversation, so a run still in flight can't write into the new conversation. */
let generation = 0
let nextId = 1

function addEntry(entry: NewEntry): void {
  useHostedAgent.setState((s) => ({ entries: [...s.entries, { ...entry, id: nextId++ } as ChatEntry] }))
}

/** Ask the deployment whether it has an agent configured. */
export async function probeHostedAgent(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(AGENT_ENDPOINT, { headers: { accept: 'application/json' } })
    const body = res.ok ? ((await res.json()) as AgentStatus) : null
    useHostedAgent.setState({ status: body?.enabled ? 'ready' : 'unavailable' })
  } catch {
    useHostedAgent.setState({ status: 'unavailable' })
  }
}

const UNLOCKS: Record<'tables' | 'content' | 'perfect', string> = {
  tables: 'It unlocks once the room has at least one table (add_table).',
  content: 'It unlocks once the chart has guests or tables.',
  perfect: 'It unlocks only when every attending guest is seated and no rules are broken (see list_violations).',
}

/** The full toolset, in a fixed order, so the request prefix never changes mid-conversation. */
export function toolSpecs(): AgentToolSpec[] {
  return allToolDefinitions().map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

/** Run one tool call against the live chart, exactly as a WebMCP agent would. */
export async function runTool(name: string, input: unknown): Promise<{ text: string; isError: boolean }> {
  const live = currentTools().find((t) => t.name === name)
  if (!live) {
    const known = allToolDefinitions().find((d) => d.tool.name === name)
    if (!known || known.requires === 'always') return { text: `There is no tool called ${name}.`, isError: true }
    return { text: `${name} isn't available right now. ${UNLOCKS[known.requires]}`, isError: true }
  }
  try {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const result = (await live.execute(args)) as { content?: { text?: string }[]; isError?: boolean }
    const text = result.content?.map((c) => c.text ?? '').join('\n').trim() || '(no reply)'
    return { text, isError: result.isError === true }
  } catch (err) {
    return { text: `${name} failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

async function postStep(signal: AbortSignal): Promise<StepReply> {
  const res = await fetch(AGENT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: conversation, tools: toolSpecs() }),
    signal,
  })
  const body = (await res.json().catch(() => ({}))) as { message?: StepReply; error?: string }
  if (!res.ok || !body.message) throw new Error(body.error ?? `The agent is unavailable right now (${res.status}).`)
  return body.message
}

function textOf(content: Block[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Send the person's message and run the agent until it ends its turn. */
export async function sendToAgent(text: string): Promise<void> {
  const message = text.trim()
  if (!message || useHostedAgent.getState().busy) return
  addEntry({ kind: 'user', text: message })
  conversation.push({ role: 'user', content: [{ type: 'text', text: message }] })
  useHostedAgent.setState({ busy: true })
  const ctl = new AbortController()
  controller = ctl
  const gen = generation

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await postStep(ctl.signal)
      if (gen !== generation) return

      if (reply.stop_reason === 'refusal') {
        // A declined turn is dropped rather than replayed; the conversation
        // still ends on a user turn, so the next message simply follows it.
        addEntry({ kind: 'notice', tone: 'info', text: "The agent can't help with that one. Try asking about the seating." })
        break
      }
      if (reply.content.length === 0) break
      conversation.push({ role: 'assistant', content: reply.content })
      const said = textOf(reply.content)
      if (said) addEntry({ kind: 'agent', text: said })
      if (reply.stop_reason === 'pause_turn') continue

      const uses = reply.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
      if (uses.length === 0) {
        if (reply.stop_reason === 'max_tokens') {
          addEntry({ kind: 'notice', tone: 'info', text: 'The agent ran out of room mid-reply. Ask it to continue.' })
        }
        break
      }

      // Every tool_use gets a result in one user turn — even when cut off or
      // stopped — or the next request would be rejected.
      const results: Block[] = []
      for (const use of uses) {
        let outcome: { text: string; isError: boolean }
        if (reply.stop_reason === 'max_tokens') {
          outcome = { text: 'Your reply was cut off, so this call did not run.', isError: true }
        } else if (ctl.signal.aborted) {
          outcome = { text: 'The person stopped you before this call ran.', isError: true }
        } else {
          outcome = await runTool(use.name, use.input)
          addEntry({ kind: 'tool', name: use.name, ok: !outcome.isError })
        }
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: outcome.text,
          ...(outcome.isError ? { is_error: true } : {}),
        })
      }
      if (gen !== generation) return
      conversation.push({ role: 'user', content: results })
      if (ctl.signal.aborted) break
      if (step === MAX_STEPS - 1) {
        addEntry({ kind: 'notice', tone: 'info', text: 'The agent paused after a long run of steps. Say "continue" to let it carry on.' })
      }
    }
  } catch (err) {
    if (!ctl.signal.aborted) {
      addEntry({ kind: 'notice', tone: 'error', text: err instanceof Error ? err.message : 'The agent is unavailable right now.' })
    }
  } finally {
    if (controller === ctl) controller = null
    useHostedAgent.setState({ busy: false })
  }
}

/** Stop after the current tool call; the agent hears that it was stopped. */
export function stopAgent(): void {
  if (!controller) return
  controller.abort()
  addEntry({ kind: 'notice', tone: 'info', text: 'Stopped.' })
}

/** Forget the conversation (the chart itself is untouched). */
export function resetConversation(): void {
  controller?.abort()
  generation++
  conversation = []
  useHostedAgent.setState({ entries: [] })
}

/** Test hook: the raw conversation as it would be sent. */
export function conversationForTest(): readonly ApiMessage[] {
  return conversation
}
