# משכנע (sub-project 4)

The persuader becomes a full surface inside minene: a manager's real conversation
with a real person, and a lab where the same engine argues with itself so the
business learns which arguments actually move which role.

minene stays the host. The persuasion tab is large, and the matrix and bank it
produces sit above the tenant boundary — which is the one genuinely new thing
here, and the reason this spec spends most of its length on a data boundary
rather than on screens.

## What is already built, corrected

An earlier reading of this said scoring and rates were "written and never
merged". That was wrong, and the error is worth recording because it changes the
size of the work.

`lab/measurement` is an **ancestor** of `eran-presueder`'s `main`, not a fork of
it. The measurement layer was written, merged, and then deliberately removed by
`f6f2b1d`:

> Scoring, execution follow-up, batches, rates and variant comparison move to the
> lab/measurement branch so the core can be judged on its own first.

So `git merge lab/measurement` does nothing, and restoring those files is a port
rather than a cherry-pick: since the strip, rules became a per-request
`RuleConfig`, variants were removed, and `Run` lost its score and follow-up
fields. eran-presueder's README already documents the exact recovery command and
says this in as many words.

| task | state |
|---|---|
| **1. מנגנון השכנוע** | **Built** on `main`: `prepare`, `turn`, `rules`, `ammunition`. 18 blockers, 5 escalation rungs, 11 argument categories, grounded in the brain's approved rules. Unreachable from minene. |
| **2. סימולטור** | Machine-vs-machine **built** (`runSimulation`, streams an event per turn). `batch.ts` needs porting. The **bank does not exist**. |
| **3. קרב ומדידת הסכמה** | `score.ts` and `rates.ts` need porting. Their model is right and worth preserving: Persuasion Rate and Execution Rate keep **different denominators on purpose** — out of 100 conversations how many agreed, and out of 100 who agreed how many did it. Never merged into one number. |
| **4. מטריצה** | **New.** Four personas exist; no industry axis, no role axis. |

**AL/RL is measurement, not learning.** No reinforcement loop, no automatic
tuning of argument selection. Two rates, cut by argument and by cell.

## The tenant boundary, which is the hard part

Everything in the brain is tenant-scoped: `tenant_id` on every row,
`current_tenant_id()` in every policy, one brand equals one tenant. A matrix that
compares אופנה against מזון reads across that boundary by definition.

The resolution is not a wider policy. It is that **two different things were
being called one thing**:

| | real conversation | simulation |
|---|---|---|
| who is on the other side | a person | a synthetic persona |
| what it is about | an assignment, a specific person | an invented scenario |
| where the plan comes from | the tenant's approved rules, via `persuasion_ammunition` | a library plan |
| contains tenant knowledge | **yes** | **no** |
| table | `conversations` (exists, tenant-scoped) | `simulations` (new, cross-tenant) |
| enters the bank | never | yes |

This was verified rather than assumed: `src/engine/simulation.ts` and
`/api/simulate` reference neither `ammunition` nor `tenantId` nor `assignmentId`.
A simulation genuinely does not touch a tenant's knowledge today, and the design
depends on it continuing not to.

**So the bank is safe to share because it is built only from invented
conversations.** If a simulation is ever seeded from a tenant's real ammunition,
that guarantee breaks and the bank starts carrying one business's private rules
into another's matrix. That is the single invariant this whole design rests on,
and it needs a test rather than a comment.

## The screens

### `/tools/persuade` — every member

The manager's surface: what has been asked of *them*, not a menu of tools.

Each row is an open assignment. The ask is a rule that passed the brain's review
gate, so it is already "photographable" — you could film whether it happened —
which is what the engine refuses to open a conversation without.

**Agreement and execution are separate states on the row**, because they are
separate facts. A finished conversation writes an `asked` event and settles
nothing; only an execution report closes an assignment, and a `partial` settles
as `not_done` so the measurement cannot drift upward one generous rounding at a
time.

### The conversation — a sheet over that list

