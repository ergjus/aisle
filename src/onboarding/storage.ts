import type { PersonalizedDemoConfig } from '../types'

export const ONBOARDING_STORAGE_KEY = 'aisle:onboarding:v1'
export const CHART_STORAGE_KEY = 'aisle:v1'

export type ChallengeStep = 0 | 1 | 2

export interface PersistedChallengeState {
  status: 'active' | 'completed' | 'skipped'
  step: ChallengeStep
}

export interface OnboardingRecord {
  version: 1
  status: 'completed' | 'skipped'
  lastConfiguration: PersonalizedDemoConfig | null
  challenge: PersistedChallengeState
}

export function readOnboardingRecord(): OnboardingRecord | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingRecord>
    if (parsed.version !== 1 || (parsed.status !== 'completed' && parsed.status !== 'skipped')) return null
    if (!parsed.challenge) return null
    return parsed as OnboardingRecord
  } catch {
    return null
  }
}

export function writeOnboardingRecord(record: OnboardingRecord): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // The experience remains usable for this session when storage is unavailable.
  }
}

export function recordOnboardingSkip(): OnboardingRecord {
  const record: OnboardingRecord = {
    version: 1,
    status: 'skipped',
    lastConfiguration: null,
    challenge: { status: 'skipped', step: 0 },
  }
  writeOnboardingRecord(record)
  return record
}

export function recordOnboardingCompletion(config: PersonalizedDemoConfig): OnboardingRecord {
  const record: OnboardingRecord = {
    version: 1,
    status: 'completed',
    lastConfiguration: { ...config, amenities: [...config.amenities] },
    challenge: { status: 'active', step: 0 },
  }
  writeOnboardingRecord(record)
  return record
}

export function updatePersistedChallenge(
  patch: Partial<PersistedChallengeState>,
): OnboardingRecord | null {
  const current = readOnboardingRecord()
  if (!current || current.status !== 'completed') return current
  const next: OnboardingRecord = {
    ...current,
    challenge: { ...current.challenge, ...patch },
  }
  writeOnboardingRecord(next)
  return next
}

export interface FirstRunGateInput {
  hasOnboardingRecord: boolean
  hasPersistedChart: boolean
  hasChartData: boolean
}

export function shouldShowFirstRun(input: FirstRunGateInput): boolean {
  return !input.hasOnboardingRecord && !input.hasPersistedChart && !input.hasChartData
}

export function readFirstRunGate(hasChartData: boolean): boolean {
  try {
    return shouldShowFirstRun({
      hasOnboardingRecord: localStorage.getItem(ONBOARDING_STORAGE_KEY) !== null,
      hasPersistedChart: localStorage.getItem(CHART_STORAGE_KEY) !== null,
      hasChartData,
    })
  } catch {
    return false
  }
}
