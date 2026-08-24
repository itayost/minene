import { requireBrand } from '../../../../../src/auth/require-brand'
import { LobbyClient } from './lobby-client'

type LobbyParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'לובי אושר' }

export default async function LobbyPage({ params }: LobbyParams) {
  const { brandId } = await params
  await requireBrand(brandId)

  return <LobbyClient />
}
