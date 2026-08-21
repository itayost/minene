# Adding a brand

A brand is a typed manifest plus static assets. Shared React components must not import or special-case a brand. Use the steps below to add one without changing navigation, viewer, sharing, or layout components.

## Workflow

1. Choose a unique, URL-safe brand ID containing lowercase letters, numbers, and single hyphens, for example `acme-field`.
2. Create `public/brands/<id>/icons` and `public/brands/<id>/pages`.
3. Copy `src/brands/minene.ts` to `src/brands/<id>.ts` as the manifest starting point.
4. Replace all IDs, visible labels, locale, direction, theme values, and asset references. Remove Minene subjects, groups, pages, and tools that do not belong to the new brand.
5. Import the manifest in `src/core/brand-registry.ts` and add an explicit `[brand-id, manifest]` entry to `brandManifestEntries`. The registry builder rejects duplicate keys, duplicate manifest IDs, and disagreement between a registration key and `manifest.id` before constructing the `Map`.
6. Validate manifest fields and referenced public files:

   ```bash
   pnpm validate:brands
   ```

7. Run the automated test suite:

   ```bash
   pnpm test:run
   ```

8. Start the app with `pnpm dev` and review `/<brand-id>` at phone and desktop widths. Exercise every subject, group, page, and bottom tool in both pointer and keyboard flows.

The asset rule is strict: every logo, subject icon, optional group icon, page image, and tool icon must be a normalized URL path beneath `/brands/<brand-id>/`. Do not use `.` or `..` segments, backslashes, duplicate separators, query strings, or fragments. These URL paths map to regular files below `public/brands/<brand-id>/`; do not include `public` in a manifest URL. The build-time validator rejects cross-brand and escaping paths and checks that every registered asset is a regular file rather than a directory or symbolic link.

## Stable IDs and navigation behavior

Treat `brand.id`, `subjects[].id`, `subjects[].groups[].id`, and `tools[].id` as permanent data keys, not display copy. Every ID must use lowercase letters, numbers, and single hyphens. The brand ID selects the `/<brand-id>` route and brand-scoped storage namespace. Subject and group IDs form saved-progress keys within that namespace. Tool IDs identify destinations in the brand's local bottom navigation. Changing a brand ID after release changes its route and storage namespace; changing a subject or group ID makes its previously saved page progress unreachable. Change a `label` when copy changes and keep its ID stable.

A subject with exactly one group opens that group's viewer immediately. A subject with two or more groups opens the group chooser first. Each group must contain at least one page, and page order in the array is the viewing order. Group IDs need only be unique within their subject; subject and tool IDs must be unique within their respective brand collections.

## Manifest field reference

| Field | Purpose and constraints |
| --- | --- |
| `id` | Stable, unique URL segment using lowercase letters, numbers, and hyphens. It must match the asset directory name. |
| `name` | Brand name displayed in the home header and used in shared-page descriptions. |
| `title` | Browser document title. |
| `locale` | BCP 47 language tag applied to the document and brand shell, such as `en-US` or `he-IL`. |
| `direction` | Layout direction: `ltr` or `rtl`. |
| `logo` | `{ src, alt }` for the brand logo. `alt` must describe the logo for contexts where the asset is used independently; the shell marks it decorative because the visible brand name is adjacent. |
| `theme.primary` | Main action, focus, active-navigation, and accent color. |
| `theme.primaryStrong` | Stronger accent used for prominent text and controls. |
| `theme.text` | Primary text and system-chrome color. |
| `theme.muted` | Secondary text and inactive-navigation color. |
| `theme.background` | Page background surrounding the desktop frame. |
| `theme.surface` | Brand-shell and content surface color. |
| `theme.border` | Border color for sheets and controls. |
| `theme.fontFamily` | Complete CSS font-family value, including fallbacks. The font must already be available to the app or the user's system. |
| `labels.home` | Accessible and visible home-navigation label. |
| `labels.back` | Accessible back-button label. |
| `labels.navigation` | Accessible name for the bottom navigation. |
| `labels.share` | Share action label. |
| `labels.save` | Image-download action label. |
| `labels.whatsapp` | WhatsApp action label. |
| `labels.feedback.sharedFile` | Success message after sharing the page image as a file. |
| `labels.feedback.sharedUrl` | Success message after sharing the current page URL. |
| `labels.feedback.copied` | Success message after copying the page URL as the final share fallback. |
| `labels.feedback.shareFailed` | Message shown when every share fallback fails. |
| `labels.feedback.saved` | Success message after initiating the page-image download. |
| `labels.feedback.saveFailed` | Message shown when the page image cannot be downloaded. |
| `labels.feedback.whatsappOpened` | Message shown after WhatsApp navigation is initiated. |
| `labels.feedback.whatsappBlocked` | Message shown when the browser blocks creation of the WhatsApp context. |
| `labels.feedback.whatsappFailed` | Message shown when a created context cannot navigate to WhatsApp. |
| `subjects` | Non-empty ordered list of home cards. |
| `subjects[].id` | Stable URL-safe subject key, unique within the brand; used with the group ID to key saved progress. |
| `subjects[].label` | Visible subject and header text. |
| `subjects[].icon` | Brand-prefixed home-card icon path. |
| `subjects[].cardColor` | CSS color for the subject card surface. |
| `subjects[].groups` | Non-empty ordered list of content groups. One group skips the chooser; multiple groups show it. |
| `subjects[].groups[].id` | Stable URL-safe group key, unique within the subject; used with the subject ID to key saved progress. |
| `subjects[].groups[].label` | Visible chooser/viewer label. |
| `subjects[].groups[].icon` | Optional brand-prefixed chooser icon. If omitted, the subject icon is used. |
| `subjects[].groups[].pages` | Non-empty ordered list of `{ src, alt }` page images. Every `alt` must describe its page. |
| `tools` | Ordered list of bottom-navigation tools; it may be empty. |
| `tools[].id` | Stable URL-safe tool key, unique within the brand; identifies a local bottom-navigation destination. |
| `tools[].label` | Visible bottom-navigation and screen label. |
| `tools[].icon` | Brand-prefixed bottom-navigation icon path. |
| `tools[].note` | Optional introductory text shown above the tool list. |
| `tools[].items` | Ordered list of tool-screen text items; it may be empty. |

