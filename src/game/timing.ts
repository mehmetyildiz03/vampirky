export type PhaseDurationKey = 'discussion' | 'night' | 'voting'

export type PhaseDurations = Record<PhaseDurationKey, number>

export const PHASE_DURATIONS_SECONDS: PhaseDurations = {
  discussion: 90,
  night: 40,
  voting: 30,
}

export const PHASE_DURATION_RULES: Record<
  PhaseDurationKey,
  { min: number; max: number; step: number }
> = {
  discussion: { min: 30, max: 300, step: 30 },
  night: { min: 20, max: 120, step: 10 },
  voting: { min: 15, max: 90, step: 15 },
}

export function adjustPhaseDuration(
  key: PhaseDurationKey,
  current: number,
  direction: -1 | 1,
): number {
  const rule = PHASE_DURATION_RULES[key]
  return Math.min(rule.max, Math.max(rule.min, current + direction * rule.step))
}

export function formatPhaseTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function isPhaseTimeUrgent(seconds: number): boolean {
  return seconds > 0 && seconds <= 10
}
