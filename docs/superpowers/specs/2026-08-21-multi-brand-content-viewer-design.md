# Multi-Brand Content Viewer Design

Date: 2026-08-21
Status: Approved in conversation; awaiting written-spec review

## Objective

Build the existing Minene Cockpit redesign as a production-ready, static web application that can be deployed to Vercel. The application is a content viewer: users choose a subject and view one or more ordered page images inside a shared mobile interface.

The shared application must also support additional brands without requiring changes to its generic React components. A new brand should be created by adding a brand manifest and brand assets that follow the documented contract.

## Scope

The first release includes:

- The Minene home screen and its eight main subjects.
- Direct opening of content when a subject has one content group.
- A subject chooser when a subject has multiple content groups.
- An ordered page viewer with swipe navigation, page indicators, loading feedback, back navigation, and remembered progress.
- The existing bottom navigation tools: Campaigner, Persuader, and Organizational Brain.
- Sharing the current page through the Web Share API, with a safe fallback.
- Saving the current page as an image download.
- A responsive Hebrew right-to-left interface that is full-screen on phones and presented in a centered mobile frame on larger screens.
- Brand-aware URLs and configuration.
- Automated validation of brand manifests and referenced assets.
- A Vercel-compatible production build.

The first release does not include authentication, user accounts, a database, editable KPI data, an administration interface, analytics, notifications, or server-side content management.

## User Flow

1. The user opens the root URL or a brand URL such as `/minene`.
2. The application loads that brand's manifest and visual theme.
3. The home screen displays the brand's subject cards.
4. Selecting a subject with exactly one content group opens that group's page viewer immediately.
5. Selecting a subject with multiple content groups opens a chooser containing those groups.
6. Selecting a group opens its page viewer at the last page previously viewed for that brand and group.
7. The user moves through pages by swiping horizontally or selecting a page indicator.
8. Back navigation returns from the viewer to the chooser when one exists, otherwise to the home screen.
9. The home action always returns to the brand home screen.
10. A bottom tool opens its configured list content in the same shared shell.

## Architecture

The implementation will use React, TypeScript, and Vite. It will remain a client-rendered static application because all first-release content is bundled as static configuration and image assets. Vercel will serve the built files and rewrite brand routes to the single application entry point.

The code will have two layers:

1. `core`: brand-neutral navigation, layout, viewing behavior, storage, sharing, saving, and validation.
2. `brands`: declarative manifests and static assets for Minene and future brands.

The exported Claude Design project remains untouched as the visual and behavioral reference. Production code will recreate the design rather than depend on the generated Design Component runtime.

## Brand Contract

Each brand manifest contains:

- A stable brand ID used in URLs and storage keys.
- Display name and document title.
- Direction and locale, with Minene configured as Hebrew and RTL.
- Theme tokens for primary color, text color, muted color, background, border, and card colors.
- Logo and other shell-level assets.
- A list of home subjects.
- A list of bottom tools.

Each subject contains:

- A stable subject ID.
- A display label.
- An icon.
- A card background color.
- One or more content groups.

Each content group contains:

- A stable group ID.
- A display label.
- An optional chooser icon.
- An ordered list of page image paths.

Each bottom tool contains:

- A stable tool ID.
- A display label and icon.
- Optional note text.
- An ordered list of text items.

Stable IDs are required so saved progress survives label and asset changes. Shared components must not contain Minene-specific labels, colors, asset paths, or section identifiers.

## Components

- `App`: resolves the requested brand and owns top-level navigation state.
- `BrandShell`: applies direction, theme tokens, responsive framing, header, and bottom navigation.
- `HomeScreen`: renders the configured subject grid.
- `SubjectMenu`: renders the groups for a multi-group subject.
- `PageViewer`: displays the current image, loading state, swipe gestures, and page indicators.
- `ToolScreen`: renders a configured bottom-tool list.
- `ShareSheet`: exposes share, save, and WhatsApp actions for the current page.
- `BrandNotFound`: provides a friendly failure state for an unknown brand URL.

Components receive typed brand data and callbacks. They do not import brand-specific configuration directly.

## State and Persistence

Navigation state is local client state with four screen types: home, subject menu, page viewer, and bottom tool. The selected subject, selected group, current page index, and share-sheet visibility are explicit state values.

Page progress is saved in `localStorage` under a versioned, brand-scoped key. Progress entries are keyed by stable subject and group IDs. Invalid, stale, or out-of-range stored values are ignored and replaced with the first valid page.

The application requires no network API. Page images and icons are served as versioned static Vercel assets.

## URL and Deployment Behavior

- `/` loads Minene as the default brand.
- `/minene` loads the Minene brand explicitly.
- `/<brand-id>` loads another registered brand.
- An unregistered brand ID shows `BrandNotFound`.
- A Vercel rewrite sends brand paths to `index.html` while preserving the browser URL.

Brand selection is URL-driven; the first release does not include a public brand picker.

## Sharing and Saving

The share action uses `navigator.share` when the browser supports sharing the current page image as a file. If file sharing is unsupported, it shares or copies the current page URL and shows clear feedback.

The save action downloads the current page image with a readable filename derived from the brand, group, and page number. The WhatsApp action opens a WhatsApp share URL containing the current page URL and descriptive text. These actions fail gracefully if browser security rules prevent file access or popup creation.

## Responsive and Visual Behavior

The Minene implementation follows the existing redesign's Heebo typography, pink and navy visual language, soft card colors, rounded surfaces, RTL layout, mobile header, and bottom navigation.

On narrow screens, the app fills the available viewport and respects safe-area insets. On larger screens, it is centered in a fixed-width mobile frame against a neutral background. Content remains usable with touch, mouse, and keyboard input. Animations respect `prefers-reduced-motion`.

## Validation and Error Handling

A build-time validation script checks:

- Unique brand, subject, group, and tool IDs.
- At least one group per subject.
- At least one page per content group.
- The existence of every referenced logo, icon, and page image.
- Valid theme values required by the shared shell.

The production UI handles unknown brands, image load failures, unavailable browser sharing APIs, invalid saved progress, and empty optional tool content without crashing.

## Testing and Verification

Automated tests will cover:

- Loading the default and explicit brand routes.
- Direct viewer opening for a single-group subject.
- Chooser opening and group selection for a multi-group subject.
- Page navigation boundaries and indicators.
- Restoring brand-scoped progress.
- Back and home navigation.
- Unknown-brand handling.
- Manifest validation failures.

Manual browser verification will cover the complete Minene flow at phone and desktop widths, RTL alignment, swipe behavior, sharing and saving fallbacks, asset loading, and a production Vercel-style build preview.

## Adding a Brand

To add a brand:

1. Copy the documented brand template directory.
2. Choose a unique brand ID.
3. Add the logo, icons, and page images beneath that brand's asset directory.
4. Fill in the typed brand manifest with theme tokens, subjects, groups, pages, and optional bottom tools.
5. Register the manifest in the brand registry.
6. Run validation and tests.
7. Open `/<brand-id>` to review the brand in the shared application.

This workflow must not require editing shared screen components.

## Acceptance Criteria

- The production app visually matches the provided Minene redesign at mobile size.
- Every configured Minene subject and group opens the correct ordered page set.
- Single-group and multi-group navigation follow the specified behavior.
- Page navigation, remembered progress, sharing, saving, and bottom tools work without a backend.
- The application builds successfully for Vercel.
- A second fixture brand can be added through configuration and assets alone, demonstrating that shared component changes are unnecessary.
- Invalid brand manifests fail validation with actionable messages.
