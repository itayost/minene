import { redirect } from 'next/navigation'

type Params = { params: Promise<{ brandId: string }> }

/**
 * This route is live on main and may be bookmarked. Extraction and the approval
 * queue are one screen now -- uploading and approving turned out to be one act.
 */
export default async function LobbyRedirect({ params }: Params) {
  const { brandId } = await params
  redirect(`/${brandId}/tools/brain/ingest`)
}
