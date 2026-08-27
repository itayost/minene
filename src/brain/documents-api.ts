import type { BrainDocument } from './types'

const BUCKET = 'documents'
const RECENT_DOCUMENTS_LIMIT = 10
const DOCUMENT_COLUMNS = 'id,filename,topic_id,status,error,created_at,source_type'

/**
 * Matches documents.raw_text's own check constraint. Checked here as well as
 * there so an over-long paste is refused with a Hebrew sentence in front of the
 * person, rather than as a constraint violation after a round trip.
 */
const MAX_CONVERSATION_CHARS = 200_000

/** The name a paste gets when whoever pasted it did not bother to title one. */
const UNTITLED_CONVERSATION = 'שיחה שהודבקה'

const GENERIC_EXTRACTION_FAILURE_MESSAGE = 'אירעה שגיאה בעיבוד המסמך. נסי שוב מאוחר יותר.'

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

export type DocumentsApiCode =
  | 'UNAUTHORIZED'
  | 'UPLOAD_FAILED'
  | 'SAVE_FAILED'
  | 'LOAD_FAILED'
  | 'EXTRACTION_FAILED'
  | 'EMPTY_CONVERSATION'
  | 'CONVERSATION_TOO_LONG'

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
const emptyConversation = () => new DocumentsApiError('EMPTY_CONVERSATION', 'יש להדביק את תוכן השיחה.')
const conversationTooLong = () => new DocumentsApiError(
  'CONVERSATION_TOO_LONG',
  `השיחה ארוכה מדי. הגבול הוא ${MAX_CONVERSATION_CHARS.toLocaleString('he-IL')} תווים.`,
)

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
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null } | null; error: unknown }> }
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

      // uploaded_by is read from the session rather than threaded in from the
      // caller: the signed-in session already carries it, and unlike tenantId
      // and topicId -- which are deliberately client-known state -- an identity
      // claim must never be spoofable from the browser.
      //
      // Both tenant_id and uploaded_by are NOT NULL with no default and no
      // trigger to fill them. Omitting either fails the insert at 23502, and by
      // then the PDF is already in the bucket, leaving an orphan object no row
      // references.
      const { data: userData, error: userError } = await client.auth.getUser()
      if (userError || !userData?.user) throw saveFailed()

      const { error: insertError, status: insertStatus } = await client.from('documents').insert({
        id: documentId,
        tenant_id: tenantId,
        topic_id: topicId,
        filename: file.name,
        storage_path: storagePath,
        uploaded_by: userData.user.id,
      })

      if (insertError) {
        throw isAuthError(insertError, insertStatus) ? unauthorized() : saveFailed()
      }

      return { documentId, storagePath }
    },

    /**
     * A pasted chat thread, saved as a document so it goes through the same
     * extraction the PDF pipeline already runs: same table, same
     * processing/ready/failed lifecycle, same extract-rules, same approval
     * lobby, same provenance link from every rule back to where it came from.
     *
     * The useful knowledge in this business is already sitting in threads
     * nobody kept: someone worked out how to handle a return, or how to phrase
     * an upsell, in a conversation that was never written down.
     *
     * No storage step at all, which is what makes this shorter than
     * uploadDocument rather than a variant of it: there is no object, so there
     * is no ordering hazard between an upload and a row, and no path convention
     * to keep in step with the storage policy.
     */
    async saveConversation({ tenantId, topicId, title, text }: {
      tenantId: string
      topicId: string
      title: string
      text: string
    }): Promise<{ documentId: string }> {
      const trimmed = text.trim()
      if (!trimmed) throw emptyConversation()
      if (trimmed.length > MAX_CONVERSATION_CHARS) throw conversationTooLong()

      const documentId = crypto.randomUUID()

      // Read from the session for the same reason uploadDocument does: tenantId
      // and topicId are deliberately client-known state, an identity claim is
      // not.
      const { data: userData, error: userError } = await client.auth.getUser()
      if (userError || !userData?.user) throw saveFailed()

      const { error: insertError, status: insertStatus } = await client.from('documents').insert({
        id: documentId,
        tenant_id: tenantId,
        topic_id: topicId,
        // filename is NOT NULL and is what the documents list renders, so a
        // conversation needs a name too.
        filename: title.trim() || UNTITLED_CONVERSATION,
        source_type: 'conversation',
        raw_text: trimmed,
        // storage_path is omitted rather than sent as null: that is exactly what
        // documents_source_shape requires of a conversation row, and omitting it
        // keeps this insert from naming a path convention it has no part in.
        uploaded_by: userData.user.id,
      })

      if (insertError) {
        throw isAuthError(insertError, insertStatus) ? unauthorized() : saveFailed()
      }

      return { documentId }
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
