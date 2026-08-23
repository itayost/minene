/** The static route segment that separates tools from subjects under a brand. */
export const TOOLS_SEGMENT = 'tools'

export function brandHref(brandId: string): string {
  return `/${brandId}`
}

export function subjectHref(brandId: string, subjectId: string): string {
  return `/${brandId}/${subjectId}`
}

/**
 * The page parameter is one-based in the URL and omitted for the first page, so
 * a group's canonical address is its bare path.
 */
export function groupHref(
  brandId: string,
  subjectId: string,
  groupId: string,
  pageIndex?: number,
): string {
  const base = `/${brandId}/${subjectId}/${groupId}`
  if (pageIndex === undefined || pageIndex <= 0) return base
  return `${base}?page=${pageIndex + 1}`
}

export function toolHref(brandId: string, toolId: string): string {
  return `/${brandId}/${TOOLS_SEGMENT}/${toolId}`
}
