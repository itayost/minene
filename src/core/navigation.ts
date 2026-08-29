import type { BrandManifest, BrandSubject, ContentGroup } from './brand-types'
import { brandHref, subjectHref, TOOLS_SEGMENT, toolHref } from './hrefs'

export type Screen =
  | { kind: 'home' }
  | { kind: 'menu'; subjectId: string }
  | { kind: 'viewer'; subjectId: string; groupId: string; pageIndex: number }
  | { kind: 'tool'; toolId: string; subPath: readonly string[] }

export function createInitialScreen(): Screen {
  return { kind: 'home' }
}

function findSubject(brand: BrandManifest, subjectId: string): BrandSubject | undefined {
  return brand.subjects.find((subject) => subject.id === subjectId)
}

function findGroup(subject: BrandSubject, groupId: string): ContentGroup | undefined {
  return subject.groups.find((group) => group.id === groupId)
}

/**
 * A `?page=` value is a position inside a group that does exist, not a resource
 * of its own, so a bad one is corrected rather than refused.
 */
export function clampPageIndex(pageParam: string | null, pageCount: number): number {
  if (pageParam === null || pageParam.trim() === '') return 0

  const parsed = Number(pageParam)
  if (!Number.isInteger(parsed)) return 0

  return Math.max(0, Math.min(pageCount - 1, parsed - 1))
}

/**
 * Turn the path segments beneath a brand into a screen, or null when the URL
 * names something that does not exist. Null is a 404, never a silent redirect
 * to the home screen: answering a missing resource with 200 would be a lie.
 */
export function resolveScreen(
  brand: BrandManifest,
  segments: readonly string[],
  pageParam: string | null,
): Screen | null {
  if (segments.length === 0) return createInitialScreen()

  const first = segments[0]
  const second = segments[1]
  if (first === undefined) return null

  // Checked before the depth guard below, because a tool owns everything
  // beneath it. Route files decide which sub-screens exist; this only decides
  // whose shell the reader is inside, so the header, the back control and the
  // highlighted navigation item stay right all the way down. Without this a
  // path like /minene/tools/brain/lobby resolves to null, and the shell turns
  // null into the home screen -- brand lockup, no back control, Home
  // highlighted -- with no error anywhere.
  if (first === TOOLS_SEGMENT) {
    if (second === undefined) return null
    return brand.tools.some((tool) => tool.id === second)
      ? { kind: 'tool', toolId: second, subPath: segments.slice(2) }
      : null
  }

  // Subjects stay capped at two segments: a subject holds groups, and nothing
  // below a group is addressable.
  if (segments.length > 2) return null

  const subject = findSubject(brand, first)
  if (!subject) return null
  if (second === undefined) return { kind: 'menu', subjectId: subject.id }

  const group = findGroup(subject, second)
  if (!group || group.pages.length === 0) return null

  return {
    kind: 'viewer',
    subjectId: subject.id,
    groupId: group.id,
    pageIndex: clampPageIndex(pageParam, group.pages.length),
  }
}

/**
 * Where the in-application back control goes. Deterministically the parent
 * route, never history.back(), which preserves the previous back behaviour.
 */
export function parentHref(brand: BrandManifest, screen: Screen): string {
  // A tool sub-screen goes back to the tool, not past it to the brand root.
  if (screen.kind === 'tool' && screen.subPath.length > 0) {
    return toolHref(brand.id, screen.toolId)
  }

  if (screen.kind === 'viewer') {
    const subject = findSubject(brand, screen.subjectId)
    if (subject && subject.groups.length > 1) return subjectHref(brand.id, subject.id)
  }
  return brandHref(brand.id)
}
