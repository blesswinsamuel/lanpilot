export type Period = '15m' | '1h' | '6h' | '1d' | '3d' | '7d'

export const PERIODS: readonly Period[] = ['15m', '1h', '6h', '1d', '3d', '7d'] as const

export function isPeriod(val: string | null): val is Period {
  return val === '15m' || val === '1h' || val === '6h' || val === '1d' || val === '3d' || val === '7d'
}

export function calculateStepSeconds(durationSeconds: number, maxPoints = 100): number {
  // Common clean step intervals (seconds) >= TSDB 15s sample interval
  const buckets = [15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400]
  for (const b of buckets) {
    if (durationSeconds / b <= maxPoints) {
      return b
    }
  }
  return Math.max(15, Math.ceil(durationSeconds / maxPoints))
}

export function getPeriodRange(period: Period, maxPoints = 100): { fromUnix: number; toUnix: number; stepSeconds: number } {
  const now = Math.floor(Date.now() / 1000)
  let duration = 86400
  switch (period) {
    case '15m':
      duration = 900
      break
    case '1h':
      duration = 3600
      break
    case '6h':
      duration = 21600
      break
    case '1d':
      duration = 86400
      break
    case '3d':
      duration = 259200
      break
    case '7d':
      duration = 604800
      break
  }
  return {
    fromUnix: now - duration,
    toUnix: now,
    stepSeconds: calculateStepSeconds(duration, maxPoints),
  }
}
