import { SIGNAL_CATEGORIES, type SignalCategory } from '@/lib/signal/signal-category'

export const UMBRELLA_STATUSES = ['active', 'archived'] as const
export type UmbrellaStatus = (typeof UMBRELLA_STATUSES)[number]

export const SCAN_FREQUENCIES = ['manual', 'daily', 'every_48_hours', 'weekly'] as const
export type ScanFrequency = (typeof SCAN_FREQUENCIES)[number]

export const ANALYSIS_TYPES = ['standalone', 'umbrella_tagged', 'new_arc', 'arc_rerun'] as const
export type AnalysisType = (typeof ANALYSIS_TYPES)[number]

export const ARC_IMPORTANCES = ['core', 'reference'] as const
export type ArcImportance = (typeof ARC_IMPORTANCES)[number]

export const STORY_PHASES = ['first_wave', 'development', 'consolidation', 'tail'] as const
export type StoryPhase = (typeof STORY_PHASES)[number]

export function isSignalCategory(value: unknown): value is SignalCategory {
  return typeof value === 'string' && (SIGNAL_CATEGORIES as readonly string[]).includes(value)
}

export function isUmbrellaStatus(value: unknown): value is UmbrellaStatus {
  return typeof value === 'string' && (UMBRELLA_STATUSES as readonly string[]).includes(value)
}

export function isScanFrequency(value: unknown): value is ScanFrequency {
  return typeof value === 'string' && (SCAN_FREQUENCIES as readonly string[]).includes(value)
}

export function isAnalysisType(value: unknown): value is AnalysisType {
  return typeof value === 'string' && (ANALYSIS_TYPES as readonly string[]).includes(value)
}

export function isArcImportance(value: unknown): value is ArcImportance {
  return typeof value === 'string' && (ARC_IMPORTANCES as readonly string[]).includes(value)
}

export function isStoryPhase(value: unknown): value is StoryPhase {
  return typeof value === 'string' && (STORY_PHASES as readonly string[]).includes(value)
}
