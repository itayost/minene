---
target: mobile video creation wizard on the Minene cockpit page
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-24T10-20-32Z
slug: app-brandid-cockpit-video-video-wizard-tsx
---
# Video Wizard UX Critique

Method: dual-agent (A: ux_design_review · B: ux_detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | Selected states exist, but there is no step progress, remaining-requirements message, or generation state. |
| 2 | Match system / real world | 2/4 | The Hebrew is approachable, but “three clicks” and “create a video” do not match the actual flow or outcome. |
| 3 | User control and freedom | 2/4 | Selections can be changed and global navigation exits the page; there is no reset, local back action, or recovery path. |
| 4 | Consistency and standards | 3/4 | Components and RTL structure are cohesive; the voice switches from singular feminine to plural in the CTA. |
| 5 | Error prevention | 2/4 | Required choices gate submission, but clipping, “Other,” and the unavailable output have no guardrails. |
| 6 | Recognition rather than recall | 2/4 | Labels and pressed states help, but runtime clipping hides valid options. |
| 7 | Flexibility and efficiency | 1/4 | One rigid path with no defaults, recommendations, saved progress, or expert shortcut. |
| 8 | Aesthetic and minimalist design | 2/4 | The visual system is clean, but 17 visible chips and equally prominent steps create noise. |
| 9 | Error recognition and recovery | 1/4 | The unavailable result offers no actionable recovery or useful next step. |
| 10 | Help and documentation | 1/4 | Short hints exist, but style choices lack examples and the disabled CTA does not explain what remains. |
| **Total** |  | **18/40** | **Poor — core trust and layout failures outweigh the solid visual foundation.** |

## Design Specificity Verdict

**Partially authored, structurally interchangeable.** The feminine Hebrew, Minene palette, and retail coaching choices ground the content in the product. The numbered-card and text-chip composition, however, could be reused unchanged by almost any form or AI generator. The page does not show a Minene-branded preview, example frame, presenter/avatar, or real training outcome that makes the product promise tangible.

The deterministic scan returned **0 findings** for `app/[brandId]/cockpit/video/video-wizard.tsx`. That result is a false negative for runtime layout: browser measurements at 410×833 showed step 3 with `clientHeight: 193px` and `scrollHeight: 221px`; only 25px of the 40px “30 שניות” button is visible. The constrained grid surface and `.wizard-step { overflow: hidden }` combine to clip content. No visual overlay was presented because the available browser evaluation surface is read-only; the evidence comes from the supplied screenshot, a fresh live view, DOM measurements, and source inspection.

## Overall Impression

The page feels friendly, orderly, and easy to scan at first glance. Its biggest opportunity is to become a truthful progressive wizard: one decision at a time, visible progress, a compact editable summary, and a CTA that accurately describes what will happen.

## What’s Working

- The RTL scan path is natural: step markers sit on the right and content follows Hebrew reading order.
- Each decision is clearly grouped, and the purple, pink, and teal accents make the sequence easy to parse.
- Native buttons, `aria-pressed`, labelled groups, focus styling, and a status region provide a better accessibility foundation than the screenshot alone suggests.

## Priority Issues

### [P0] The promised outcome is unavailable

**Why it matters:** The CTA says “צורו סרטון!” but submission only creates an in-memory brief, after which the page reveals that video generation is unavailable. The emotional high point becomes a trust-breaking dead end.

**Fix:** If generation is not ready, disclose that before the user starts and rename the action to “שמרי בריף לסרטון.” If generation is ready to implement, provide generating, progress, success, failure, retry, and concrete output states.

**Suggested command:** `$impeccable harden`, then `$impeccable clarify`.

### [P1] The third step clips valid choices

**Why it matters:** A user cannot reliably see or tap the 30-second choice. Shorter viewports compress even more content, and the parent cannot recover it through scrolling.

**Fix:** Remove fixed-height grid pressure, make rows content-sized or use normal block/flex flow, prevent cards from shrinking, and let the surface scroll. Test 320/360/402/410px widths and 667/720/823px heights with bottom navigation and safe-area padding present.

**Suggested command:** `$impeccable adapt`.

### [P1] “Three clicks” contradicts five required taps

**Why it matters:** Topic + goal + style + length + CTA is five taps. The copy weakens credibility before the user reaches the unavailable-result message.

**Fix:** Either say “ארבע בחירות קצרות” or make the experience genuinely three decisions by assigning a smart default for length or merging style and length into a recommended format.

**Suggested command:** `$impeccable clarify`.

### [P1] All decisions compete at once

**Why it matters:** The page exposes 17 chips simultaneously. Topic has six options and goal has five, both above the four-item decision guideline. Every step looks active, which creates a dense scanning task on mobile.

**Fix:** Show one expanded decision at a time. Collapse completed steps into a one-line editable summary, highlight a recommended choice, and place low-frequency items under “עוד.” Keep a running brief immediately above the CTA.

**Suggested command:** `$impeccable distill`.

### [P2] Touch, contrast, and state guidance need strengthening

**Why it matters:** Choice buttons are 40px high rather than at least 44px; the 12px muted helper text is too faint; selection is communicated mainly with a subtle pink fill and border; the disabled CTA does not explain what remains; “אחר” opens no custom input.

**Fix:** Use 44–48px touch targets, raise helper-text contrast, add a checkmark to selected choices, show “בחרי עוד 2 אפשרויות” near the CTA, and reveal a text field after “אחר.”

**Suggested command:** `$impeccable audit`.

## Cognitive Load

**High: 4 of 8 checks fail.** The interface has a single purpose, groups related controls well, provides a legible hierarchy, and keeps earlier selections visible. It fails chunking, one-thing-at-a-time, minimal-choice, and progressive-disclosure checks because 17 options and four decisions are visible simultaneously.

## Emotional Journey

The opening is upbeat and low-friction. The bright palette and chip feedback create momentum, but crowding and an unexplained disabled CTA introduce doubt. Activation promises a meaningful creation event, then ends by revealing that creation is unavailable. Under the peak-end rule, that ending dominates the otherwise pleasant experience.

## Persona Red Flags

**Jordan, first-timer:** Cannot reconcile “three clicks” with four required selections, cannot tell why the CTA is disabled, and learns only at the end that no video will be produced. “אחר” appears complete but provides no way to define the topic.

**Sam, accessibility-dependent:** Native button semantics are a strength, but a keyboard-focused control may be visually clipped. Targets are undersized, muted hints are low-contrast, selected states are subtle, and progress is not announced.

**Casey, distracted mobile user:** Lower choices are clipped, 17 chips demand excessive one-handed scanning, progress is lost on refresh because it only lives in React state, and the bottom navigation competes with the form for the thumb zone.

## Recommended Page Structure

1. Compact header: “יוצרות סרטון הדרכה” plus `שלב 1 מתוך 4`.
2. One expanded question with 3–4 primary choices; move “אחר/עוד” behind progressive disclosure.
3. After selection, auto-advance or enable a bottom “המשך” button. Completed steps collapse to editable summary rows.
4. For style choices, show small visual preview cards rather than abstract text chips.
5. Keep a sticky summary above the CTA: `מכירות · שיציעו מוצר נוסף · אנרגטי · 20 שניות`.
6. Use “המשך לסיכום” until the final review. Use “צרי סרטון” only when generation actually starts; otherwise use “שמרי בריף”.

## Minor Observations

- The wide number rails consume valuable mobile width; a compact top progress bar or small step badge would preserve the same orientation with more room for labels.
- The CTA remains visually dominant while disabled; use a quieter disabled treatment and an adjacent explanation.
- Copy shifts from singular feminine (“בחרי”) to plural (“צורו”). Pick one voice consistently.
- The result summary repeats selections but lacks edit affordances, save destination, preview, or a next step.
- Style labels such as “אנרגטי” and “מקצועי” are abstract without a thumbnail, sample frame, or short example.

## Questions to Consider

1. Is this page currently a real video creator, or should it honestly ship first as a brief builder?
2. Should the redesign prioritize a fast one-question-at-a-time flow, or retain the single-page overview with expandable cards?
3. Should style choices remain text-only, or use branded visual examples that show the expected result?
