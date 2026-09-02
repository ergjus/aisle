import { useState } from 'react'
import type { HumanQuestion } from '../types'

/**
 * A question from the agent, set down on the canvas like a note left on the
 * seating table. The agent's tool call is waiting on this card: pressing an
 * option (or replying in your own words) is what lets it continue.
 */
export function AgentQuestion({
  question,
  belowBanner,
  onAnswer,
}: {
  question: HumanQuestion
  /** Stack under the proposal banner when both are on screen. */
  belowBanner: boolean
  onAnswer: (answer: string) => void
}) {
  const [text, setText] = useState('')
  const reply = () => {
    if (text.trim()) onAnswer(text.trim())
  }
  return (
    <div
      className={`agent-question${belowBanner ? ' below-banner' : ''}`}
      role="dialog"
      aria-live="polite"
      aria-label="A question from the agent"
    >
      <p className="agent-question-kicker">
        <span aria-hidden="true">✳</span> The agent asks
      </p>
      <p className="agent-question-text">{question.text}</p>
      {question.options.length > 0 && (
        <div className="agent-question-options">
          {question.options.map((option) => (
            <button key={option} type="button" onClick={() => onAnswer(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      {question.allowFreeText && (
        <form
          className="agent-question-free"
          onSubmit={(e) => {
            e.preventDefault()
            reply()
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={question.options.length ? 'Or answer in your own words…' : 'Your answer…'}
            aria-label="Your answer"
            autoFocus={question.options.length === 0}
          />
          <button type="submit" disabled={!text.trim()}>
            Reply
          </button>
        </form>
      )}
      <button type="button" className="agent-question-skip" onClick={() => onAnswer('')}>
        Skip — let the agent decide
      </button>
    </div>
  )
}
