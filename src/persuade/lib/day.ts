/**
 * The boundary the daily cap is measured against.
 *
 * UTC midnight, and shared rather than computed twice: `attemptsToday` in
 * worker.ts enforces the cap over this window, and the lab screen displays a
 * count against that same cap. Two copies of the arithmetic would let a change
 * to one silently desync the number shown from the number enforced, and the
 * pair only reads as correct while they agree.
 *
 * No imports, so the client bundle can take it and
 * tests/persuade/tenant-boundary.test.ts stays satisfied.
 */
export function startOfUtcDay(now: Date = new Date()): string {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  return start.toISOString()
}