## Complete small manifest

This example expects corresponding files under `public/brands/acme-field/icons` and `public/brands/acme-field/pages`:

```ts
import type { BrandManifest } from '../core/brand-types'

export const acmeFieldBrand: BrandManifest = {
  id: 'acme-field',
  name: 'Acme Field Guide',
  title: 'Acme Field Guide',
  locale: 'en-US',
  direction: 'ltr',
  logo: {
    src: '/brands/acme-field/icons/logo.svg',
    alt: 'Acme Field Guide logo',
  },
  theme: {
    primary: '#246BCE',
    primaryStrong: '#174A91',
    text: '#13233A',
    muted: '#66758A',
    background: '#E9F1FC',
    surface: '#FFFFFF',
    border: '#D5E2F3',
    fontFamily: 'Arial, sans-serif',
  },
  labels: {
    home: 'Home',
    back: 'Back',
    navigation: 'Main navigation',
    share: 'Share',
    save: 'Save',
    whatsapp: 'Send with WhatsApp',
    feedback: {
      sharedFile: 'Shared the page image',
      sharedUrl: 'Shared a link to the page',
      copied: 'Copied the page link',
      shareFailed: 'Could not share the page',
      saved: 'Saved the page image',
      saveFailed: 'Could not save the page image',
      whatsappOpened: 'Opened WhatsApp',
      whatsappBlocked: 'WhatsApp popup was blocked',
      whatsappFailed: 'Could not open WhatsApp',
    },
  },
  subjects: [
    {
      id: 'welcome',
      label: 'Welcome',
      icon: '/brands/acme-field/icons/welcome.svg',
      cardColor: '#EDF5FF',
      groups: [
        {
          id: 'getting-started',
          label: 'Getting started',
          icon: '/brands/acme-field/icons/start.svg',
          pages: [
            {
              src: '/brands/acme-field/pages/getting-started.png',
              alt: 'Acme getting-started checklist',
            },
          ],
        },
      ],
    },
  ],
  tools: [
    {
      id: 'notes',
      label: 'Notes',
      icon: '/brands/acme-field/icons/notes.svg',
      note: 'Before your next visit',
      items: ['Confirm the schedule', 'Bring the field checklist'],
    },
  ],
}
```

Register it in `src/core/brand-registry.ts`:

```ts
import { acmeFieldBrand } from '../brands/acme-field'
import { mineneBrand } from '../brands/minene'

// Keep the existing BrandRegistration type and buildBrandRegistry function above this list.
export const brandManifestEntries = [
  ['minene', mineneBrand],
  ['acme-field', acmeFieldBrand],
] as const satisfies readonly BrandRegistration[]

export const brandRegistry = buildBrandRegistry(brandManifestEntries)
```

Then run `pnpm validate:brands`, `pnpm test:run`, and review `/acme-field`. Registration is production-only: keep test fixtures such as `tests/fixtures/demo-brand.ts` out of production imports.
