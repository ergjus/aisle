import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { freshVenue, freshVenueDimensions } from '../geometry'
import { getCore, useStore } from '../store'
import type { PersonalizedDemoConfig } from '../types'
import OnboardingExperience from './OnboardingExperience'
import {
  readOnboardingRecord,
  recordOnboardingCompletion,
  updatePersistedChallenge,
} from './storage'

const demoConfig: PersonalizedDemoConfig = {
  venuePreset: 'ballroom',
  widthFt: 60,
  lengthFt: 33,
  tableStyle: 'round',
  seatsPerTable: 8,
  amenities: ['entrance', 'dance_floor', 'band', 'bathroom'],
  priority: 'family_harmony',
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: matches && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

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
    touched: {},
    agentLog: [],
    toast: null,
  })
}

describe('personalized first-run dialog', () => {
  beforeEach(() => {
    cleanup()
    document.body.innerHTML = ''
    localStorage.clear()
    setReducedMotion(false)
    resetStore()
  })

  it('supports Welcome, keyboard navigation, Back, dimension validation, and focus movement', async () => {
    const user = userEvent.setup()
    render(<OnboardingExperience initialFirstRun guideRequest={0} />)

    await user.click(screen.getByRole('button', { name: 'Welcome' }))
    expect(await screen.findByText('Where are we celebrating?')).toBeVisible()

    const ballroom = screen.getByRole('radio', { name: /Ballroom/i })
    ballroom.focus()
    await user.keyboard('{Enter}')
    const dimensions = await screen.findByRole('group', { name: 'Give the room its true proportions.' })
    await waitFor(() => expect(dimensions).toContainElement(document.activeElement as HTMLElement | null))

    await user.click(screen.getByRole('button', { name: /Back/i }))
    expect(await screen.findByText('Where are we celebrating?')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Next/i }))

    const width = screen.getByLabelText('Width')
    await user.clear(width)
    await user.type(width, '19')
    await user.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Width must be between 20 and 300 feet.')
    expect(width).toHaveFocus()
  })

  it('records Skip from both the button and Escape while leaving the chart empty', async () => {
    const user = userEvent.setup()
    render(<OnboardingExperience initialFirstRun guideRequest={0} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readOnboardingRecord()?.status).toBe('skipped')
    expect(getCore().guestOrder).toEqual([])

    cleanup()
    document.body.innerHTML = ''
    localStorage.clear()
    render(<OnboardingExperience initialFirstRun guideRequest={0} />)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readOnboardingRecord()?.status).toBe('skipped')
  })

  it('cannot be accidentally dismissed by an outside click', async () => {
    render(<OnboardingExperience initialFirstRun guideRequest={0} />)
    fireEvent.pointerDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.click(document.body)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(readOnboardingRecord()).toBeNull()
  })

  it('finishes atomically, renders reduced-motion-safe reveal, and launches the challenge', async () => {
    setReducedMotion(true)
    const user = userEvent.setup()
    render(<OnboardingExperience initialFirstRun guideRequest={0} />)

    await user.click(screen.getByRole('button', { name: 'Welcome' }))
    await screen.findByRole('group', { name: 'Where are we celebrating?' })
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await screen.findByRole('group', { name: 'Give the room its true proportions.' })
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await screen.findByRole('group', { name: 'How should the tables read across the room?' })
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await screen.findByRole('group', { name: 'Add the details that make the room yours.' })
    await user.click(screen.getByRole('button', { name: /Finish/i }))

    await waitFor(() => expect(screen.getByText('The room is ready')).toBeVisible())
    expect(screen.getByRole('dialog')).toHaveAttribute('data-reduced-motion', 'true')
    expect(document.querySelector('.welcome-sparkles')).not.toBeInTheDocument()
    expect(getCore().guestOrder).toHaveLength(72)
    expect(useStore.getState().undoStack).toHaveLength(1)
    expect(readOnboardingRecord()).toMatchObject({ status: 'completed', challenge: { status: 'active', step: 0 } })

    await user.click(screen.getByRole('button', { name: /Begin the challenge/i }))
    expect(await screen.findByText('Seat the room')).toBeVisible()
  })

  it('replays read-only guide marks without changing chart data', async () => {
    const user = userEvent.setup()
    const before = structuredClone(getCore())
    const { rerender } = render(<OnboardingExperience initialFirstRun={false} guideRequest={0} />)
    rerender(<OnboardingExperience initialFirstRun={false} guideRequest={1} />)
    await waitFor(() => expect(screen.getByText('Your agent sees this room')).toBeVisible())
    const guide = screen.getByLabelText('Welcome guide')
    await user.click(within(guide).getByRole('button', { name: 'Next' }))
    await user.click(within(guide).getByRole('button', { name: 'Skip' }))
    expect(getCore()).toEqual(before)
  })

  it('resumes a persisted challenge step and lets it be skipped safely', async () => {
    setReducedMotion(true)
    const user = userEvent.setup()
    expect(useStore.getState().loadPersonalizedSample(demoConfig).ok).toBe(true)
    recordOnboardingCompletion(demoConfig)
    updatePersistedChallenge({ step: 1 })

    render(<OnboardingExperience initialFirstRun={false} guideRequest={0} />)
    expect(await screen.findByText('Create a little tension')).toBeVisible()
    const coach = screen.getByLabelText('Personalized demo challenge')
    await user.click(within(coach).getByRole('button', { name: 'Skip' }))

    await waitFor(() => expect(screen.queryByLabelText('Personalized demo challenge')).not.toBeInTheDocument())
    expect(readOnboardingRecord()?.challenge).toEqual({ status: 'skipped', step: 1 })
  })
})
