import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { freshVenue, freshVenueDimensions } from '../geometry'
import { useStore } from '../store'
import { Sidebar } from './Sidebar'

function resetStore() {
  useStore.setState({
    layoutVersion: 3,
    guests: {},
    guestOrder: [],
    tables: {},
    tableOrder: [],
    constraints: [],
    seating: {},
    finalized: false,
    groupOrder: [],
    venue: freshVenue(),
    venueDimensions: freshVenueDimensions(),
    demoMetadata: null,
    undoStack: [],
    redoStack: [],
    selection: null,
    draggingGuest: null,
    ruleHighlight: null,
    touched: {},
    agentLog: [],
    toast: null,
  })
}

/** Stands in for App, which owns the open/collapsed state and the grid column. */
function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return <Sidebar open={open} onOpenChange={setOpen} />
}

describe('folding the sidebar away', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    resetStore()
  })

  it('swaps the sections for a rail, and brings them back', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('button', { name: /add guest/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse the sidebar' }))
    expect(screen.queryByRole('button', { name: /add guest/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand the sidebar' }))
    expect(screen.getByRole('button', { name: /add guest/i })).toBeInTheDocument()
  })

  it('says which state it is in, for anyone not looking at it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const collapse = screen.getByRole('button', { name: 'Collapse the sidebar' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'sidebar-panel')

    await user.click(collapse)
    expect(screen.getByRole('button', { name: 'Expand the sidebar' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers every section on the rail, so none is stranded behind the fold', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Collapse the sidebar' }))
    for (const title of ['Venue', 'Tables', 'Guests', 'Activity', 'House rules']) {
      expect(screen.getByRole('button', { name: `Open ${title}` })).toBeInTheDocument()
    }
  })

  it('opens the workspace a rail icon names', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Collapse the sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Open House rules' }))

    expect(screen.getByRole('button', { name: 'Collapse the sidebar' })).toBeInTheDocument()
    expect(localStorage.getItem('aisle:sidebar:active')).toBe('rules')
    expect(screen.getByRole('region', { name: 'House rules workspace' })).toBeVisible()
  })

  it('remembers the last workspace when folded away and reopened', async () => {
    const user = userEvent.setup()
    localStorage.setItem('aisle:sidebar:active', 'tables')
    render(<Harness />)
    expect(screen.getByRole('region', { name: 'Tables workspace' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Collapse the sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Expand the sidebar' }))

    expect(screen.getByRole('region', { name: 'Tables workspace' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Guests workspace' })).not.toBeInTheDocument()
  })
})
