# מוח ארגוני redesign (sub-project 6)

The eight "completing the brain" tasks landed in minene on 2026-08-27 across
five surfaces. They work and they are tested. They also read as a different
application from the cockpit they sit inside, and the busiest of them is tiring
to use. This redesigns all five: palette, information architecture, component
behaviour.

Nothing in the data layer changes. `rules-api`, `roles-api`, `people-api` and
`documents-api` are untouched, as is the database. This is presentation.

## What is actually wrong

Three separate problems, discovered by opening the pages rather than by reading
them.

### 1. The brain paints with colours that are not the brand's

`src/brands/minene.ts` sets the shell's custom properties to a warm,
low-saturation palette:

| token | value | |
|---|---|---|
| `--primary` | `#B76578` | dusty rose |
| `--primary-strong` | `#8F4859` | deep rose-brown |
| `--text` | `#3F3532` | warm near-black |
| `--muted` | `#887C77` | warm grey-brown |
| `--background` | `#EEEAE7` | warm sand |
| `--surface` | `#FFFCF8` | warm cream |
| `--border` | `#DED5CD` | warm beige |

`DESIGN.md` documents a different palette entirely — hot pink `#E8368F`, navy
`#1D2645`, cool greys `#E9E9EE` and `#E7E3E9`. Every `var(--primary, #e8368f)`
fallback in `src/styles.css` comes from that older set. The fallbacks never fire
inside the shell, so the disagreement is invisible until someone reads the two
files side by side.

The brain surfaces then introduced a third palette, belonging to neither:
`#f6f7fb`, `#8b8592`, `#1f8a5f`, `#e4f5ed`, `#fde9f2`, `#a4761f`, `#f4f7fb`,
`#f8f6fc`, `#f9f9fc`. All cool-toned, inside a warm shell. This is not a matter
of taste: the book's rows are literally blue-grey on cream while the cockpit
home two taps away is sand and clay.

**Decision: the live theme is the truth.** `DESIGN.md` is corrected to match it,
the stale fallbacks are corrected with it, and every off-brand hex is removed.

### 2. Five surfaces, four card treatments, no shared component

The hub uses illustrated pastel tiles. The lobby uses flat pink boxes. The book
uses cool grey-blue boxes. The admin history uses another. Three of those four
were introduced in the same week by the same author, which is how a tool ends up
with four visual languages inside one bottom-nav tab.

### 3. No hierarchy, and a queue that punishes use

Every row in every list carries the same visual weight. In the approval lobby —
32 pending rules at the time of writing — אישור, עריכה and דחייה are three
identical outlined buttons on every card. The single most consequential action in
the tool looks exactly like the one that discards work.

Related: the hub at `/tools/brain` exists only to route to four places, while the
bottom nav already has a מוח ארגני tab. Every task costs two taps before it
begins, and the hub's largest element is a placeholder list of marketing copy
from the brand manifest.

## Approach

Three approaches were considered: split by audience (two screens), split by verb
(three screens), or one progressive screen. Split by verb was chosen.

Split by audience puts ingest, review, history, KPIs, roles and people on one
owner screen — today's admin problem with two more jobs bolted on. One
progressive screen means a very long scroll on a 402px shell, with the review
queue buried under a reading list and no way to link to a task.

**Three screens, one job each. The hub is deleted; `/tools/brain` becomes the
first real screen.**

| route | job | who |
|---|---|---|
| `/tools/brain` | **לקרוא** — read, filter, rate, contribute | every member |
| `/tools/brain/ingest` | **להזין** — three sources, and the approval queue beneath them | owner |
| `/tools/brain/measure` | **למדוד** — KPIs, rule history, settings | owner |

The middle row is the reason for this split. Extraction and the approval lobby
are two halves of one pipeline that currently live on separate screens: an owner
uploads a PDF, is told "6 חוקים חדשים ממתינים בלובי", and must navigate elsewhere
to act on them. Together, the six appear in the queue directly below the form.

`measure` keeps its own screen. Its history list does overlap the book's — the
same rules with owner chrome, all statuses, the star and the search — and that
overlap is accepted rather than resolved, because folding it into `ingest`
recreates the six-jobs-on-one-screen shape that split-by-audience was rejected
for.

## The foundation

### Tokens

Two are added to the brand theme; eleven raw hex values are deleted.

