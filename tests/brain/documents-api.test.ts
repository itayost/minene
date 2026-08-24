import { describe, expect, it, vi } from 'vitest'
import { createDocumentsApi, DocumentsApiError, type DocumentsClient } from '../../src/brain/documents-api'

const TENANT = '11111111-1111-4111-8111-111111111111'

function client(outcomes: {
  upload?: { error?: { code?: string; status?: number } | null }
  insert?: { error?: { code?: string } | null; status?: number }
  invoke?: { data?: unknown; error?: { context?: { status?: number }; code?: string } | null }
  docRow?: { data?: { status: string; error: string | null } | null; error?: { code?: string } | null; status?: number }
  list?: { data?: unknown[] | null; error?: { code?: string } | null; status?: number }
} = {}) {
  const order: string[] = []
  const uploads: { path: string; contentType: string }[] = []
  const inserts: Record<string, unknown>[] = []

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    functions: {
      invoke: vi.fn(async () => outcomes.invoke ?? { data: { ruleCount: 4 }, error: null }),
    },
    storage: {
      from: () => ({
        upload: async (path: string, _file: File, options: { contentType: string }) => {
          order.push('storage')
          uploads.push({ path, contentType: options.contentType })
          return outcomes.upload ?? { error: null }
        },
      }),
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => outcomes.list ?? { data: [], error: null },
        maybeSingle: async () => outcomes.docRow ?? { data: null, error: null },
        insert: async (values: Record<string, unknown>) => {
          order.push('row')
          inserts.push(values)
          return outcomes.insert ?? { error: null }
        },
      }
      return query
    },
  } as unknown as DocumentsClient

  return { api: createDocumentsApi(supabase), order, uploads, inserts }
}

const file = () => new File(['x'], 'rules.pdf', { type: 'application/pdf' })

describe('uploadDocument', () => {
  it('puts the object in storage before inserting the row', async () => {
    const { api, order } = client()
    await api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' })

    // The row is what the extractor reads. A row pointing at an object that is
    // not there yet is a race the extractor loses.
    expect(order).toEqual(['storage', 'row'])
  })

  it('builds the storage path the policy matches on', async () => {
    const { api, uploads } = client()
    const { documentId } = await api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' })

    // "<tenant_id>/<document_id>.pdf" is load-bearing, not a naming convention:
    // the storage policy matches on that prefix.
    expect(uploads[0]?.path).toBe(`${TENANT}/${documentId}.pdf`)
    expect(uploads[0]?.contentType).toBe('application/pdf')
  })

  it('writes every not-null column the documents row requires', async () => {
    const { api, inserts } = client()
    const { documentId } = await api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' })

    // toEqual, not toMatchObject. A subset match hid a real bug here: tenant_id
    // and uploaded_by are NOT NULL with no default and no trigger, and omitting
    // either fails the insert at 23502 -- after the PDF is already in the bucket,
    // leaving an orphan object no row references.
    expect(inserts[0]).toEqual({
      id: documentId,
      tenant_id: TENANT,
      topic_id: 'store',
      filename: 'rules.pdf',
      storage_path: `${TENANT}/${documentId}.pdf`,
      uploaded_by: 'user-1',
    })
  })

  it('reports an expired session rather than a generic upload failure', async () => {
    const { api } = client({ upload: { error: { status: 401 } } })

    await expect(api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('reports a genuine upload failure as such', async () => {
    const { api } = client({ upload: { error: { code: 'boom' } } })

    await expect(api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' }))
      .rejects.toMatchObject({ code: 'UPLOAD_FAILED' })
  })

  it('distinguishes a failed row insert from a failed upload', async () => {
    const { api } = client({ insert: { error: { code: 'boom' } } })

    await expect(api.uploadDocument({ file: file(), tenantId: TENANT, topicId: 'store' }))
      .rejects.toMatchObject({ code: 'SAVE_FAILED' })
  })
})

describe('extractRules', () => {
  it('short-circuits an expired session without querying the document', async () => {
    const { api } = client({ invoke: { error: { context: { status: 401 } } } })

    // A session that expired before the function ran has no document-specific
    // reason to look up.
    await expect(api.extractRules('doc-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('surfaces the document\'s own error when extraction failed', async () => {
    const { api } = client({
      invoke: { error: { context: { status: 500 } } },
      docRow: { data: { status: 'failed', error: 'הקובץ ריק' }, error: null },
    })

    await expect(api.extractRules('doc-1')).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
      message: 'הקובץ ריק',
    })
  })

  it('falls back to a generic message when the row carries no reason', async () => {
    const { api } = client({
      invoke: { error: { context: { status: 500 } } },
      docRow: { data: null, error: null },
    })

    await expect(api.extractRules('doc-1')).rejects.toBeInstanceOf(DocumentsApiError)
  })

  it('reports an expired session hit by the fallback query itself', async () => {
    const { api } = client({
      invoke: { error: { context: { status: 500 } } },
      docRow: { data: null, error: { code: 'PGRST301' }, status: 200 },
    })

    // Without this the fallback's own auth error is discarded and the reader
    // sees an extraction message instead of being sent back to sign in.
    await expect(api.extractRules('doc-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('listRecentDocuments', () => {
  it('caps the list and says so rather than truncating silently', async () => {
    const eleven = Array.from({ length: 11 }, (_, index) => ({ id: `doc-${index}` }))
    const { api } = client({ list: { data: eleven, error: null } })

    const result = await api.listRecentDocuments()

    expect(result.rows).toHaveLength(10)
    expect(result.hasMore).toBe(true)
  })

  it('reports no more when the page came back short', async () => {
    const { api } = client({ list: { data: [{ id: 'doc-0' }], error: null } })

    const result = await api.listRecentDocuments()

    expect(result.rows).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })
})
