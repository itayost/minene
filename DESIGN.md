---
name: Minene Cockpit
description: A warm Hebrew management workspace that prepares one useful next step and keeps practical tools close at hand.
colors:
  minene-rose: "#B76578"
  minene-rose-strong: "#8F4859"
  warm-text: "#3F3532"
  muted-copy: "#887C77"
  warm-surface: "#FFFCF8"
  surface-sunken: "#F7F2EC"
  positive: "#0F6F66"
  shell-ground: "#EEEAE7"
  mist-border: "#DED5CD"
  white: "#FFFFFF"
typography:
  display:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "29px"
    fontWeight: 800
    lineHeight: 1.13
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.25
  title:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
  navigation:
    fontFamily: "Heebo, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  nav: "10px"
  control: "12px"
  tool-card: "14px"
  recommendation: "16px"
  outer-shell: "44px"
  pill: "999px"
spacing:
  compact: "4px"
  control: "8px"
  card-grid: "9px"
  standard: "12px"
  card: "14px"
  page-inset: "20px"
  section: "24px"
components:
  navigation-action:
    backgroundColor: "transparent"
    textColor: "{colors.quiet-copy}"
    typography: "{typography.navigation}"
    rounded: "{rounded.nav}"
    padding: "4px 2px"
    height: "44px"
  navigation-action-active:
    backgroundColor: "transparent"
    textColor: "{colors.minene-pink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.nav}"
    padding: "4px 2px"
    height: "44px"
  recommendation-card:
    backgroundColor: "{colors.feature-surface}"
    textColor: "{colors.cockpit-navy}"
    rounded: "{rounded.recommendation}"
    height: "194px"
  recommendation-action:
    backgroundColor: "transparent"
    textColor: "{colors.minene-pink-strong}"
    rounded: "{rounded.nav}"
    padding: "4px 0"
  tool-card:
    backgroundColor: "{colors.tool-surface}"
    textColor: "{colors.cockpit-navy}"
    typography: "{typography.title}"
    rounded: "{rounded.tool-card}"
    padding: "14px 9px 27px"
  mentor-field:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.cockpit-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "40px"
  mentor-control:
    backgroundColor: "{colors.warm-surface}"
    textColor: "{colors.cockpit-navy}"
    rounded: "{rounded.pill}"
    size: "40px"
---

# Design System: Minene Cockpit

## Overview

**Creative North Star: "The Attentive Co-Manager"**

Minene Cockpit feels like a capable partner who has prepared the manager's desk before she arrives: personal without becoming chatty clutter, polished without becoming corporate, and supportive without hiding direct access to the work. The shipped world uses a calm editorial reading order, warm near-white layers, navy Hebrew hierarchy, and a deliberately scarce pink accent to turn attention into one useful next step.

The interface is feminine, human, and managerial rather than decorative. Lifestyle photography supplies real-world context; precise line icons, quiet surfaces, and generous breathing room keep the experience operational. The approved home establishes the expression: welcome the manager, make one recommendation legible, organize the practical catalog, then keep the mentor composer within reach.

**Key Characteristics:**

- Hebrew-first RTL hierarchy with one clear focus at a time.
- Warm near-white surfaces grounded by Minene navy and selective pink.
- Lifestyle photography paired with restrained, consistent line icons.
- Airy page rhythm with dense choices grouped into calm, legible regions.
- Tonal separation and hairline borders, with elevation reserved for the outer shell.

## Colors

Navy and warm white carry the interface; Minene pink identifies the brand, current state, and meaningful action. Slight differences between near-white surfaces create structure without turning every region into a separate card.

### Primary

- **Minene Pink**: identity, active navigation, directional arrows, and small action cues.
- **Deep Minene Pink**: recommendation labels and action copy that need firmer contrast.

### Secondary

- **Minene Pink Tint**: small filled details inside the line-icon family; never a broad surface wash.

### Tertiary

- **Live Red**: the mentor's compact `LIVE` status only; it is not a competing brand accent.

### Neutral

