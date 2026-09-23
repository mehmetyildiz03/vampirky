export const PHASE_DURATIONS_SECONDS = {
  discussion: 90,
  night: 40,
  voting: 30,
} as const

export function formatPhaseTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function isPhaseTimeUrgent(seconds: number): boolean {
  return seconds > 0 && seconds <= 10
}
