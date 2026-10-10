import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resetConversation, sendToAgent, stopAgent, useHostedAgent, type ChatEntry } from '../agent/hosted'

const STARTERS = [
  'Seat everyone and keep the feuds apart.',
  'Fix whatever I just broke, moving as few people as possible.',
  'Why is Grandma at her table?',
]

/**
 * The hosted agent's chat — for everyone whose browser has no WebMCP agent.
 * It is the same agent experience: the person types here, and the cursor
 * works the real chart with the same tools. Only rendered when this
 * deployment has an agent configured.
 */
export function AgentChat() {
  const { status, open, busy, entries, setOpen } = useHostedAgent(useShallow((s) => ({
    status: s.status,
    open: s.open,
    busy: s.busy,
    entries: s.entries,
    setOpen: s.setOpen,
  })))
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries, busy])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (status !== 'ready') return null

  if (!open) {
    return (
      <button type="button" className="agent-chat-launcher" onClick={() => setOpen(true)}>
        <span className="agent-chat-dot" aria-hidden="true" />
        Plan with the agent
      </button>
    )
  }

  const send = (text: string) => {
    if (!text.trim() || busy) return
    setDraft('')
    void sendToAgent(text)
  }

  return (
    <section className="agent-chat" aria-label="Chat with the planning agent">
      <header className="agent-chat-head">
        <span className="agent-chat-dot" aria-hidden="true" />
        <span className="agent-chat-title">The agent</span>
        {entries.length > 0 && (
          <button type="button" className="agent-chat-link" onClick={resetConversation}>
            New chat
          </button>
        )}
        <button type="button" className="agent-chat-close" onClick={() => setOpen(false)} aria-label="Close the agent chat">
          ×
        </button>
      </header>

      <div className="agent-chat-log" ref={logRef} aria-live="polite">
        {entries.length === 0 ? (
          <div className="agent-chat-empty">
            <p>Tell the agent what you want and watch it work the chart. Everything it does lands in your undo history.</p>
            <div className="agent-chat-starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry) => <Entry key={entry.id} entry={entry} />)
        )}
        {busy && <p className="agent-chat-working">Working…</p>}
      </div>

      <form
        className="agent-chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={2}
          placeholder="Ask the agent…"
          aria-label="Message the agent"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(draft)
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={stopAgent}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  )
}

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case 'user':
      return <p className="agent-chat-msg agent-chat-user">{entry.text}</p>
    case 'agent':
      return <p className="agent-chat-msg agent-chat-agent">{entry.text}</p>
    case 'tool':
      return (
        <p className={`agent-chat-tool${entry.ok ? '' : ' failed'}`}>
          <span aria-hidden="true">{entry.ok ? '✓' : '×'}</span> {entry.name.replace(/_/g, ' ')}
        </p>
      )
    case 'notice':
      return <p className={`agent-chat-notice ${entry.tone}`}>{entry.text}</p>
  }
}
