import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/extract',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const documentsApi = vi.hoisted(() => ({
  uploadDocument: vi.fn(),
  saveConversation: vi.fn(),
  extractRules: vi.fn(),
  listRecentDocuments: vi.fn(),
}))
const rulesApi = vi.hoisted(() => ({ huntExternal: vi.fn() }))

vi.mock('../../src/brain/documents-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDocumentsApi: () => documentsApi,
}))
vi.mock('../../src/brain/rules-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRulesApi: () => rulesApi,
}))

const { ExtractClient } = await import('../../app/[brandId]/tools/brain/extract/extract-client')

const TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  documentsApi.uploadDocument.mockResolvedValue({ documentId: 'doc-1', storagePath: 'p' })
  documentsApi.saveConversation.mockResolvedValue({ documentId: 'doc-2' })
  documentsApi.extractRules.mockResolvedValue({ rules: [{}, {}] })
  documentsApi.listRecentDocuments.mockResolvedValue({ rows: [], hasMore: false })
  rulesApi.huntExternal.mockResolvedValue({ rules: [] })
})

const setup = () => {
  render(<ExtractClient tenantId={TENANT} />)
  return userEvent.setup()
}

const toConversation = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: 'שיחה' }))
}

describe('two ways into one pipeline', () => {
  it('opens on the file mode, which is the one that existed before', async () => {
    setup()

    expect(screen.getByRole('tab', { name: 'קובץ PDF' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('קובץ PDF')).toBeVisible()
  })

  it('saves a pasted thread instead of uploading a file', async () => {
    const user = setup()
    await toConversation(user)
    await user.type(screen.getByLabelText('כותרת (לא חובה)'), 'החזרות')
    await user.type(screen.getByLabelText('תוכן השיחה'), 'איך מטפלים בהחזר בלי חשבונית')
    await user.click(screen.getByRole('button', { name: 'העלאה וחילוץ' }))

    expect(documentsApi.saveConversation).toHaveBeenCalledWith({
      tenantId: TENANT,
      topicId: 'live',
      title: 'החזרות',
      text: 'איך מטפלים בהחזר בלי חשבונית',
    })
    expect(documentsApi.uploadDocument).not.toHaveBeenCalled()
  })

  it('runs the same extraction over a saved thread as over a document', async () => {
    const user = setup()
    await toConversation(user)
    await user.type(screen.getByLabelText('תוכן השיחה'), 'איך מטפלים בהחזר')
    await user.click(screen.getByRole('button', { name: 'העלאה וחילוץ' }))

    // Same table, same lifecycle, same function, same lobby. A second pipeline
    // is exactly what reusing the documents row avoids.
    expect(documentsApi.extractRules).toHaveBeenCalledWith('doc-2')
    expect(await screen.findByText(/2 חוקים חדשים/)).toBeVisible()
  })

  it('refuses an empty paste without creating a row', async () => {
    const user = setup()
    await toConversation(user)
    await user.click(screen.getByRole('button', { name: 'העלאה וחילוץ' }))

    expect(screen.getByRole('alert')).toHaveTextContent('יש להדביק את תוכן השיחה.')
    expect(documentsApi.saveConversation).not.toHaveBeenCalled()
  })

  it('clears what was typed in the other mode, not only the one being left', async () => {
    const user = setup()
    await toConversation(user)
    await user.type(screen.getByLabelText('תוכן השיחה'), 'טיוטה')
    await user.click(screen.getByRole('tab', { name: 'קובץ PDF' }))
    await toConversation(user)

    // A half-filled form from the other mode is invisible once its input is
    // unmounted, and submitting it would use a source nobody can still see.
    expect(screen.getByLabelText('תוכן השיחה')).toHaveValue('')
  })

  it('keeps the topic picker, the statuses and the list shared between both', async () => {
    const user = setup()
    await toConversation(user)

    // A second page would have duplicated all four, and the copies would drift.
    expect(screen.getByLabelText('נושא המסמך')).toBeVisible()
    expect(screen.getByRole('region', { name: 'מסמכים שהועלו לאחרונה' })).toBeVisible()
  })
})

describe('the hunt beside the upload', () => {
  it('offers the web search on the same screen', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'חיפוש ברשת' }))

    expect(rulesApi.huntExternal).toHaveBeenCalledWith({ topicId: 'live', subTopic: null })
  })

  it('keeps its own topic, so a hunt does not silently follow the upload form', async () => {
    const user = setup()
    await user.selectOptions(screen.getByLabelText('נושא המסמך'), 'store')
    await user.click(screen.getByRole('button', { name: 'חיפוש ברשת' }))

    // The hunt creates no document at all, so sharing the upload form's topic
    // would tie two unrelated actions to one control.
    expect(rulesApi.huntExternal).toHaveBeenCalledWith({ topicId: 'live', subTopic: null })
  })
})
