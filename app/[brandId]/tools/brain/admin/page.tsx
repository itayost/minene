import { redirect } from 'next/navigation'

type Params = { params: Promise<{ brandId: string }> }

/**
 * This route is live on main and may be bookmarked. Its list was the book's
 * list with owner chrome, so it goes to the book rather than anywhere new.
 */
export default async function AdminRedirect({ params }: Params) {
  const { brandId } = await params
  redirect(`/${brandId}/tools/brain`)
}
