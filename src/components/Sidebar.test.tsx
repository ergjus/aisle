import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('sidebar add flows', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    resetStore()
  })

  it('keeps table and guest details hidden until their add buttons are used', async () => {
    const user = userEvent.setup()
    render(<Sidebar open onOpenChange={() => {}} />)

    expect(screen.queryByLabelText('Shape for the new table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Guest name')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Tables.*No tables yet/i }))
    await user.click(screen.getByRole('button', { name: 'Add table' }))
    expect(screen.getByLabelText('Shape for the new table')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await user.click(screen.getByRole('button', { name: /Guests.*No guests yet/i }))
    await user.click(screen.getByRole('button', { name: 'Add guest' }))
    expect(screen.getByLabelText('Guest name')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('reveals available venue items and the rule composer on demand', async () => {
    const user = userEvent.setup()
    render(<Sidebar open onOpenChange={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Bar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Venue.*items/i }))
    await user.click(screen.getByRole('button', { name: 'Add venue item' }))
    await user.click(screen.getByRole('button', { name: 'Bar' }))
    expect(screen.getByRole('button', { name: 'Hide Bar' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add venue item' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: /House rules/ }))
    expect(screen.queryByLabelText('Kind of rule')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(screen.getByLabelText('a guest…')).toHaveFocus()
    expect(screen.getByLabelText('Kind of rule')).toBeVisible()
  })

  it('shows one workspace at a time and keeps secondary controls quiet', async () => {
    const user = userEvent.setup()
    render(<Sidebar open onOpenChange={() => {}} />)

    const guests = screen.getByRole('button', { name: /Guests.*No guests yet/i })
    const venue = screen.getByRole('button', { name: /Venue.*items/i })
    expect(guests).toHaveAttribute('aria-pressed', 'true')
    expect(venue).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Width (ft)')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: /Resize/ })).not.toBeInTheDocument()

    await user.click(venue)
    expect(guests).toHaveAttribute('aria-pressed', 'false')
    expect(venue).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /Room settings/i }))
    expect(screen.getByLabelText('Width (ft)')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Activity.*No recent activity/i }))
    expect(screen.getByRole('region', { name: 'Activity workspace' })).toBeVisible()
    expect(screen.getByText('Recent activity')).toBeVisible()
  })
})