It happens mid-shift, on a phone. It uses the `BottomSheet` primitive built for
the brain, so it inherits Escape, focus-in and focus-restore.

The current rung and the detected blocker are shown, not hidden: "אין לי זמן" is
`overloaded`, and that is what selects the next argument. One rung at a time,
enforced in code rather than asked of the model.

### `/tools/persuade/lab` — owner only

One screen, not three. **The matrix is the navigation, the rates are the cell
contents, and the bank is what a cell accumulates.**

A cell is (ענף × תפקיד). Selecting one opens its bank: the arguments that
actually won there, ranked, with the blockers most often encountered and most
often broken. From there you run another simulation, which streams turn by turn.

Roles come from `roles`, already built for the brain. Industry is new.

**A cell with no runs is not 0%.** It gets no fill at all, plus a hatch as
secondary encoding so the distinction survives greyscale and colour blindness —
the same null-is-not-zero rule `like_pct` already follows.

The heat ramp is one hue, light to dark, from the brand rose: persuasion rate is
a magnitude, so the scale is sequential, never diverging and never a rainbow.
Label colour per step is computed, not chosen — `#B76578`, the brand primary,
reaches only **4.08:1** against white and fails at body size, so the fourth step
is `#A35468` at 5.22:1.

## Folding eran-presueder in

Both apps are Next 16.3.1, React 19.2.8, same pnpm, same supabase-js major.
eran-presueder has no middleware and an empty `next.config.ts`. This is a module
move, not a port between frameworks — the comment in `persuaderApi.js` claiming
otherwise was written when the host was still Vite.

What the merge deletes: `lib/cors.ts` and `ALLOWED_ORIGINS`, the whole
`persuaderApi` HTTP layer, the manual bearer attach on every call, and
`PERSUADER_ALLOW_ANONYMOUS` as a security control.

What it costs:

- **minene gains its first server secret.** Today its `.env.example` is two
  `NEXT_PUBLIC_*` values. `OPENAI_API_KEY` is a different class of thing.
- **minene's middleware matcher would swallow `/api/*`**, redirecting an
  unauthenticated API call to `/login` with a 307 instead of returning 401. The
  routes already verify their own caller, so the fix is to exclude `api` from the
  matcher rather than to add a second check.
- The persuader's drafting lab is Tailwind while minene is hand-written CSS. That
  UI is Eran's tuning surface, not the shop floor, and can be ported separately or
  left behind.

## Verification

**The invariant first.** A test that fails if a simulation's plan can be
constructed from tenant ammunition. Everything else in the bank design is
downstream of that staying true.

**The rate arithmetic.** Persuasion Rate and Execution Rate over the same run set
with different denominators, including the case where nobody agreed — where the
execution denominator is zero and the answer is "no data", not 0%.

**The matrix.** That an empty cell renders unfilled rather than as zero, and that
the ramp is read from tokens rather than hardcoded, guarded the same way
`brain.css` is.

**A browser pass**, because jsdom has no layout and the matrix is the one surface
here whose whole job is visual comparison.

## Out of scope

- **Any learning loop.** Settled explicitly: this is measurement. No reward
  signal, no automatic tuning of argument selection.
- **WhatsApp.** `conversations.channel` has the column and nothing writes it.
- **Batch runs at first.** Every run is several model calls; forty runs a cell
  across nine cells is a real bill. Single on-demand runs first, batching once a
  cell's cost is known.

## Risks

- **The industry axis has one value today.** Minene is one business in one
  sector, so the matrix will be a single row until there is a second tenant. It
  should be built so that row is honest rather than looking broken.
- **The bank's usefulness depends on run volume**, and run volume costs money.
  A cell with four runs behind it should not present like a cell with forty; the
  denominator travels with the rate for exactly this reason.
- **The port from `lab/measurement` is against a moved API.** `50de4c2 fix: a
  counter-offer is not an agreement` landed after the strip and changed outcome
  detection — restoring `score.ts` naively could undo it.
