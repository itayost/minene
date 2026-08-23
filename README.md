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

**Check this before the first deploy.** This repository previously shipped a Vite build, and the Vercel project it was linked to (`.vercel/project.json`) may still carry that build's settings. In the project's **Settings, Build and Deployment**, confirm both of the following:

- **Framework Preset** is **Next.js**, not Vite.
- **Output Directory** has **no override**. A leftover `dist` override makes Vercel build Next and then serve an empty directory, so the first deploy after this merge returns nothing at every address.

Vercel autodetects Next.js on a new project, so a project imported fresh needs neither change. Only a project carrying settings from the Vite build does, and it will not announce them.

1. Import this repository as a project in Vercel, or open the existing linked project.
2. Keep the repository root as the project root, and confirm the two settings above.
3. Deploy, then verify `/`, `/minene`, a deep group URL, and a tool URL with a direct full-page load.

## Visual references

`tests/visual/__snapshots__` holds 20 screenshots: four screens at five widths. They were captured from the Vite build that preceded the Next.js conversion, and that application no longer exists, so they cannot be regenerated. They are the only surviving evidence that the conversion left the design unchanged, which is why both `pnpm visual:reference` and the Playwright config refuse to overwrite them. An accidental overwrite is recovered with `git restore tests/visual/__snapshots__`, not by recapturing.

Compare the current build against them:

```bash
pnpm visual:verify
```

That builds the app, starts it on port 4173, runs the comparison, and shuts the server down again. Nothing needs to be running first, and a server left running from earlier is deliberately not reused, because comparing against a stale build would pass while proving nothing.

The references were captured on macOS. `snapshotPathTemplate` stores one set for all platforms, so running the comparison on Linux or Windows fails all 20 on font rasterisation alone, with a diff that looks like a design change and is not. Treat a failure on another platform as unverified rather than as a regression, and check it on macOS.

To compare an already-deployed build instead of a local one, set `VIEWER_BASE_URL`; the suite then starts no server of its own.

For the complete brand manifest and asset workflow, see [Adding a brand](docs/adding-a-brand.md).
