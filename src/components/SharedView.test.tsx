import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCore, useStore } from '../store'
import { exitSharedView } from '../share/viewer'
import { Header } from './Header'
import { SharedViewBar, findGuests } from './SharedViewBar'

function showSharedSample() {
  const store = useStore.getState()
  store.resetAll()
  const t1 = useStore.getState().addTable({ name: 'Table 1', seats: 4 })
  const t2 = useStore.getState().addTable({ name: 'Garden Table', seats: 4 })
  const rosa = useStore.getState().addGuest({ name: 'Grandma Rosa Rossi' })
  const ezio = useStore.getState().addGuest({ name: 'Grandpa Ezio Rossi' })
  const jose = useStore.getState().addGuest({ name: 'José Álvarez' })
  useStore.getState().seatGuest(rosa.id, t2.id)
  useStore.getState().seatGuest(ezio.id, t2.id)
  useStore.getState().seatGuest(jose.id, t1.id)
  const chart = structuredClone(getCore())
  useStore.getState().resetAll()
  useStore.getState().showSharedChart(chart, { title: 'June & Ravi' })
  return { rosa }
}

describe('the shared, view-only chart', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
  })

  afterEach(() => {
    if (useStore.getState().viewMode === 'shared') exitSharedView()
  })

  it('says it is view only and hides every editing control, keeping Print', () => {
    showSharedSample()
    render(
      <>
        <Header onWelcomeGuide={() => {}} />
        <SharedViewBar />
      </>,
    )
    expect(screen.getByText('Shared seating chart · view only')).toBeInTheDocument()
    expect(screen.getByText('June & Ravi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Make a copy to edit/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Seat everyone/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Share link/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('finds a guest’s seat by name and spotlights them', async () => {
    const { rosa } = showSharedSample()
    render(<SharedViewBar />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('combobox', { name: /Find your seat/ }), 'rosa')
    await user.click(await screen.findByRole('option', { name: /Grandma Rosa Rossi/ }))
    expect(useStore.getState().foundGuest).toBe(rosa.id)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Garden Table')
    expect(status).toHaveTextContent('seat 1')
    expect(status).toHaveTextContent('with Grandpa Ezio Rossi')
  })

  it('matches names regardless of accents and word order', () => {
    showSharedSample()
    const state = useStore.getState()
    const name = (id: string) => state.guests[id].name
    expect(findGuests(state, 'jose').map(name)).toEqual(['José Álvarez'])
    expect(findGuests(state, 'rossi ezio').map(name)).toEqual(['Grandpa Ezio Rossi'])
    expect(findGuests(state, '   ')).toEqual([])
  })
})
