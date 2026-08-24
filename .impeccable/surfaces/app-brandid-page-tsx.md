---
version: 1
slug: "app-brandid-page-tsx"
primary_target: "app/[brandId]/page.tsx"
related_targets: ["src/styles.css","app/[brandId]/cockpit/mentor-bar.tsx","public/brands/minene/home-manager-recommendation.png"]
---

# Minene Home Dashboard

## Scope and Mode

- Primary target: `app/[brandId]/page.tsx`; Minene home route in **Operate** mode.
- Replaces the incumbent flat launcher grid without redesigning inner tools or content viewers.
- Current fidelity is an approved static wireframe: recommendation and catalog actions intentionally carry no navigation or business logic.

## Audience and Job

- Minene store and regional managers arrive to decide what deserves attention, scan practical tools, or continue into the existing mentor composer.
- The home must put one useful suggested action before the catalog while keeping direct tool discovery equally visible.

## Chosen Direction

- The composition follows `docs/design/minene-home-approved-2026-08-24.png` with one explicit user override: keep the personal Hebrew greeting, remove the separate focus question, lead directly into one wide photo-led recommendation, then show six Minene tool cards in a three-column RTL grid.
- The memorable moment is the direct transition from the greeting to one confident recommendation, using warm white, Minene navy, restrained pink, original lifestyle photography, and one precise line-icon family.
- The mockup's large `MINENE AI` panel is intentionally replaced by the existing compact `MentorBar` beneath the catalog; the existing shell header and bottom navigation remain unchanged.

## Constraints and Open Decisions

- Show no `בקרוב` badges. During the wireframe phase, visual actions are static content rather than misleading links.
- Greeting, recommendation, and six catalog entries are illustrative fixed content until real data and routes are defined.
- Preserve authenticated tenant behavior, RTL order, narrow-screen adaptation, accessible headings, and the shell's persistent navigation.
- Product work still needs to define recommendation data, destination routes, profile/resource navigation, and connected mentor behavior before these affordances become functional.
