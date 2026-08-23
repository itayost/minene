import type { BrandManifest, BrandSubject, ContentGroup } from './brand-types'
import { brandHref, subjectHref, TOOLS_SEGMENT } from './hrefs'
import { progressEntryKey, type ProgressMap } from './progress'

export type Screen =
  | { kind: 'home' }
  | { kind: 'menu'; subjectId: string }
  | { kind: 'viewer'; subjectId: string; groupId: string; pageIndex: number }
  | { kind: 'tool'; toolId: string }

export type NavigationAction =
  | { type: 'home' }
  | { type: 'back' }
  | { type: 'open-subject'; subjectId: string }
  | { type: 'open-group'; subjectId: string; groupId: string }
  | { type: 'open-tool'; toolId: string }
  | { type: 'page-next' }
  | { type: 'page-previous' }
  | { type: 'page-select'; pageIndex: number }
  // Aliases keep the reducer convenient for callers that phrase these actions as verbs.
  | { type: 'next-page' }
  | { type: 'previous-page' }
  | { type: 'select-page'; pageIndex: number }

export function createInitialScreen(): Screen {
  return { kind: 'home' }
}

function findSubject(brand: BrandManifest, subjectId: string): BrandSubject | undefined {
  return brand.subjects.find((subject) => subject.id === subjectId)
}

function findGroup(subject: BrandSubject, groupId: string): ContentGroup | undefined {
  return subject.groups.find((group) => group.id === groupId)
}

function restoredPageIndex(progress: ProgressMap, subjectId: string, group: ContentGroup): number {
  const candidate = progress[progressEntryKey(subjectId, group.id)]
  const index = typeof candidate === 'number' && Number.isFinite(candidate) && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : 0
  return Math.min(index, Math.max(0, group.pages.length - 1))
}

export function openGroup(brand: BrandManifest, subjectId: string, groupId: string, progress: ProgressMap): Screen {
  const subject = findSubject(brand, subjectId)
  const group = subject && findGroup(subject, groupId)
  if (!subject || !group || group.pages.length === 0) return createInitialScreen()

  return {
    kind: 'viewer',
    subjectId: subject.id,
    groupId: group.id,
    pageIndex: restoredPageIndex(progress, subject.id, group),
  }
}

export function openSubject(brand: BrandManifest, subjectId: string, progress: ProgressMap): Screen {
  const subject = findSubject(brand, subjectId)
  if (!subject || subject.groups.length === 0) return createInitialScreen()
  if (subject.groups.length === 1) return openGroup(brand, subject.id, subject.groups[0]!.id, progress)
  return { kind: 'menu', subjectId: subject.id }
}

function validScreen(brand: BrandManifest, screen: Screen): Screen {
  if (screen.kind === 'home') return screen
  if (screen.kind === 'menu') return findSubject(brand, screen.subjectId) ? screen : createInitialScreen()
  if (screen.kind === 'tool') return brand.tools.some((tool) => tool.id === screen.toolId) ? screen : createInitialScreen()

  const subject = findSubject(brand, screen.subjectId)
  const group = subject && findGroup(subject, screen.groupId)
  if (!subject || !group || group.pages.length === 0) return createInitialScreen()
  if (!Number.isFinite(screen.pageIndex) || !Number.isInteger(screen.pageIndex)) return createInitialScreen()
  const pageIndex = Math.max(0, Math.min(group.pages.length - 1, screen.pageIndex))
  return pageIndex === screen.pageIndex ? screen : { ...screen, pageIndex }
}

export function reduceNavigation(
  brand: BrandManifest,
  screen: Screen,
  action: NavigationAction,
  progress: ProgressMap,
): Screen {
  const current = validScreen(brand, screen)

  switch (action.type) {
    case 'home':
      return createInitialScreen()
    case 'open-subject':
      return openSubject(brand, action.subjectId, progress)
    case 'open-group':
      return openGroup(brand, action.subjectId, action.groupId, progress)
    case 'open-tool':
      return brand.tools.some((tool) => tool.id === action.toolId)
        ? { kind: 'tool', toolId: action.toolId }
        : createInitialScreen()
    case 'back':
      if (current.kind === 'viewer') {
        const subject = findSubject(brand, current.subjectId)
        return subject && subject.groups.length > 1
          ? { kind: 'menu', subjectId: subject.id }
          : createInitialScreen()
      }
      return createInitialScreen()
    case 'page-next':
    case 'next-page':
      if (current.kind !== 'viewer') return current
      return movePage(brand, current, 1)
    case 'page-previous':
    case 'previous-page':
      if (current.kind !== 'viewer') return current
      return movePage(brand, current, -1)
    case 'page-select':
    case 'select-page':
      if (current.kind !== 'viewer') return current
      return selectPage(brand, current, action.pageIndex)
  }
}

function groupForViewer(brand: BrandManifest, screen: Extract<Screen, { kind: 'viewer' }>): ContentGroup | undefined {
  const subject = findSubject(brand, screen.subjectId)
  return subject && findGroup(subject, screen.groupId)
}

function movePage(brand: BrandManifest, screen: Extract<Screen, { kind: 'viewer' }>, amount: number): Screen {
  const group = groupForViewer(brand, screen)
  if (!group || group.pages.length === 0) return createInitialScreen()
  const pageIndex = Math.max(0, Math.min(group.pages.length - 1, screen.pageIndex + amount))
  return { ...screen, pageIndex }
}

function selectPage(brand: BrandManifest, screen: Extract<Screen, { kind: 'viewer' }>, pageIndex: number): Screen {
  const group = groupForViewer(brand, screen)
  if (!group || group.pages.length === 0) return createInitialScreen()
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= group.pages.length) return screen
  return { ...screen, pageIndex }
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
  if (segments.length > 2) return null

  const first = segments[0]
  const second = segments[1]
  if (first === undefined) return null

  if (first === TOOLS_SEGMENT) {
    if (second === undefined) return null
    return brand.tools.some((tool) => tool.id === second)
      ? { kind: 'tool', toolId: second }
      : null
  }

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
  if (screen.kind === 'viewer') {
    const subject = findSubject(brand, screen.subjectId)
    if (subject && subject.groups.length > 1) return subjectHref(brand.id, subject.id)
  }
  return brandHref(brand.id)
}
