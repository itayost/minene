import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * An in-memory stand-in for the two tables the store touches.
 *
 * It actually stores rows rather than recording calls, so a save/read round trip
 * is a real assertion about the mapping in both directions. A fake that only
 * recorded arguments would pass while `toRun` reassembled the wrong shape, which
 * is the half of this module most likely to be wrong.
 *
 * What it does NOT model is the database's own behaviour: constraints, RLS,
 * defaults, cascades. Those belong to migrations and are verified against a real
 * Postgres on that side, not here.
 */

export interface FakeRow {
  [key: string]: unknown;
}

export interface FakeDb {
  conversations: FakeRow[];
  conversation_turns: FakeRow[];
  assignments: FakeRow[];
  assignment_events: FakeRow[];
  /** Set to make the next write fail, so the error paths are reachable. */
  failNext: string | null;
}

export function createFakeSupabase(): { client: SupabaseClient; db: FakeDb } {
  const db: FakeDb = {
    conversations: [], conversation_turns: [], assignments: [], assignment_events: [], failNext: null,
  };

  const takeFailure = (): { error: { message: string } } | null => {
    if (!db.failNext) return null;
    const message = db.failNext;
    db.failNext = null;
    return { error: { message } };
  };

  // The join the store asks for: conversation_turns(...) nested under a
  // conversation. Insertion order stands in for the real query's ordering, which
  // is what the schema's conversation_turns_conversation_idx provides.
  const withTurns = (row: FakeRow): FakeRow => ({
    ...row,
    conversation_turns: db.conversation_turns
      .filter((t) => t.conversation_id === row.id)
      // conversation_id is dropped because the real query nests turns under the
      // conversation and never selects it.
      .map((t) => Object.fromEntries(Object.entries(t).filter(([key]) => key !== 'conversation_id'))),
  });

  const from = (table: string) => ({
    upsert: async (row: FakeRow) => {
      const failure = takeFailure();
      if (failure) return failure;
      const rows = db[table as keyof FakeDb] as FakeRow[];
      const index = rows.findIndex((r) => r.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return { error: null };
    },

    insert: async (rows: FakeRow | FakeRow[]) => {
      const failure = takeFailure();
      if (failure) return failure;
      (db[table as keyof FakeDb] as FakeRow[]).push(...(Array.isArray(rows) ? rows : [rows]));
      return { error: null };
    },

    // .update(...).eq(...).eq(...) -- the second eq is the status guard that
    // makes the write conditional, so it has to actually filter here or the
    // race the guard exists for would pass untested.
    update: (patch: FakeRow) => {
      const applyTo = (predicates: [string, unknown][]) => {
        const failure = takeFailure();
        if (failure) return failure;
        for (const row of db[table as keyof FakeDb] as FakeRow[]) {
          if (predicates.every(([column, value]) => row[column] === value)) Object.assign(row, patch);
        }
        return { error: null };
      };
      const chain = (predicates: [string, unknown][]) => ({
        eq: (column: string, value: unknown) => chain([...predicates, [column, value]]),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(applyTo(predicates)).then(resolve),
      });
      return chain([]);
    },

    delete: () => ({
      eq: async (column: string, value: unknown) => {
        const failure = takeFailure();
        if (failure) return failure;
        const key = table as keyof FakeDb;
        db[key] = (db[key] as FakeRow[]).filter((r) => r[column] !== value) as never;
        return { error: null };
      },
    }),

    select: () => ({
      eq: (column: string, value: unknown) => ({
        maybeSingle: async () => {
          const row = db.conversations.find((r) => r[column] === value);
          return { data: row ? withTurns(row) : null, error: null };
        },
      }),
      order: (column: string, options?: { ascending?: boolean }) => ({
        limit: async (n: number) => {
          const sorted = [...db.conversations].sort((a, b) => {
            const left = String(a[column] ?? '');
            const right = String(b[column] ?? '');
            return options?.ascending === false ? right.localeCompare(left) : left.localeCompare(right);
          });
          return { data: sorted.slice(0, n).map(withTurns), error: null };
        },
      }),
    }),
  });

  return { client: { from } as unknown as SupabaseClient, db };
}
