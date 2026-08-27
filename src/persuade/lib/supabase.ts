import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The knowledge base and the conversation store both live in eran-task's Supabase
 * project. This is the only place that knows how to reach it.
 */

/**
 * The SECRET key, not the publishable one, and this module is imported only from
 * API routes -- never from a component.
 *
 * That is not a shortcut around RLS, it is what the schema on the other side
 * expects: `public.conversations`, `public.conversation_turns` and
 * `public.assignments` grant writes to `service_role` alone, because the engine is
 * the thing that decides whether a reply was a real commitment. A publishable key
 * would be refused on every insert.
 *
 * The cost is that RLS is not enforcing tenancy here. `persuasion_ammunition`
 * returns `tenantId` in its payload precisely so this side can check it, and
 * `loadAmmunition` below does.
 */
const URL_VAR = 'SUPABASE_URL';
const KEY_VAR = 'SUPABASE_SECRET_KEY';

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      `שכבת האחסון לא מוגדרת. צריך ${URL_VAR} ו-${KEY_VAR} בסביבה כדי לשמור שיחות ולקרוא ידע ארגוני.`,
    );
    this.name = 'StorageNotConfiguredError';
  }
}

let cached: SupabaseClient | null = null;

/** True when the store can actually be reached. Callers that must degrade rather than fail check this. */
export function isStorageConfigured(): boolean {
  return Boolean(process.env[URL_VAR] && process.env[KEY_VAR]);
}

export function supabase(): SupabaseClient {
  if (!isStorageConfigured()) throw new StorageNotConfiguredError();
  // Cached, because a Next.js route module is re-entered per request and a new
  // client per request means a new connection pool per request.
  //
  // Read from process.env at call time rather than at module scope: a module-scope
  // read is evaluated at import, which in a test run happens before any test can
  // set the variables.
  cached ??= createClient(process.env[URL_VAR]!, process.env[KEY_VAR]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test seam. The cached client outlives a single test otherwise. */
export function resetSupabaseClient(): void {
  cached = null;
}
