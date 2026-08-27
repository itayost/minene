import { createBrowserSupabase } from '../auth/supabase-browser'
import { RulesApiError } from '../brain/rules-api'
import type { BotConfig } from './engine/config'
import type { SimulationEvent } from './engine/simulation'

/**
 * The simulate route answers in NDJSON rather than JSON, so this cannot be the
 * `post()` in persuader-api: a run is ten model calls long, and waiting for the
 * whole body would leave the screen blank for the length of a conversation.
 *
 * The last four are the route's own, not the engine's, which has no notion of
 * scoring or of storage. `saved` is the one that matters to a caller: the
 * engine's `done` arrives before the scoring and the insert, so it says the
 * conversation ended, not that anything can be read back yet.
 */
export type SimulateEvent =
  | SimulationEvent
  | { type: 'unscored' }
  | { type: 'saved'; id: string }
  | { type: 'unsaved' }
  | { type: 'error'; message: string }

export interface SimulateRequest {
  config: BotConfig
  personaId: string
  cell: { industry: string; jobRoleId: string | null; need?: string | null }
}

/**
 * The same error class every other API layer here throws, rather than one of
 * this module's own.
 *
 * `useApiErrorHandler` branches on `code === 'UNAUTHORIZED'` to send the reader
 * back to sign in, and it recognises this class and DocumentsApiError only. A
 * private error class meant a 401 fell through to "show the message as text",
 * which leaves the reader looking at "ההרשאה פגה" on a screen where nothing
 * they can click will fix it.
 */
const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')

const refused = (status: number) => new RulesApiError(
  'REQUEST_FAILED',
  status,
  status === 403 ? 'רק בעלים יכול להריץ סימולציה.' : 'הרצת הסימולציה נכשלה.',
)

/**
 * Streams the run to `onEvent` line by line. Rejects before the first event when
 * the route refuses, so a caller can tell "not allowed" from "ran and produced
 * nothing" -- which look identical once the stream has opened.
 */
export async function streamSimulation(
  request: SimulateRequest,
  onEvent: (event: SimulateEvent) => void,
): Promise<void> {
  const { data } = await createBrowserSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw unauthorized()

  const response = await fetch('/api/persuade/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  })

  if (response.status === 401) throw unauthorized()
  if (!response.ok || !response.body) throw refused(response.status)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Keep the tail: a chunk boundary lands mid-line often enough that parsing
    // whatever arrived would drop roughly one turn per run.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as SimulateEvent)
    }
  }

  if (buffer.trim()) onEvent(JSON.parse(buffer) as SimulateEvent)
}
