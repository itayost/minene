# Why the simulation cron stopped

Investigation for task 1 of the simulator-surface plan. The surface being built in
this branch shows zero because nothing new has landed in `public.simulations` in
three days. This note is the answer to why.

## What was checked

**Project link.** `.vercel/project.json` was already linked: project `minene`,
team `pro-team-01a11282`. No `vercel link` was needed.

**Is the cron registered on Vercel?** Yes.

```
$ vercel cron ls
1 cron job found for pro-team-01a11282/minene
Path                       Schedule
/api/persuade/worker       */10 * * * *
```

This is Vercel's own cron registry for the project, not just a file on disk — it
confirms the cron is live, not merely present in some branch's `vercel.json`.

**Does production actually carry that config?** Yes, confirmed two ways:

1. `vercel ls --prod` shows the newest Ready production deployment
   (`minene-92lbbxyck…`, aliased to `minene.vercel.app`, 4 days old) sitting ahead
   of everything else in the Production column.
2. `vercel inspect <that deployment> --json` includes the build's
   `config.vercelConfig`, and it is exactly the current `vercel.json`:
   ```json
   "crons": [{ "path": "/api/persuade/worker", "schedule": "*/10 * * * *" }]
   ```
   That's the config baked into the deployment actually serving `minene.vercel.app`
   right now, not an inference from git history.
3. As a cross-check, the commit that introduced the schedule (`67dd5cc`, "run the
   worker every ten minutes...") is an ancestor of `origin/main`
   (`git merge-base --is-ancestor` confirms it). Consistent with (1) and (2).

**Is `CRON_SECRET` set in production?** Present. `vercel env ls production` lists
it (created 24d ago, well before the cron schedule was even added). Per the task's
hard limits, only presence was recorded — the value was never printed or read.

## Conclusion

The cron is not the problem. It is registered with Vercel, the schedule
(`*/10 * * * *`) matches `vercel.json`, the deployment actually live at
`minene.vercel.app` was built with that exact config, and `CRON_SECRET` exists in
production so `authorized()` in `app/api/persuade/worker/route.ts` is not
unconditionally failing closed. There is nothing to fix in `vercel.json`, so step 5
of the task (apply a fix there) is skipped — nothing in this repo's Vercel wiring
is broken.

**The actual cause is outside this repo: model credits are exhausted.** 249 of 413
`simulation_jobs` rows failed with `AI_APICallError: You have no credits
remaining`. No change here — not to `vercel.json`, not to the worker route, not to
an environment variable — produces a single successful run until whichever model
provider account backing this project (its key is `OPENAI_API_KEY` in production)
has credits again. That is the user's action to take; this task does not attempt
to work around it, and no environment variable was set or changed as part of this
investigation.

## Why the queue stayed empty too (supplementary, from reading the source)

Not asked for by the task, but worth recording since it explains the second half
of the symptom (`simulation_feed.refilled_at` frozen since 2026-09-17 20:30, 0
pending rows in the queue) without needing a new hypothesis:

`tick()` in `src/persuade/lib/worker.ts` runs, in order: the daily cap check, then
a circuit breaker check (`breakerVerdict` in `src/persuade/lib/breaker.ts`), and
only *after* that does it call `refillFeed`. `DEFAULT_BREAKER` trips once at least
20 of the last finished jobs are known and over 80% of them are `failed` within a
trailing 60-minute window — exactly what a credits outage produces. When the
breaker is open, `tick()` returns immediately: no refill, no claim, no new job
attempts. That is consistent with the feed refill stopping at the same time
credits ran out, independent of whether the cron itself kept firing (it did).

The breaker is designed to self-probe once the newest sample it knows about is
more than 60 minutes stale, letting one batch through to test recovery. Whether it
is currently latched or idling on an empty queue was not checked against the
database — this section is a read of the code, not a live measurement, and isn't
needed to answer the task's question. It's left here so whoever restores credits
knows the queue may take up to one more failed probe cycle to clear before the
first real batch runs, rather than reading a slow recovery as a second bug.

## What this means for the rest of the plan

The screen this plan is building is correct to show zeros right now — that is the
true state of `public.simulations`. No cron fix, secret fix, or code change in this
repo will change that. Once credits are restored, the existing 10-minute schedule
is sufficient on its own; no redeploy or promotion is needed, since the config
already live in production is correct.
