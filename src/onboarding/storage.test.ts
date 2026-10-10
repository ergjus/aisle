import { beforeEach, describe, expect, it } from 'vitest'
import type { PersonalizedDemoConfig } from '../types'
import {
  ONBOARDING_STORAGE_KEY,
  readOnboardingRecord,
  recordOnboardingCompletion,
  recordOnboardingSkip,
  shouldShowFirstRun,
} from './storage'

const config: PersonalizedDemoConfig = {
  venuePreset: 'ballroom',
  widthFt: 60,
  lengthFt: 33,
  tableStyle: 'round',
  seatsPerTable: 8,
  amenities: ['entrance'],
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
    expect(readOnboardingRecord()).toMatchObject({ status: 'skipped', lastConfiguration: null })

    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    recordOnboardingCompletion(config)
    expect(readOnboardingRecord()).toMatchObject({
      status: 'completed',
      lastConfiguration: config,
    })
  })

  it('still reads records written while the guided challenge existed', () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ version: 1, status: 'completed', lastConfiguration: config, challenge: { status: 'active', step: 2 } }),
    )
    expect(readOnboardingRecord()).toEqual({ version: 1, status: 'completed', lastConfiguration: config })
  })
})