| new token | value | job |
|---|---|---|
| `--surface-sunken` | `#F7F2EC` | the fill for every row on every brain screen |
| `--positive` | `#0F6F66` | עשה, a proven process, a high rating |

Both are brand theme tokens, not stylesheet constants, so adding them touches
four places: `BrandTheme` in `src/core/brand-types.ts`, the style object in
`src/components/BrandShell.tsx`, `src/brands/minene.ts`, and the `demo-brand`
test fixture. `src/core/validate-brand.ts` enumerates required theme tokens and
`pnpm build` runs it, so a brand missing either fails the build rather than
falling through to a hardcoded colour — which is the failure mode this whole
redesign exists to correct.

Negative reuses `--primary-strong`. Neutral reuses `--muted`. The whole semantic
set is two colours, both already the brand's.

Contrast was measured against the row fill rather than judged by eye:

- `#0F6F66` on `#F7F2EC` — **5.41:1**
- `#8F4859` on `#F7F2EC` — **5.83:1**

Both clear WCAG AA for body text. The obvious first choice, `#12897e` lifted
straight from the cockpit's action palette, reaches only **3.85:1** and fails at
label size — which is why the darker variant exists.

### Colour is never decoration here

Every row is `--surface-sunken`. A row is coloured only when the colour means
something: a do, a don't, a rating band, a pending state. This is the opposite of
the current state, where a pink fill is applied to everything and therefore says
nothing, and it is what stops the brain competing with the cockpit home, where
colour legitimately encodes which subject a card is.

### One card

A single component replaces the four card treatments. Radius `14px`
(`rounded.tool-card`), one padding scale, one fill, and head / body / meta slots.
A row in the book, the queue, the history and the documents list is the same
object with different content.

### Hierarchy, as rules

- Exactly one filled action per row. In the queue that is אישור; עריכה and דחייה
  become quiet.
- The rule text is the loudest thing in its row: `title`, 15px/800.
- Metadata drops to `label` size in `--muted`.
- Numbers and scores are tabular and share a baseline, so a column scans.

## The three screens

### `/tools/brain` — לקרוא

The bottom nav lands here, so it is the tool's front door.

**Four views as a 2×2 grid of chips, not a scrolling strip.** Four Hebrew labels
never fit on one line at 402px. The trailing-edge fade added in `d3db8a6` is a
patch over that and still leaves the fourth view something a reader must
discover. Two rows of two are all visible. They are peers and should look like
peers.

**The row** carries a quiet head line (number · topic · sub-topic), the rule text
as the loudest element, an indented response for a case, and the source link when
one exists. The vote control loses its borders until interacted with and moves
next to the score, so "how it is rated" and "rate it" become one object rather
than two. Fifty rows of two bordered 44px boxes is a wall of buttons competing
with the text being rated.

**Owner crossing.** The deleted hub must leave one affordance behind: two quiet
text links in the header, להזין and למדוד, owner only. Not tiles. The floor sees
this screen far more often than an owner does, and two more pastel cards at the
top would tax the majority to serve the minority.

### `/tools/brain/ingest` — להזין

**Three sources, one control:** קובץ PDF · שיחה · חיפוש ברשת, with a single topic
picker beneath. Today the first two are a segmented pair and the hunt is a
separate section carrying a duplicate topic picker.

The asymmetry is accepted and documented: the hunt creates no document, so on
that mode the documents list at the foot stays empty. The queue is where its
result appears.

**The approval queue sits directly beneath the form**, and is the point of this
screen.

**One filled action per queue card.** אישור filled, עריכה and דחייה quiet.

**The documents list collapses** to the foot, opened when the question is "what
happened to my upload".

### `/tools/brain/measure` — למדוד

KPIs, then the rule history with its search and filters, then roles and people
reached from the foot.

## Component behaviour

### There is no bottom sheet, and there needs to be one

`.action-sheet-layer` is CSS with exactly one consumer, `RuleEditSheet`, and that
component has no Escape handler, no focus move on open, and no focus restore on
close. It looks like a sheet and behaves like a div; a keyboard user who closes
it is dropped at the top of the document.

eran-task's `useSheetDismiss` solves this in 55 lines, and its comments record a
bug already paid for once: `onDismiss` in the effect's dependency list tore the
effect down on every render and re-fired the initial focus, so a character typed
into a second field landed in the first. It was invisible while every sheet held
one field. **minene's edit sheet grew a second textarea in `aae3fd9`**, so it
sits one feature away from that same bug class without the fix that prevents it.

