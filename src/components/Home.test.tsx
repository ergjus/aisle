import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { loadEvent } from '../event'
import { SAMPLE } from '../sample'
import { Home } from './Home'

describe('the home screen', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    useStore.getState().resetAll()
    useStore.getState().updateEvent({ title: '', date: '', venueName: '' })
    useStore.getState().clearActivity()
  })

  afterEach(() => {
    cleanup()
  })

  it('offers three ways to begin on an empty chart, each opening the right place', async () => {
    const user = userEvent.setup()
    const onOpenChart = vi.fn()
    render(<Home onOpenChart={onOpenChart} />)

    expect(screen.getByText('Add your guest list')).toBeInTheDocument()
    expect(screen.getByText('Set up the room')).toBeInTheDocument()
    expect(screen.queryByText('Open the floor plan')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Add your guest list/ }))
    expect(onOpenChart).toHaveBeenLastCalledWith('guests')

    await user.click(screen.getByRole('button', { name: /Set up the room/ }))
    expect(onOpenChart).toHaveBeenLastCalledWith('venue')

    await user.click(screen.getByRole('button', { name: /See an example/ }))
    expect(useStore.getState().guestOrder).toHaveLength(SAMPLE.guests.length)
    expect(onOpenChart).toHaveBeenLastCalledWith()
  })

  it('shows how the seating stands once there is a chart, with a door into each section', async () => {
    const user = userEvent.setup()
    const onOpenChart = vi.fn()
    useStore.getState().loadSample(SAMPLE)
    render(<Home onOpenChart={onOpenChart} />)

    expect(screen.getByRole('progressbar', { name: 'Guests seated' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/guests still need a seat/)).toBeInTheDocument()
    expect(screen.getByText(String(SAMPLE.guests.length))).toBeInTheDocument()
    expect(screen.getByText(String(SAMPLE.tables.length))).toBeInTheDocument()
    expect(screen.getByText(String(SAMPLE.constraints.length))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Rules/ }))
    expect(onOpenChart).toHaveBeenLastCalledWith('rules')
    await user.click(screen.getByRole('button', { name: 'Open the floor plan' }))
    expect(onOpenChart).toHaveBeenLastCalledWith()
  })

  it('writes the wedding name, date and venue straight onto the page and keeps them', async () => {
    const user = userEvent.setup()
    render(<Home onOpenChart={() => {}} />)

    await user.type(screen.getByRole('textbox', { name: 'Wedding name' }), 'June & Ravi')
    await user.type(screen.getByRole('textbox', { name: 'Venue' }), 'The Orangery')

    expect(useStore.getState().event).toMatchObject({ title: 'June & Ravi', venueName: 'The Orangery' })
    expect(loadEvent()).toMatchObject({ title: 'June & Ravi', venueName: 'The Orangery' })
  })

  it('lists what changed most recently', () => {
    useStore.getState().loadSample(SAMPLE)
    useStore.getState().logActivity('seat', 'Seated 72 guests across 10 tables.', 'agent')
    render(<Home onOpenChart={() => {}} />)

    expect(screen.getByText('Seated 72 guests across 10 tables.')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
  })
})
