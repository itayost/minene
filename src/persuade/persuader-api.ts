import { RulesApiError } from '../brain/rules-api'

/**
 * The persuasion engine, now same-origin.
 *
 * It used to be a separate deployment reached over CORS with a bearer token
 * attached by hand. Folding it in deleted all of that: these are route handlers
 * in this app, so the session cookie travels on its own and there is no origin
 * to allow.
 */
export type ConversationTurn = { speaker: 'persuader' | 'target'; text: string }
export type ConversationSnapshot = { rung: number; blocker: string; outcome: string }
export type ConversationResult = { turns: ConversationTurn[]; state: ConversationSnapshot }

const failed = (status: number) => (
  status === 401
    ? new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
    : new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')
)

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/persuade/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) throw failed(response.status)
  return await response.json() as T
}

export function createPersuaderApi() {
  return {
    openConversation: ({ assignmentId }: { assignmentId: string }) =>
      post<ConversationResult>('chat', { assignmentId, turns: [] }),

    reply: ({ assignmentId, turns, reply }: {
      assignmentId: string; turns: ConversationTurn[]; reply: string
    }) => post<ConversationResult>('chat', { assignmentId, turns, reply }),

    /**
     * `finish: true` is what makes the route write the `asked` event. It settles
     * nothing: agreement is not execution.
     */
    finish: ({ assignmentId, turns }: { assignmentId: string; turns: ConversationTurn[] }) =>
      post<{ outcome: string }>('chat', { assignmentId, turns, finish: true }),
  }
}

export type PersuaderApi = ReturnType<typeof createPersuaderApi>
