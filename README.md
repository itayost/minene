# Multi-Brand Content Viewer

A static React and TypeScript viewer for Minene Cockpit content and additional manifest-driven brands. The shared interface handles navigation, page viewing, saved progress, sharing, downloads, and responsive mobile framing; each brand supplies only configuration and public assets.

## Requirements

- Node.js 20.19 or newer
- pnpm (the repository pins pnpm 10.34.5 so the complete toolchain supports Node.js 20.19)

## Local development

Install dependencies and start Next.js:

```bash
pnpm install
pnpm dev
```

This starts Next on port 3000.

Run the complete test, type-check, manifest-validation, and production-build gate:

```bash
pnpm check
```

You can also build separately:

```bash
pnpm build
```

To inspect that exact production output locally, run the equivalent of `pnpm preview`:

```bash
pnpm build && pnpm start
```

## URL behavior

Every screen has its own address, in one of four shapes:

- `/<brand-id>` — the brand home screen.
- `/<brand-id>/<subject-id>` — a subject's group chooser. A subject with exactly one group redirects straight to that group's viewer instead.
- `/<brand-id>/<subject-id>/<group-id>` — the page viewer for a group, optionally with a one-based `?page=` query parameter naming the page to open.
- `/<brand-id>/tools/<tool-id>` — a brand tool screen.

`/` loads Minene as the default brand. An unknown subject, group, or tool returns a 404. An unknown brand ID also returns a 404, rendered as the brand-not-found screen rather than the generic not-found page.

## Deploying with Vercel

No environment variables or backend services are required for this release.

1. Import this repository as a new project in Vercel.
2. Keep the repository root as the project root. Vercel autodetects Next.js, so no build or output settings need to be set manually.
3. Deploy, then verify `/`, `/minene`, a deep group URL, and a tool URL with a direct full-page load.

For the complete brand manifest and asset workflow, see [Adding a brand](docs/adding-a-brand.md).
