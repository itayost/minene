# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are Minene store managers and regional managers. They use the product while leading stores and teams, deciding what deserves attention, preparing management actions, and accessing operational knowledge.

The authenticated product also distinguishes `owner` and `staff` tenant roles. Owner-only organizational-knowledge administration is a secondary workflow, not the primary home experience.

## Product Purpose

Minene Cockpit combines two equally important product roles:

1. A smart co-manager that helps a manager decide what to focus on and supports her in completing a useful management action.
2. A catalog of management tools, organizational knowledge, and practical content that a manager can enter directly when she already knows what she needs.

The product supports everyday work around employees, conversations, motivation, training, sales, store performance, team exercises, and the manager's own regulation and focus.

Success has three cumulative meanings:

- the manager completes a useful management action during a visit;
- managers return and use the product as part of their regular work;
- usage contributes to measurable improvement in team and store performance.

## Positioning

Minene Cockpit is not only a content library and not only a generic AI assistant. It combines Minene-specific organizational knowledge, manager-facing tools, and context-sensitive guidance in one private workspace for store and regional management.

The product should help a manager move from “what matters now?” to a practical action, while preserving direct access to the complete tool and knowledge catalog.

## Operating Context

- The primary interface is Hebrew and right-to-left.
- The product is used on the web with a mobile-first shell suitable for day-to-day store work.
- Access is private and tenant-scoped. A signed-in user's tenant determines the brand they may access.
- Public signup is intentionally unavailable; accounts are provisioned by an owner.
- Manager workflows include preparing employee conversations, encouraging employees, training teams, creating training material, persuasion, analysis, personal control, store planning, results, recruitment, onboarding, and organizational knowledge.
- Existing content can be viewed as branded page sequences with navigation, progress, sharing, saving, and WhatsApp-oriented actions where implemented.

## Capabilities and Constraints

- The application is a Next.js and React web product backed by Supabase authentication and tenant/role resolution.
- The shared application is manifest-driven and supports more than one brand, while the approved product direction in this record is for Minene Cockpit.
- Roles are `owner` and `staff`; organizational-brain extraction, approval, and administration routes are owner-only.
- The current Minene catalog includes content subjects and the tools Campaigner, Persuader, and Organizational Brain.
- The current cockpit defines eight manager actions. Only the training-video action currently has a cockpit route; unfinished actions must not be presented as successfully operational until their flows exist.
- The current mentor composer is a product shape without a connected AI operation. Future work must distinguish visual intent from implemented capability.
- Personalized greetings, recommendations, AI prompts, and profile/resource destinations shown in approved design work require real data, routes, or explicit fallback states before they are treated as functional.
- The supplied home-screen mockup is the approved and binding redesign reference for the Minene home surface. It defines the desired direction, while implementation truth and unavailable states remain governed by the constraints above.

## Brand Commitments

- Product name: Minene Cockpit / `MINENE COCKPIT`.
- Preserve the existing Minene identity and official logo asset at `public/brands/minene/icons/logo-pink.svg`.
- The primary product voice is direct, supportive, practical, and written naturally for Hebrew-speaking women managers.
- The approved redesign reference is `docs/design/minene-home-approved-2026-08-24.png`. Future redesign work should treat this reference as intentional rather than reverting to the incumbent home grid by default.

## Evidence on Hand

- Product and content manifest: `src/brands/minene.ts`.
- Manager-action catalog and copy: `src/cockpit/actions.ts`.
- Existing Minene logo, icons, and content pages: `public/brands/minene/`.
- Authentication, tenant, and role model: `src/auth/session.ts` and `src/auth/require-brand.ts`.
- Current home and navigation implementation: `app/[brandId]/page.tsx` and `src/components/BrandShell.tsx`.
- Approved new home-screen design reference: `docs/design/minene-home-approved-2026-08-24.png`.
- A design handoff bundle exists at `minene-app-page-redesign/`; it is prototype evidence and not automatically production implementation truth.
- No confirmed testimonials, performance benchmarks, customer claims, or causal evidence connecting product usage to store results are present. Future work must not fabricate them.

## Product Principles

1. **Useful action every visit:** the home experience should help a manager complete something valuable, not merely browse features.
2. **Guidance and catalog are peers:** personalized assistance and direct tool access must coexist; neither may hide or replace the other.
3. **Built for management reality:** priorities, language, and workflows should reflect the daily work of store and regional managers.
4. **Earn trust through honesty:** recommendations must have a real basis, and unfinished capabilities must have explicit states.
5. **Improve over time:** judge success through completed actions, repeat use, and eventually measurable team and store outcomes.

## Accessibility & Inclusion

- Hebrew RTL behavior is a product requirement, including reading order, directional affordances, navigation, and assistive-technology semantics.
- The core experience must remain usable on narrow mobile screens and with touch interaction during active store work.
- No project-specific conformance target beyond these needs has yet been confirmed.
