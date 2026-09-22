# The simulator, visible

The lab screen grown a level deeper, so that "how the persuader works and how
it grows" is answerable by looking at it.

The brief is five lines long and every line is a display requirement:

- Show the simulator live inside the product, actually working.
- See how it works and how it grows.
- Placement: inside the brain, inside the product.
- 700-1,000 persuasion simulations added per day, and a cumulative counter.
- Break down by industry, by role within industry, by every need of that role,
  and by the persuasions for each need. Filter on any of the three.

## Audience

One reader: the person tuning the engine. This is an instrument, not a
showcase. That decides the tie-breaks below. A coverage hole is the most
valuable thing the screen can show, so the design goes out of its way to make
holes visible rather than to make the numbers look large.

## Placement

`app/[brandId]/tools/persuade/lab` grows. No second screen.

Its own note already argues the case: "the matrix is the navigation, the rates
are the cell contents, and the bank is what a cell accumulates. Splitting those
into a simulator, a measurement screen and a matrix would have made three
surfaces that each show a third of the same fact, which is the mistake the
brain's five screens made." A `tools/brain/simulator` would be that fourth
surface. The brief's "inside the brain" is satisfied by a link from the brain,
and the lab is already owner-gated, which is the right gate for an instrument.

## Where things stand (2026-09-22)

Read from the live database, not inferred.

| Fact | Value |
|---|---|
| Simulations total | 168 |
| Added in the last 24h | 0 |
| Best single day | 95 (2026-09-17) |
| Industries with runs | 1 (retail) |
| Distinct plans ever run | 1 (`briefings`) |
| Jobs done / failed | 164 / 249 |
| Queue pending | 0 |
| Last feed refill | 2026-09-17 20:30 |
| `role_needs` rows | 130, across 5 industries and 26 roles |
| Generated plans | 130, plus `briefings` |
| Active personas | 56 |
| Resolved persona-plan pairs | 264, of which 260 are generated |

Three findings follow from that table, and the design is shaped by all three.

### Finding 1: the sweep has never run

Every one of the 168 runs used the hand-written `briefings` plan. The 130
generated plans have zero runs between them. The matrix the lab draws is
therefore one industry wide and is not a sample of the space the lab was built
to sweep.

Pairing is not the cause. `pairInputs` resolves 264 pairs against live content
with zero unpaired personas, 260 of them on generated plans. The inputs are
fine; nothing consumed them.

### Finding 2: it stopped on credits, not on code

All 249 failed jobs carry the same error: `AI_APICallError: You have no credits
remaining`. The feed walks pairs in sorted order, `briefings` sorts first, so
the budget was spent on the first pairs and the walk never reached a generated
one.

Since then nothing has refilled. Pending is 0, which is below the low-water mark
of 50, so a tick would refill; `refilled_at` has not moved since 2026-09-17,
so ticks are not happening. The cron is declared at every 10 minutes in
`vercel.json`. Why it is not firing is the one thing in this spec that is not
yet known, and Phase 0 exists to find out.

Restoring credits is the user's action and is outside this work.

### Finding 3: the `need` column does not hold a need

`src/persuade/lib/feed.ts:145` writes `need: cell.reason`. That is the world's
reason, the hidden fact about why the thing has not happened (`no_time`,
`forgot`, `disagrees`). The brief's need is `role_needs.need_key`, a fact about
the job (`chain-visibility`, `profitability`). Two vocabularies, one column, and
the six distinct values currently stored are all from the wrong one.

`simulations.job_role_id` is null on 164 of 168 rows, which is correct rather
than broken: the sweep is deliberately tenant free and `public.roles` is per
tenant, so a swept run has no tenant role to name.

What saves this is that `plan_key` already encodes all three axes, in the shape
`gen-{industry}-{roleSlug}-{needKey}`, and every simulation stores its plan with
`plan.id` set to the plan key. The run itself can therefore be placed on all
three axes without trusting either unreliable column.

## Design

### The spine is the taxonomy, not the runs

`matrixFrom` derives its industries from the runs, so an industry nobody has run
does not appear. That was right for a screen answering "what have we measured".
It is wrong for one answering "where has the sweep been", which is this brief's
question, and it directly contradicts two of its lines: every industry, and
every need of every role.