**A `BottomSheet` primitive is the first piece of work.** Backdrop dismiss,
Escape, focus in on open, focus restored to the trigger on close, and
`openKey`-based identity so swapping subject re-focuses rather than silently
keeping the previous subject's focus state. Ported from `useSheetDismiss` with
its fix intact, not re-derived.

### A task opens over the list; a list is never pushed down by a form

| today | becomes |
|---|---|
| הוספת ידע — a dashed bar above the book that expands to six inline fields | sheet |
| עריכת חוק — a sheet with no dismissal behaviour | the primitive |
| ניהול תפקידים / ניהול אנשים — inline `<details>` | sheets |
| חיפוש וסינון — a collapsing panel above the history | sheet |
| the vote control, the view chips | stay inline — interactions, not tasks |

### חילוץ חוקים

- The native `<input type="file">` goes behind a styled Hebrew label. The browser
  renders its own control for a bare file input, which is why the current screen
  shows **"Choose File / No file chosen" in English** in the middle of a Hebrew
  RTL page. The replacement shows the chosen file's name and size, and says
  "לא נבחר קובץ".
- A drop target, since this surface is used on a desktop as often as a phone.
- Honest waiting. A 20MB upload is currently the sentence "מעלה את הקובץ…" and
  an unknown wait. It stays a sentence: `supabase-js`'s storage `upload()`
  exposes no progress events, so a determinate bar here would be an animation
  pretending to be a measurement. The fix is to name what is being waited for and
  how big it is — "מעלה נהלי פתיחה.pdf, ‎4.2MB" — not to draw a bar.

## Routing and migration

`/lobby`, `/extract` and `/admin` are on `main` and therefore in production, so
they may be bookmarked. Each keeps a one-line redirect to its new home. `/book`
is unmerged and simply moves.

## Stylesheet

`src/styles.css` is 3172 lines, against the project's own 800-line ceiling, and
roughly 600 of those are brain CSS. No brain class — `upload-page`, `admin-row`,
`approval-lobby`, `knowledge-row` — is referenced anywhere outside the brain, so
it extracts cleanly to `src/brain/brain.css`. The rest of the stylesheet is not
reorganised; this only stops adding to it.

## What does not change

- The bottom nav, the brand shell, and the manifest label `מוח ארגני` (still
  missing its vav, still deliberately unfixed).
- The 15 frozen Playwright references. None covers a route this touches — they
  are `subject-menu`, `page-viewer` and `/minene/tools/persuade`.
- Every API module, every RPC, every migration.

## Verification

jsdom has no layout. The suite could not have caught the fourth-tab overflow
found on 2026-08-27 and cannot catch its successors. The frozen visual set covers
none of these routes and cannot be regenerated. So verification splits three
ways.

**Tests assert** route existence and role gating, that four view chips render,
that the queue's approve is the only filled action, that a case shows its
response and an unclassified rule never does, and — newly possible, because focus
is not layout — the full dismissal behaviour of the sheet primitive.

**A stylesheet guard.** A test reads `src/brain/brain.css` and fails on any hex
outside the approved set. This is precisely the class of defect that prompted the
redesign: eleven off-brand colours that nobody noticed for a week because the
fallbacks never fire inside the shell.

**A browser pass** at 320, 402 and 768 with screenshots, because it is the only
instrument here that sees layout, and it is how the one real bug so far was
found.

## Out of scope

- **Batch approval.** With 32 pending rules, one-at-a-time is 32 taps, and
  "approve every rule in this topic" would fix it. It is new capability, and it
  deliberately weakens the review gate. Recorded, not built.
- Anything touching the cockpit, the content viewer, or the shell.
- `משכנע` and the persuader merge, which remain sub-projects 4 and 5.

## Risks

- **The book's row is the highest-traffic surface in the tool and the one with
  least test cover for layout.** A browser pass at three widths is the only
  guard.
- **Redirects are easy to forget to remove.** They are documented here as
  temporary; nothing in code will remind anyone.
- **`measure`'s overlap with the book is unresolved by choice.** If the search
  and the star go unused, that screen collapses to a KPI strip and a settings
  door, and should then fold into `ingest`. Worth revisiting once it has been
  used for a while.