- **Cockpit Navy**: primary Hebrew copy, headings, important icons, and structural authority.
- **Supporting Navy**: explanatory copy inside the recommendation.
- **Muted Copy**: secondary descriptions inside compact tool cards.
- **Quiet Copy**: inactive navigation and subdued status text; check rendered contrast before using it for essential information.
- **Warm Surface**: the shell and dominant reading field.
- **Feature Surface**: the recommendation's softly differentiated copy field.
- **Tool Surface**: the six practical tool tiles.
- **Field Surface**: the recessed mentor input.
- **Shell Ground**: the desktop canvas outside the bounded product.
- **Mist Border** and **Feature Border**: hairline separation for controls, navigation, and the recommendation.
- **White**: high-contrast text on the mentor's live-status badge.

**The Pink Has a Job Rule.** Pink identifies Minene, current state, or a meaningful action; it is never scattered as decoration across every component.

**The Near-White Layer Rule.** Warm Surface, Feature Surface, Tool Surface, and Field Surface may separate adjacent regions, but their differences stay subtle enough that the product still reads as one prepared workspace.

## Typography

**Display Font:** Heebo with Apple system, BlinkMacSystemFont, Arial, and sans-serif fallbacks.
**Body Font:** Heebo with the same fallbacks.

**Character:** One Hebrew workhorse family keeps confident prompts, practical descriptions, and compact controls in the same voice. Scale, weight, spacing, and line length create hierarchy; decorative font changes do not.

### Hierarchy

- **Display** (800, 29px, 1.13): reserved for rare page-level prompts; the current home intentionally omits a separate display question and lets the recommendation lead.
- **Headline** (800, 22px, 1.25): major section statements such as the practical-tools heading. Recommendation headlines use the same weight at 21px with a tighter 1.16 line-height.
- **Title** (800, 15px, 1.2): short tool names and other compact component titles.
- **Body** (400, 13.5px, 1.45): recommendation explanation. Dense tool descriptions step down to 11px with a 1.38 line-height.
- **Label** (700, 12px, 1.4): recommendation labels and compact status language.
- **Navigation** (700, 10.5px, 1.2): persistent bottom-navigation labels.

**The Hebrew First Rule.** Type scale, wrapping, alignment, icon direction, and line length are resolved in Hebrew RTL first; LTR assumptions never define the composition.

**The Weight Carries Hierarchy Rule.** Use Heebo's weight and controlled scale to create authority; do not add a second display face merely to manufacture personality.

## Layout

The shared product is a portrait-first shell bounded to 402px wide and 846px tall on larger canvases. Below 540px, it becomes a full-width, full-height mobile viewport. The shell owns a safe-area-aware header, a scrollable content field, and a persistent bottom navigation whose actions remain at least 44px tall.

The shipped home uses 20px inline insets, 22px top padding, a 24px vertical section rhythm, and a single wide recommendation followed by a three-column RTL tool grid with 9px gaps. The personal greeting leads directly into the recommendation, without a separate focus question. The recommendation splits copy and photography at approximately 1:1.22. At 350px and below, its photograph moves above the copy, the tool catalog becomes two columns, and the page inset tightens to 14px.

**The Bounded Workspace Rule.** Desktop space frames the mobile management product; it does not stretch touch-oriented controls across the browser.

**The Useful Step First Rule.** On guided entry surfaces, reveal the prepared recommendation before the complete catalog while keeping direct tool access in the same scroll.

## Elevation & Depth

Depth is tonal and photographic by default. Warm surface changes, hairline borders, clipped imagery, and the strong reading order distinguish regions. Only the bounded shell gains ambient elevation on canvases at least 540px wide (`0 26px 60px rgb(15 18 32 / .34)`); recommendation and tool cards remain shadowless.

### Shadow Vocabulary

- **Outer Shell** (`0 26px 60px rgb(15 18 32 / .34)`): a broad desktop-only shadow that lifts the complete mobile product from Shell Ground.

**The Quiet Depth Rule.** If a border, tonal shift, or clipped photograph already explains hierarchy, do not add a shadow.

## Shapes

The form language is soft and composed: a 44px outer-shell radius on larger canvases, a 16px recommendation radius, 14px tool cards, 10–12px navigation and icon-control corners, and fully pill-shaped mentor controls. Large photography clips precisely to its recommendation container rather than floating independently.

Borders remain thin: 1px for the recommendation and field, 1.5px for round mentor controls, and 2px for the enclosing mentor composer. Directional arrows and navigation symbols share rounded caps and joins; the practical-tool family uses a 1.8px navy stroke with small pink-filled accents.