So the screen reads structure from `role_needs` and `persuasion_lab_plans`, then
joins runs onto it. Every industry, every role, every need renders whether or
not a run exists. A cell with no runs shows a run count of 0 and no rate at all;
`persuasionRate: null` already renders as "no fill", distinct from a measured
0%, and the existing legend already says so.

This is the same instinct `matrixFrom` already had one level up ("a role nobody
has run in a sector they HAVE is a real gap worth showing"), applied to the
whole structure instead of to one axis.

### Placing a run on the three axes

A lookup of `plan.id` against the taxonomy, not a read of the two columns.

```
cellIndex(roleNeeds): ReadonlyMap<string, Cell>
placeRun(index, run): Cell | null
```

An exact map lookup, never a string split. Role slugs and need keys may both
contain hyphens, so splitting `gen-retail-ceo-chain-visibility` on them is a
guess that would silently invent cells. Instead the `role_needs` catalogue is
turned into a map keyed by `planKeyFor`, the same formula `lab-generator.ts`
writes the keys with, and lookup is exact. A plan id in no entry, `briefings`
among them, returns null and is counted under an explicit "unplaced" bucket
rather than dropped. Runs disappearing quietly from a measurement screen is a failure
this repo has already had once.

### The feed writes the real need

`feed.ts` stops writing `cell.reason` into `need` and writes the plan's need key
instead. Nothing is lost: the reason is already on the same row inside
`world.reason`, which is where the rest of the code reads it from.

`planSweep` in `experiments.ts:264` carries the identical line and is fixed the
same way. Fixing one queueing path and not the other leaves the column holding
two meanings, which is the bug itself.

No backfill. The parser is the read-side source of truth either way, so a
migration would buy consistency in a column nothing would then depend on. The
168 existing rows place correctly through the parser without being rewritten.

### Four levels

1. **Industry.** All five, from `role_needs`.
2. **Role within industry.** All roles of that industry, from `role_needs`, not
   from `public.roles`. This replaces the per-tenant role catalogue currently
   supplying the matrix columns, which is what left 164 runs without a column.
   `RunControl` keeps reading `public.roles`: queueing a run by hand against a
   tenant role is a different act from placing a swept run on the grid, and the
   two vocabularies stay separate rather than merging.
3. **Need.** Every need of the selected role, with its `meta_need`, its run
   count and its measured persuasion rate.
4. **Persuasions for that need.** The split: what was handed over, and what
   won.

The fourth level lists the generated plan's arguments as the persuader received
them, each annotated with how often that argument's category carried an
agreement in this cell. An argument with no runs behind it says so. The gap
between what was written and what works is the point of the view.

**Attribution is by category and the screen says so.** `RunScore.winningArgument`
is free text the judge wrote; `RunScore.winningCategory` is a typed enum, and
every `Argument` carries a category. Matching a won sentence back to a specific
argument sentence is not reliable, so it is not claimed. Sentence-level
attribution would mean handing the judge the argument ids and changing the
scoring prompt, which makes new runs incomparable with old ones. Not worth it
at 168 runs; worth revisiting at scale.

`buildBank` already computes exactly the measured half of this, per set of runs.
It is reused unchanged, called with the runs of one need instead of one role.

### Live

A poll, not Realtime. Revised 2026-09-22, while mapping the files.

Realtime was the first choice and it costs more than it looked.
`public.simulations` is not in the `supabase_realtime` publication, nothing in
this codebase uses Realtime at all, and adding the table to the publication is a
migration in eran-task. That is a second repo and a new runtime dependency,
bought for a difference nobody on this screen can perceive: the worker ticks
every ten minutes and its runs land in a burst, so a poll every fifteen seconds
catches a burst within seconds of it starting.

So: a counts query and a newest-runs query on an interval while the tab is
visible, paused when it is hidden. Both are cheap and neither pages the table.
The behaviour the brief asks for, runs appearing as they land, is unchanged.
Only the transport is.

A failed poll is not fatal. The screen keeps the last good numbers, says the
feed is stale and when it last succeeded, and offers a manual refresh. An
instrument that silently stops updating is worse than one that admits it.

Realtime stays available if this ever needs to be sub-second. It does not today.

### The screen must not page the whole table to draw itself

`listSimulations` reads every row with every column, `turns` included. That is
correct for 168 rows and fatal at the scale this screen exists to display: at
the 1,000 a day the cap allows, one month is 30,000 rows each carrying a whole
conversation as jsonb, and the screen would be pulling hundreds of megabytes to
compute a percentage.

Nothing on this screen needs `turns`. `buildBank` reads `score`, `blockersIn`
reads `state.blockers`, the rate reads `state.outcome`. So the store gains
`listSimulationSummaries()`, selecting every column except `turns`, and the
screen uses it. `listSimulations` stays as it is for anything that genuinely
needs the conversations, and a single run's transcript is fetched by id if one
is ever opened.

This is a change to code the work already touches, made because the work makes
the flaw load-bearing. It is not an unrelated refactor.

### Counters

Two, both measured, plus one cap:

- Cumulative total.
- Added today.
- The daily cap, `PERSUADER_DAILY_RUN_CAP`, shown as capacity.

Both counters come from `count: 'exact', head: true` queries, so the headline
numbers never depend on paging the table and stay correct however large it
gets.

The brief's "700-1,000 a day" is the cap, not an achievement, and is labelled as
capacity. Today the counter reads "0 של 1,000 היום", which is the correct thing
for it to say and the reason the credits matter.

This follows the product's own rule that measured overwrites invented. No
projection, no run rate, no "on track for".

### Filters

Industry, role, need. They filter one dataset so they compose, and they are the
same selection the drill-down makes, not a parallel mechanism.

Filter and drill-down are one state, not two mechanisms that have to be kept in
agreement: selecting a cell sets the filter, and setting a filter moves the
selection. State lives in the URL query so a view of one cell is a link.
Clearing a filter clears the levels below it.

## Plan

**Phase 0: why the cron stopped.** Confirm whether the cron is firing at all
(`CRON_SECRET` present in the deployed environment, whether production has a
deployment carrying the current `vercel.json`, whether the branch holding the
cron ever reached production). Fix what is found. Credits are the user's to
restore; nothing here will produce a run until they are.

**Phase 1: the feed writes the real need.** One change in `feed.ts`, with a test
that a queued job's `need` is the plan's need key and that `world.reason` still
carries the reason.

**Phase 2: the spine and the parser.** `role_needs` and `persuasion_lab_plans`
read as structure; `placeRun` over `plan.id`; `matrixFrom` rebuilt on the
taxonomy with an explicit unplaced bucket.

**Phase 3: the screen.** Four levels, counters, filters, Realtime feed.

## Testing

- `placeRun`: every generated plan id in the catalogue places correctly; a slug
  containing a hyphen is not mis-split; `briefings` returns null rather than
  inventing a cell; an unknown id lands in the unplaced bucket.
- The spine renders an industry, a role and a need with zero runs, and a zero-run
  cell reads as 0 runs rather than 0%.
- No run is dropped: placed plus unplaced equals total, asserted on a fixture.
- `feed.ts` writes the need key, and the reason survives in `world.reason`.
- The bank annotation shows a zero-win argument as zero rather than omitting it.
- Realtime failure falls back to the load-time read and says so.
- Tenant boundary: the new reads touch `role_needs`, `persuasion_lab_plans` and
  `simulations`, none of them tenant scoped. `tests/persuade/tenant-boundary.test.ts`
  is extended to cover the new modules.

## Out of scope

- Restoring model credits.
- Sentence-level win attribution, and the scoring prompt change it needs.
- Backfilling `simulations.need`.
- Any surface in `eran-presueder`, which remains the older copy.
- A customer-facing or prospect-facing version of this screen. The audience is
  one person tuning the engine, and a showcase would have different obligations.

## Risks

- **The screen ships against 168 runs in one industry.** Correct, and it will
  look empty, because it is. The alternative is a screen that looks fuller than
  the data, which this product's principles forbid.
- **Phase 0 may not be fixable from here.** If the cron stopped for a reason that
  lives in the Vercel project rather than the repo, the finding is a report and
  an action for the user, not a commit.
- **Reading roles from `role_needs` changes the matrix columns.** Runs that do
  carry a `job_role_id`, four of them, no longer have a per-tenant column to sit
  in. They place through their plan id like everything else, or land unplaced.
