# Training the bot for the response law

The product spec (`Brain_Persuader_Developer_Spec_HE.md`, sections 9 and 11) states a
rule the engine has never met: a topic that matters demands a response. You may
disagree; you may not disappear. Its ladder for silence is a reminder, then a
personal approach, then escalation to a manager.

Today every simulated counterpart always answers. Silence does not exist in the
lab, so the bot has never been trained against it, never been measured on it,
and the rungs it does have only ever climb in response to an objection.

This spec covers the training side only: what the lab can simulate, what the
engine does about it, and how a run is judged. Sending reminders, timing
policies, real escalation to a manager and per-person history are product work
in eran-task and are **out of scope**.

## Where things stand (2026-09-18)

- `targetReply` is called on every turn and always returns text. There is no
  representation of "no answer".
- `fatigueScore` reads short and non-committal replies. A missing reply cannot
  reach it.
- `detectOutcome` returns `agreed` on any commitment marker, so "כן כן, מחר"
  ends the conversation as a success.
- `Outcome` is `open | agreed | refused | escalate_to_manager | stopped_fatigue |
  deferred`, and both `public.conversations.outcome` and
  `public.simulations.outcome` carry that list as a check constraint.
- `worldCells()` enumerates 324 cells over 5 axes. The lab has 56 personas and
  131 plans across 5 industries, feeding a loop capped at 200 runs a day.
- `RunScore` is stored as jsonb on `simulations.score`, so adding a field to it
  needs no migration.

## 1. Silence as a world axis

New axis `responsiveness`:

| value | behaviour |
|---|---|
| `answers` | replies every turn, exactly as today |
| `slow` | ignores the first persuader message, then replies normally |
| `silent` | never replies |

`worldCells()` becomes 3 x 3 x 6 x 3 x 2 x 3 = 972 cells. The enumeration stays
exhaustive, so coverage remains a fact rather than a hope.

`describeWorld` gains a line for the axis, and it is given to the simulated
counterpart only, like every other world field. The persuader is never told
which world it is in; it only ever observes that no answer arrived.

Cost: a silent turn calls no model at all, so silent cells are cheaper than
answering ones.

**Backward compatibility is load-bearing here.** `isWorldState` rejects a world
whose fields it does not recognise, and the worker fails a job whose world is
invalid. Around 136 jobs are queued right now with worlds written before this
axis existed, and every stored simulation carries one too. So `responsiveness`
is optional on `WorldState`: absent means `answers`, read through one helper
(`responsivenessOf`), and `isWorldState` accepts a world without it. A world
written from now on always carries it.

## 2. Silence is recorded, never invented

`Turn` gains `silent?: true`, and a silent turn carries `text: ''`.

Not a string like "(לא ענה)": a transcript is replayed into the model's prompt
and exported as training data, and a sentence the person never said would be
taught as something they did say. `historyForModel` renders a silent turn as an
explicit "no reply" marker rather than as a message.

## 3. The ladder answers silence

New rule config, defaulted so today's behaviour is unchanged when no silence
occurs:

| field | default | meaning |
|---|---|---|
| `maxSilences` | 3 | unanswered messages before the conversation ends |
| `enforceSilenceLadder` | true | an unanswered message climbs one rung |

- **Silence is not fatigue.** `fatigueScore` ignores silent turns. A tired reply
  and no reply are different failures, and treating one as the other would end
  conversations that should escalate.
- **A silence advances the ladder through `silences`.** `ConversationState`
  carries a `silences` count, 0 at the start of every run, and `applySilence`
  increments it before computing the rung: a silence is a reason to escalate
  exactly like a live interaction is, so `nextRung`'s target is
  `interaction + silences + 1`, not `interaction + 1` alone. **Each unanswered
  message climbs exactly one rung**, so the three persuader messages of a
  silent run carry rungs 1, 2, 3 -- the spec's ladder: reminder, personal
  approach, manager. The existing one-rung-at-a-time rule still holds.
- **After `maxSilences` unanswered messages** the run ends with the new outcome
  `no_response`.
- The interaction budget still applies: a silent run cannot outlive
  `maxInteractions`.

New `Outcome` value `no_response`, which needs one eran-task migration widening
the check on `conversations.outcome` and `simulations.outcome`. It is a distinct
outcome rather than a flavour of `deferred` because the two ask different
questions of the bot: a deferral was answered and dodged, a non-response was
never answered at all, and the matrix must be able to separate them.

## 4. "Yes, yes, tomorrow" is not a yes

`detectOutcome` gains a vague-deferral check: a commitment marker with a vague
time marker and no concrete start becomes `deferred`, not `agreed`.

New `VAGUE_COMMITMENT_MARKERS` in `knowledge.ts`: `כן כן`, `מחר`, `אשתדל`,
`בקרוב`, `נראה מה יהיה`, `אחר כך`, `בהמשך`, `נסתדר`.

This is the failure the product spec names directly ("כן, כן, מחר" → move to a
time and follow-up). The engine's own rule already says agreement is not
execution; this closes the gap on the same side of the conversation.

## 5. Every run is judged on response validity

`RunScore` gains `responseValidity`:

| value | meaning |
|---|---|
| `did` | committed to the action, with a time |
| `refused_with_reason` | said no and said why |
| `stuck_with_plan` | said what blocks them and proposed a time or an alternative |
| `none` | no valid response: silence, or a yes with nothing behind it |

The first three are valid responses under the product spec's rule; only `none`
is a failure of the response law. The judge is told that definition explicitly,
because "refused" and "failed" are the same thing to a model asked to grade a
persuasion attempt, and they are not the same thing here.

Stored inside the existing `score` jsonb. No migration.

## 6. What this enables later

Response-validity rate per cell is the training-side counterpart of the product's
Response Level. It belongs in the technique-weights review (section 3 of the
simulation spec) as a second number beside the win rate, and is not built here.

## Out of scope

- Sending anything: reminders, nudges, WhatsApp, in-app notifications.
- Timing policies (after how many hours a reminder goes out).
- Real escalation to a real manager.
- Per-person learning and history.
- Changing the live chat route's behaviour for real conversations: a real
  person's silence is the absence of an HTTP request, which this engine never
  sees. `applyTargetReply` keeps its current behaviour for real replies.

## Tests

- 972 cells, all distinct; `responsiveness` reaches the counterpart's prompt and
  never the persuader's (extend `world-isolation.test.ts`).
- A world with no `responsiveness` is still valid and behaves as `answers`, so
  the jobs queued before this change still run.
- A silent turn has empty text, carries the flag, and renders as a no-reply
  marker in the model history and in the transcript the judge sees.
- Fatigue ignores silent turns.
- Each unanswered message climbs one rung, one at a time.
- Three unanswered messages end the run as `no_response`; two do not.
- A `slow` world answers from the second message and the run proceeds normally.
- A commitment with a vague time is `deferred`; a commitment with a concrete
  start is `agreed`; a bare refusal is still `refused`.
- The judge's schema accepts the four `responseValidity` values and the field
  round-trips through the store.
- A run with no silence behaves exactly as before (regression over existing
  simulation tests).
