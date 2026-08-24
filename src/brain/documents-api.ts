import type { BrainDocument } from './types'

const BUCKET = 'documents'
const RECENT_DOCUMENTS_LIMIT = 10
const DOCUMENT_COLUMNS = 'id,filename,topic_id,status,error,created_at'

const GENERIC_EXTRACTION_FAILURE_MESSAGE = 'אירעה שגיאה בעיבוד המסמך. נסי שוב מאוחר יותר.'

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

export type DocumentsApiCode =
  | 'UNAUTHORIZED'
  | 'UPLOAD_FAILED'
  | 'SAVE_FAILED'
  | 'LOAD_FAILED'
  | 'EXTRACTION_FAILED'

export class DocumentsApiError extends Error {
  readonly code: DocumentsApiCode

  constructor(code: DocumentsApiCode, message: string) {
    super(message)
    this.name = 'DocumentsApiError'
    this.code = code
  }
}

const unauthorized = () => new DocumentsApiError('UNAUTHORIZED', 'ההרשאה פגה. נא להתחבר מחדש.')
const uploadFailed = () => new DocumentsApiError('UPLOAD_FAILED', 'העלאת הקובץ נכשלה. נסי שוב.')
const saveFailed = () => new DocumentsApiError('SAVE_FAILED', 'שמירת המסמך נכשלה. נסי שוב.')
const loadFailed = () => new DocumentsApiError('LOAD_FAILED', 'לא הצלחנו לטעון את רשימת המסמכים.')

type PostgrestError = { code?: string | null }

/**
 * Storage uploads and function invocations surface an expired session as a
 * plain HTTP 401 with no PostgREST code, while PostgREST itself reports
 * PGRST301. Both have to be recognised or a reader whose session lapsed sees a
 * generic failure they cannot act on instead of being sent back to sign in.
 */
const isAuthError = (error: PostgrestError | null | undefined, status: number | undefined) =>
  error?.code === POSTGREST_JWT_EXPIRED || status === 401

type DocumentQuery = {
  select: (columns: string) => DocumentQuery
  eq: (column: string, value: unknown) => DocumentQuery
  order: (column: string, options: { ascending: boolean }) => DocumentQuery
  limit: (count: number) => PromiseLike<{ data: BrainDocument[] | null; error: PostgrestError | null; status?: number }>
  maybeSingle: () => PromiseLike<{ data: { status: string; error: string | null } | null; error: PostgrestError | null; status?: number }>
}

export type DocumentsClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => PromiseLike<{
      data: unknown
      error: { context?: { status?: number }; code?: string | null } | null
    }>
  }
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: File, options: { contentType: string }) => PromiseLike<{
        error: (PostgrestError & { status?: number }) | null
      }>
    }
  }
  from: (table: string) => DocumentQuery & {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: PostgrestError | null; status?: number }>
  }
}

export function createDocumentsApi(client: DocumentsClient) {
  return {
    /**
     * The object must land in storage BEFORE the documents row is inserted: the
     * row is what the extractor reads, and a row pointing at an object that is
     * not there yet is a race the extractor loses.
     *
     * The storage path follows public.documents.storage_path's documented
     * convention verbatim -- "<tenant_id>/<document_id>.pdf" -- because the
     * storage policy matches on that prefix. The format is load-bearing, not a
     * naming convention, and tenantId comes from the verified session, never
     * from user input.
     */
    async uploadDocument({ file, tenantId, topicId }: {
      file: File
      tenantId: string
      topicId: string
    }): Promise<{ documentId: string; storagePath: string }> {
      const documentId = crypto.randomUUID()
      const storagePath = `${tenantId}/${documentId}.pdf`

      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType: 'application/pdf' })

      if (uploadError) {
        throw isAuthError(uploadError, uploadError.status) ? unauthorized() : uploadFailed()
      }

      const { error: insertError, status: insertStatus } = await client.from('documents').insert({
        id: documentId,
        topic_id: topicId,
        filename: file.name,
        storage_path: storagePath,
      })

      if (insertError) {
        throw isAuthError(insertError, insertStatus) ? unauthorized() : saveFailed()
      }

      return { documentId, storagePath }
    },

    /**
     * A session that expired before the function ever ran has no
     * document-specific reason to look up, so that case short-circuits: querying
     * documents.error would just re-derive "you are signed out" from a row that
     * may not even reflect it.
     */
    async extractRules(documentId: string): Promise<unknown> {
      const { data, error } = await client.functions.invoke('extract-rules', { body: { documentId } })
      if (!error) return data

      if (isAuthError(error, error.context?.status)) throw unauthorized()

      const { data: doc, error: queryError, status: queryStatus } = await client
        .from('documents').select('status, error').eq('id', documentId).maybeSingle()

      // The fallback query can hit the same expired session. Without this check
      // its error is silently discarded and the reader sees the generic
      // extraction message instead of being sent back to sign in.
      if (queryError && isAuthError(queryError, queryStatus)) throw unauthorized()

      throw new DocumentsApiError('EXTRACTION_FAILED', doc?.error || GENERIC_EXTRACTION_FAILURE_MESSAGE)
    },

    /**
     * Visibility, not retry. Before this existed, a document's fate lived only
     * in in-session state: lost on refresh, and never populated at all when
     * extraction failed at the transport layer, leaving the row at 'processing'
     * and indistinguishable from work still in progress. An owner who can see a
     * document failed, or has sat at processing far too long, can upload again.
     *
     * No tenant filter: documents_select_owner already scopes this to the
     * caller's tenant and requires the owner role. A client-side filter on top
     * would be redundant at best, and a false sense of scoping if it ever
     * disagreed with RLS.
     *
     * Newest first, deliberately the opposite of the lobby's oldest-first. The
     * lobby is a queue to drain; this answers "what happened to my uploads",
     * where the one just watched failing is the one wanted without scrolling.
     *
     * The cap is never silent: one extra row is fetched so hasMore is answered
     * from this same query, rather than either loading an ever-growing list or
     * truncating without saying so.
     */
    async listRecentDocuments(): Promise<{ rows: BrainDocument[]; hasMore: boolean }> {
      const { data, error, status } = await client
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(RECENT_DOCUMENTS_LIMIT + 1)

      if (error) throw isAuthError(error, status) ? unauthorized() : loadFailed()

      const rows = data ?? []
      return {
        rows: rows.slice(0, RECENT_DOCUMENTS_LIMIT),
        hasMore: rows.length > RECENT_DOCUMENTS_LIMIT,
      }
    },
  }
}

export type DocumentsApi = ReturnType<typeof createDocumentsApi>
