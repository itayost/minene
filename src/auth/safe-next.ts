/**
 * A return-to path is attacker-supplied: it arrives as `?next=` on a URL anyone
 * can send. Only a same-origin absolute path is ever safe to redirect to.
 */
export function safeNextPath(next: string | null): string | null {
  if (!next) return null
  if (!next.startsWith('/')) return null

  // Browsers read a leading `//` as protocol-relative, so `//evil.example` is an
  // off-site redirect that passes a naive startsWith('/') check. Some also
  // normalise a backslash to a slash, which makes `/\evil.example` the same
  // attack wearing a different first character.
  if (next.startsWith('//') || next.startsWith('/\\')) return null

  return next
}

/**
 * A brand is a tenant boundary, so a return-to path is only honoured when it
 * belongs to the caller's own brand. A deep link shared from another tenant must
 * not survive a login prompt.
 */
export function nextWithinBrand(next: string | null, brandId: string): string | null {
  const safe = safeNextPath(next)
  if (!safe) return null

  const path = safe.split('?')[0] ?? ''
  const firstSegment = path.split('/').filter(Boolean)[0]

  // Compared segment by segment, not by prefix: `/minene-other` starts with
  // `/minene` but is a different brand belonging to a different tenant.
  return firstSegment === brandId ? safe : null
}
