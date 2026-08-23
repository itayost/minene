/**
 * Unwrap a value a caller has already guaranteed to exist. Reaching the
 * `undefined` branch means the guarantee was violated, which is a bug in the
 * caller, not a legitimate "not found" outcome, so it throws rather than
 * returning an optional the caller would have to needlessly re-check.
 */
export function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}
