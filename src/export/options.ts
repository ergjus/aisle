import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from './model'

/**
 * Persisted export-composer options — shared between the human-facing dialog
 * and the agent's export_chart tool, so whichever hand touched them last wins
 * and both always see the same composition.
 */

export const EXPORT_OPTIONS_KEY = 'aisle:export:options'

export function loadExportOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(EXPORT_OPTIONS_KEY)
    if (!raw) return DEFAULT_EXPORT_OPTIONS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_EXPORT_OPTIONS,
      ...parsed,
      sections: { ...DEFAULT_EXPORT_OPTIONS.sections, ...(parsed.sections ?? {}) },
    }
  } catch {
    return DEFAULT_EXPORT_OPTIONS
  }
}

export function saveExportOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(EXPORT_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    // Preference simply won't stick.
  }
}
