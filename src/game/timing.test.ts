import { describe, expect, it } from 'vitest'
import {
  PHASE_DURATIONS_SECONDS,
  PHASE_DURATION_RULES,
  adjustPhaseDuration,
  formatPhaseTime,
  isPhaseTimeUrgent,
} from './timing'

describe('phase timing', () => {
  it('uses the intended default phase durations', () => {
    expect(PHASE_DURATIONS_SECONDS).toEqual({
      discussion: 90,
      night: 40,
      voting: 30,
    })
  })

  it('keeps configurable durations inside safe ranges', () => {
    expect(adjustPhaseDuration('discussion', 90, 1)).toBe(120)
    expect(adjustPhaseDuration('discussion', PHASE_DURATION_RULES.discussion.max, 1))
      .toBe(PHASE_DURATION_RULES.discussion.max)
    expect(adjustPhaseDuration('night', 40, -1)).toBe(30)
    expect(adjustPhaseDuration('night', PHASE_DURATION_RULES.night.min, -1))
      .toBe(PHASE_DURATION_RULES.night.min)
    expect(adjustPhaseDuration('voting', 30, 1)).toBe(45)
  })

  it('formats countdown values as mm:ss and clamps negatives', () => {
    expect(formatPhaseTime(90)).toBe('01:30')
    expect(formatPhaseTime(40)).toBe('00:40')
    expect(formatPhaseTime(0)).toBe('00:00')
    expect(formatPhaseTime(-5)).toBe('00:00')
  })

  it('marks only the last ten positive seconds as urgent', () => {
    expect(isPhaseTimeUrgent(11)).toBe(false)
    expect(isPhaseTimeUrgent(10)).toBe(true)
    expect(isPhaseTimeUrgent(1)).toBe(true)
    expect(isPhaseTimeUrgent(0)).toBe(false)
  })
})
