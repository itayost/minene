import { createBrowserSupabase } from '../auth/supabase-browser'
import { RulesApiError } from '../brain/rules-api'
import type { ConversationState, Turn } from './engine/types'

/**
 * The persuasion engine, now same-origin.
 *
 * The types here are the engine's own, imported rather than restated. An
 * earlier version of this file declared its own `{ speaker, text }` turn and a
 * singular `blocker`, neither of which the routes ever return -- and because
 * the component's tests mocked that invented shape, they passed while the real
 * screen rendered nothing. Importing the types is what makes that class of
 * mistake a compile error instead of a silent blank.
 */
export type ConversationResult = { turns: Turn[]; state: ConversationState }

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) => new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

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

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/persuade/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await authorization() },
    body: JSON.stringify(body),
  })

  if (response.status === 401) throw unauthorized()
  if (!response.ok) throw failed(response.status)
  return await response.json() as T
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
    openConversation: ({ assignmentId }: { assignmentId: string }) =>
      post<ConversationResult>('chat', { assignmentId, turns: [] }),

    reply: ({ assignmentId, turns, reply }: {
      assignmentId: string; turns: Turn[]; reply: string
    }) => post<ConversationResult>('chat', { assignmentId, turns, reply }),

    /** Writes an `asked` event and settles nothing: agreement is not execution. */
    finish: ({ assignmentId, turns }: { assignmentId: string; turns: Turn[] }) =>
      post<ConversationResult>('chat', { assignmentId, turns, finish: true }),
  }
}

export type PersuaderApi = ReturnType<typeof createPersuaderApi>
