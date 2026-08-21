# Multi-Brand Content Viewer

A static React and TypeScript viewer for Minene Cockpit content and additional manifest-driven brands. The shared interface handles navigation, page viewing, saved progress, sharing, downloads, and responsive mobile framing; each brand supplies only configuration and public assets.

## Requirements

- Node.js 20.19 or newer
- pnpm (the repository currently declares pnpm 11.0.9)

## Local development

Install dependencies and start Vite:

```bash
pnpm install
pnpm dev
```

Run the complete test, type-check, manifest-validation, and production-build gate:

```bash
pnpm check
```

You can also build separately:

```bash
pnpm build
```

The production build is written to `dist/`. To inspect that exact output locally, run:

```bash
pnpm preview --host 127.0.0.1
```

## URL behavior

- `/` loads Minene as the default brand.
- `/minene` loads Minene explicitly.
- `/<brand-id>` loads any additional brand registered in `src/core/brand-registry.ts`.
- An unknown brand ID renders the brand-not-found screen.

The application is a client-rendered single-page app. `vercel.json` rewrites brand URLs to `index.html` while preserving the requested browser URL, so a direct visit or full refresh at `/minene` or another registered brand path works.

## Deploying with Vercel

No environment variables or backend services are required for this release.

1. Import this repository as a new project in Vercel.
2. Keep the repository root as the project root. Vercel should detect Vite automatically.
3. Use `pnpm install` as the install command, `pnpm build` as the build command, and `dist` as the output directory if Vercel does not populate them automatically.
4. Deploy, then verify `/`, `/minene`, and every additional registered `/<brand-id>` URL with a direct full-page load.

For the complete brand manifest and asset workflow, see [Adding a brand](docs/adding-a-brand.md).
