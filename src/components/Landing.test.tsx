import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { hasEntered } from '../landing/gate'
import { SAMPLE } from '../sample'
import { Landing } from './Landing'

describe('the front door', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    useStore.getState().resetAll()
  })

  afterEach(() => cleanup())

  it('shows the seated sample floor plan and the price before any sign-up', () => {
    render(<Landing />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Seat the whole room')
    expect(screen.getByText('Free for up to 40 guests')).toBeInTheDocument()
    expect(screen.getByText('$39')).toBeInTheDocument()
    expect(document.querySelector('.landing-sheet svg')).not.toBeNull()
  })

  it('"Start" marks the visitor as entered and lands on the home screen', async () => {
    const user = userEvent.setup()
    render(<Landing />)
    expect(hasEntered()).toBe(false)
    await user.click(screen.getAllByRole('button', { name: 'Start your seating chart' })[0])
    expect(hasEntered()).toBe(true)
    expect(useStore.getState().screen).toBe('home')
    expect(useStore.getState().guestOrder).toHaveLength(0)
  })

  it('"See the sample wedding" loads the sample and opens the floor plan', async () => {
    const user = userEvent.setup()
    render(<Landing />)
    await user.click(screen.getByRole('button', { name: 'See the sample wedding' }))
    expect(useStore.getState().guestOrder).toHaveLength(SAMPLE.guests.length)
    expect(useStore.getState().screen).toBe('chart')
  })
})