**The Soft, Not Toy-Like Rule.** Rounded geometry should feel welcoming and controlled; avoid bubbly proportions, excessive pills, or thick cartoon outlines outside compact controls.

## Components

### Application Shell and Header

The shell is the stable Minene frame: Warm Surface inside Shell Ground, the official pink logo beside the uppercase `MINENE COCKPIT` lockup, a hairline header divider, and no extra decoration. The header is at least 59px plus the top safe area; its side spacers preserve optical centering.

### Navigation

Persistent navigation is quiet until selected. Each action is at least 44px tall, uses a precise 20–22px icon, and pairs it with the Navigation label role. Inactive actions use Quiet Copy; the current destination changes to Minene Pink. Buttons and links share a 3px pink-tinted focus-visible outline with a 2px offset.

### Recommendation Card

The signature card is a wide 194px minimum-height split between a compact copy stack and lifestyle photography. It uses Feature Surface, a Feature Border hairline, a 16px clipped radius, and no shadow. A narrow gradient at the image seam softens the join without becoming a decorative overlay. The label and terminal action use Deep Minene Pink; the headline remains Cockpit Navy.

### Tool Cards

Practical tools form equal-height tiles with a 177px minimum height, Tool Surface, a 14px radius, centered type, and no border or shadow. A 52px line icon leads each tile, with Cockpit/Supporting Navy strokes and a small Minene Pink Tint accent. The title is visually dominant, the description remains concise, and a small RTL-aware pink arrow anchors the action corner.

### Mentor Composer

The mentor is a persistent pill-shaped composer beneath the catalog: a 2px Cockpit Navy enclosure with 8px internal spacing, a recessed Field Surface input, and 40px circular attach, voice, and live controls. Its `LIVE` badge is the sole use of Live Red. Because the mentor is not connected, controls surface an honest status message instead of simulating completion.

### Line Icons

Interface icons are hand-aligned SVG lines with rounded caps and joins, consistent optical sizes, and sparse pink accents. Icons describe actions; they do not become decorative illustrations. Directional glyphs follow the reading direction, and purely visual paths remain hidden from assistive technology.

Motion is brief and subordinate: the home enters over 260ms with an eased horizontal shift and fade. Reduced-motion preferences collapse animation and transition duration to effectively instantaneous behavior.

## Do's and Don'ts

### Do:

- **Do** lead Hebrew RTL layouts with a single legible management priority, then keep practical alternatives close.
- **Do** preserve the official Minene logo, Heebo hierarchy, navy authority, warm near-whites, and restrained pink action cues.
- **Do** use real or properly licensed lifestyle photography with a thoughtful, credible management context.
- **Do** keep line-icon stroke, optical size, rounded joins, and pink-accent behavior consistent across a set.
- **Do** preserve 44px touch targets, visible focus treatment, safe-area behavior, and narrow-screen reflow.
- **Do** make recommendation, personalization, unavailable-action, and mentor states honest about their real data and capability.

### Don't:

- **Don't** flatten a guided entry surface into an undifferentiated launcher grid where every action competes equally.
- **Don't** replace lifestyle photography with generic gradients, decorative glass, or an unrelated illustration style.
- **Don't** turn every warm surface into a bordered, shadowed floating card.
- **Don't** use pink as ambient decoration or let Live Red become a second brand accent.
- **Don't** invent routes, recommendations, profile data, or working AI behavior to make a visual state appear complete.
- **Don't** let pale text, thin icons, or compact labels fall below accessible contrast or touch-size requirements.

## Where these values come from

The source of truth is `src/brands/minene.ts`, which is what `BrandShell`
actually emits as custom properties. This file drifted from it once already: it
documented a hot pink and navy palette (`#E8368F`, `#1D2645`, and cool greys)
for weeks after the brand moved to warm rose, and the מוח ארגוני surfaces were
built against the stale version. Nothing failed, because a `var()` fallback
never fires inside the shell -- the brain simply rendered cool blue-grey on a
warm cream ground until somebody put the two screens side by side.

`surface-sunken` and `positive` are the two tokens that redesign added. Both are
required by `src/core/validate-brand.ts`, so a brand that omits one fails the
build rather than falling through to a hardcoded colour.
