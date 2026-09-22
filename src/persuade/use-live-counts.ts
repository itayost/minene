'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { startOfUtcDay } from './lib/day'

export { startOfUtcDay }

export interface Counts {
  total: number
  today: number
  attemptsToday: number
}

interface CountsApi {
  countSimulations(): Promise<number>
  countSimulationsSince(iso: string): Promise<number>
  countAttemptsSince(iso: string): Promise<number>
}

/**
 * A poll, not Realtime.
 *
 * public.simulations is not in the supabase_realtime publication and nothing in
 * this codebase uses Realtime, so a subscription costs a migration in a second
 * repo and a new runtime dependency. The worker ticks every ten minutes and its
 * runs land in a burst, so fifteen seconds catches a burst within seconds of it
 * starting. The difference is not perceptible on this screen.
 */
const INTERVAL_MS = 15_000

export function useLiveCounts(api: CountsApi) {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [lastOk, setLastOk] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  const running = useRef(false)

  const refresh = useCallback(async () => {
    // Overlapping reads would let a slow response overwrite a newer one.
    if (running.current) return
    running.current = true
    try {
      const since = startOfUtcDay()
      const [total, today, attemptsToday] = await Promise.all([
        api.countSimulations(),
        api.countSimulationsSince(since),
        api.countAttemptsSince(since),
      ])
      setCounts({ total, today, attemptsToday })
      setLastOk(new Date())
      setStale(false)
    } catch {
      // The last good numbers stay on screen and are marked stale. Blanking
      // them would lose a true reading to report a transient failure.
      setStale(true)
    } finally {
      running.current = false
    }
  }, [api])

  useEffect(() => {
    void refresh()
    // Paused while the tab is hidden: a background tab polling every fifteen
    // seconds spends requests nobody is reading.
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(tick, INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  // Wrapped once rather than per render: a fresh arrow every render would make
  // every `useCallback` and `useEffect` a caller hangs off this identity fire
  // again on every render, which is the opposite of what those guards are for.
  const trigger = useCallback(() => {
    void refresh()
  }, [refresh])

  return { counts, stale, lastOk, refresh: trigger }
}
