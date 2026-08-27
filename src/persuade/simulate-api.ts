import { createBrowserSupabase } from '../auth/supabase-browser'
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

export class SimulateError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'SimulateError'
  }
}

const MESSAGES: Record<number, string> = {
  401: 'ההרשאה פגה. נא להתחבר מחדש.',
  403: 'רק בעלים יכול להריץ סימולציה.',
}

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
  if (!token) throw new SimulateError(401, MESSAGES[401]!)

  const response = await fetch('/api/persuade/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  })

  if (!response.ok || !response.body) {
    throw new SimulateError(response.status, MESSAGES[response.status] ?? 'הרצת הסימולציה נכשלה.')
  }

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
