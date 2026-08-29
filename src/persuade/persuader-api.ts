import { createBrowserSupabase } from '../auth/supabase-browser'
import { RulesApiError } from '../brain/rules-api'
import type { ConversationState, Run, Turn } from './engine/types'

/**
 * The persuasion engine, now same-origin and streamed.
 *
 * The types here are the engine's own, imported rather than restated. An
 * earlier version of this file declared its own `{ speaker, text }` turn and a
 * singular `blocker`, neither of which the routes ever return -- and because
 * the component's tests mocked that invented shape, they passed while the real
 * screen rendered nothing. Importing the types is what makes that class of
 * mistake a compile error instead of a silent blank.
 */
export type ConversationResult = {
  turns: Turn[]
  state: ConversationState
  stopped?: { stop: boolean; reason: string | null }
  run?: Run
}

/**
 * What the caller can watch while the answer is still being written.
 *
 * `onDelta` receives the message so far, not the fragment: a component that
 * appends fragments has to hold a buffer and reset it at the right moment, and
 * the right moment is exactly what gets missed when a second turn starts. The
 * whole string is idempotent to render.
 */
export interface ConversationWatcher {
  onPreparing?: () => void
  onDelta?: (soFar: string) => void
}

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) =>
  new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

/**
 * The routes read the caller from the Authorization header, not from the
 * cookie -- resolveCaller takes a bearer string and nothing else. Same origin
 * means the cookie is sent, but nothing reads it, so every call was answered
 * 401 until this header existed.
 */
async function authorization(): Promise<string> {
  const { data } = await createBrowserSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw unauthorized()
  return `Bearer ${token}`
}

type StreamEvent =
  | { type: 'preparing' }
  | { type: 'delta'; text: string }
  | {
      type: 'result'
      turns: Turn[]
      state: ConversationState
      stopped?: ConversationResult['stopped']
      run?: Run
    }
  | { type: 'error'; message: string }

/**
 * Reads the route's NDJSON and resolves with the last event.
 *
 * A refusal still arrives as a status, so those two checks come first and are
 * unchanged: the session expiring has to be able to send someone to sign in,
 * and it cannot do that from inside a 200.
 */
async function post(
  path: string,
  body: unknown,
  watch: ConversationWatcher = {},
): Promise<ConversationResult> {
  const response = await fetch(`/api/persuade/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await authorization() },
    body: JSON.stringify(body),
  })

  if (response.status === 401) throw unauthorized()
  if (!response.ok) throw failed(response.status)
  if (!response.body) throw failed(response.status)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let message = ''
  let result: ConversationResult | null = null

  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as StreamEvent
    if (event.type === 'preparing') {
      watch.onPreparing?.()
    } else if (event.type === 'delta') {
      message += event.text
      watch.onDelta?.(message)
    } else if (event.type === 'result') {
      result = { turns: event.turns, state: event.state, stopped: event.stopped, run: event.run }
    } else if (event.type === 'error') {
      // Thrown rather than returned. An error that arrives mid-stream is still
      // an error, and a caller that has to check a field for one will forget.
      throw new RulesApiError('REQUEST_FAILED', 500, event.message)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // The last piece is whatever came after the final newline, which is either
    // empty or half an event. Held back rather than parsed: a chunk boundary
    // lands mid-object often enough that parsing it is a crash, not a rarity.
    buffer = lines.pop() ?? ''
    for (const line of lines) handle(line)
  }
  handle(buffer)

  // A stream that ended without one means the connection dropped part-way. It
  // is not a conversation the caller can continue from, so it fails rather than
  // returning a half state that would be sent back on the next turn.
  if (!result) throw failed(response.status)
  return result
}

/**
 * No plan travels from here.
 *
 * The route derives it from the assignment's own ammunition, which is both the
 * only place it can come from and the only version of it nobody can tamper
 * with. A client that sent its own plan would be choosing which arguments the
 * bot is allowed to make.
 */
export function createPersuaderApi() {
  return {
    openConversation: ({ assignmentId }: { assignmentId: string }, watch?: ConversationWatcher) =>
      post('chat', { assignmentId, turns: [] }, watch),

    reply: (
      { assignmentId, turns, reply }: { assignmentId: string; turns: Turn[]; reply: string },
      watch?: ConversationWatcher,
    ) => post('chat', { assignmentId, turns, reply }, watch),

    /** Writes an `asked` event and settles nothing: agreement is not execution. */
    finish: ({ assignmentId, turns }: { assignmentId: string; turns: Turn[] }) =>
      post('chat', { assignmentId, turns, finish: true }),
  }
}

export type PersuaderApi = ReturnType<typeof createPersuaderApi>
