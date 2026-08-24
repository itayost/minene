# Brain Co-Manager Cockpit Design (sub-project 6)

Date: 2026-08-24
Status: Draft

## Objective

Replace the content viewer's home grid with a Brain Co-Manager cockpit: eight
action cards that answer "what do you want to do now", and a three-step wizard
behind the first of them that captures what a training video should be.

## Decisions Taken

- **The cockpit becomes the app's front door and the content viewer retires.**
  The subject, group and page-viewer routes become dead weight.
- **The wizard collects choices only.** No video is generated. The final action
  records the three answers; producing an actual video is a separate subsystem
  with a provider, cost per render, job queuing and failure handling, and is not
  in scope here.

## Sequencing, and why deletion comes last

This ships in two phases.

**Phase 1** builds the cockpit and the wizard at their own routes, additively.
Nothing is deleted and the viewer keeps working, so the new front door can be
judged next to the old one.

**Phase 2** points `/minene` at the cockpit and retires the viewer in one
deliberate commit.

The order matters because phase 2 is destructive and phase 1 is not. Building the
replacement first means the decision to delete is made while looking at working
software rather than at a plan.

## What retiring the viewer costs

The 60-plus Minene Cockpit page images under `public/brands/minene/pages/` become
unreachable, along with the subject chooser, the page viewer, swipe navigation
and remembered reading progress. That document is what this application was
originally built to deliver. This is recorded so the cost is explicit rather than
discovered.

It also settles the reference question. The 20 frozen screenshots capture the
home grid, a subject chooser, a page viewer and a tool screen. Once the viewer
retires, three of those four screens no longer exist, so the set stops being a
gate and becomes history. Until phase 2, they stay a gate and must keep passing.

## The Cockpit

Eight cards, numbered, each with a title, a subtitle and a description, in the
two-column pastel grid the app already uses. A footer prompt closes the screen:
`מה את רוצה לעשות עכשיו?`

| # | Title | Subtitle | Destination |
|---|---|---|---|
| 1 | ליצור | סרטון הדרכה | The video wizard |
| 2 | ליצור | תמונת הדרכה | Not built in phase 1 |
| 3 | לעודד | את העובדות | Not built in phase 1 |
| 4 | לעשות | לשכנע | The persuader, which is its own sub-project |
| 5 | לעשות | לנתח | Not built in phase 1 |
| 6 | לעשות | תרגיל לצוות | Not built in phase 1 |
| 7 | לעשות | בשיחה עם עובדת | Not built in phase 1 |
| 8 | לעשות | שליטה אישית | Not built in phase 1 |

Only card 1 has a specified flow. The other seven render with their copy and are
visibly not yet available rather than linking somewhere that 404s: a card that
looks live and then fails reads as a broken app. Card 4 is deliberately left for
the persuader sub-project rather than stubbed twice.

## The Video Wizard

Three steps, each a single choice, then a final action.

**Step 1, `על מה הסרטון?`** — one of `מכירות`, `מוצר`, `שירות`, `אנרגיות`,
`עידוד`, `אחר`.

**Step 2, `מה אני רוצה שיקרה?`** — one of `שיציעו מוצר נוסף`, `שיחייכו יותר`,
`שיכירו מוצר`, `שיגיעו באנרגיה`, `שיאהבו את מה שהן עושות`.

**Step 3, `איזה סרטון?`** — a style (`מעודד`, `אנרגטי`, `מקצועי`) and a length
(`10`, `20`, `30` שניות). This step carries two choices, not one.

The final action, `צורו סרטון!`, records the four values and shows them back. It
does not generate anything, and the screen says so plainly rather than implying a
render is coming.

### Why one screen rather than three routes

The three steps are one decision with three parts, and the reference shows all
three visible at once with the earlier answers still readable. Splitting them
across routes would hide the earlier choices at the moment they matter most, when
the reader is deciding the third. State lives in the client; nothing is persisted
in phase 1, because there is nothing yet worth persisting.

## Testing

The cockpit renders eight cards; card 1 links to the wizard; the seven others do
not link anywhere.

The wizard: each step records its choice, step 3 records both style and length
independently, the final action is disabled until all four are chosen, and it
reports the collected values rather than claiming a video exists.

The 20 frozen references must still pass in phase 1, because nothing it adds
touches a captured screen. Both snapshot guards stay exactly as they are.

## Out of Scope

- Generating an actual video.
- Cards 2, 3, 5, 6, 7 and 8.
- Card 4, which belongs to the persuader sub-project.
- Persisting a wizard run.
- Phase 2's deletion, which is specified when phase 1 is proven.
