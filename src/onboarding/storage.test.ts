import { beforeEach, describe, expect, it } from 'vitest'
import type { PersonalizedDemoConfig } from '../types'
import {
  ONBOARDING_STORAGE_KEY,
  readOnboardingRecord,
  recordOnboardingCompletion,
  recordOnboardingSkip,
  shouldShowFirstRun,
  updatePersistedChallenge,
} from './storage'

const config: PersonalizedDemoConfig = {
  venuePreset: 'ballroom',
  widthFt: 60,
  lengthFt: 33,
  tableStyle: 'round',
  seatsPerTable: 8,
  amenities: ['entrance'],
  priority: 'easy_arrivals',
}

describe('first-run and onboarding persistence', () => {
  beforeEach(() => localStorage.clear())

  it('opens only for a pristine browser', () => {
    expect(shouldShowFirstRun({ hasOnboardingRecord: false, hasPersistedChart: false, hasChartData: false })).toBe(true)
    expect(shouldShowFirstRun({ hasOnboardingRecord: true, hasPersistedChart: false, hasChartData: false })).toBe(false)
    expect(shouldShowFirstRun({ hasOnboardingRecord: false, hasPersistedChart: true, hasChartData: false })).toBe(false)
    expect(shouldShowFirstRun({ hasOnboardingRecord: false, hasPersistedChart: false, hasChartData: true })).toBe(false)
  })

  it('stores skipped and completed states separately from the chart', () => {
    recordOnboardingSkip()
    expect(readOnboardingRecord()).toMatchObject({ status: 'skipped', challenge: { status: 'skipped' } })

    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    recordOnboardingCompletion(config)
    expect(readOnboardingRecord()).toMatchObject({
      status: 'completed',
      lastConfiguration: config,
      challenge: { status: 'active', step: 0 },
    })
  })

  it('reloads and resumes an active challenge step', () => {
    recordOnboardingCompletion(config)
    updatePersistedChallenge({ step: 2 })
    expect(readOnboardingRecord()?.challenge).toEqual({ status: 'active', step: 2 })
  })
})
