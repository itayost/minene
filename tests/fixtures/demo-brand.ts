import type { BrandManifest } from '../../src/core/brand-types'

export const demoBrand: BrandManifest = {
  id: 'demo',
  name: 'Demo brand',
  title: 'Demo content viewer',
  locale: 'en-US',
  direction: 'ltr',
  logo: { src: '/brands/demo/logo.svg', alt: 'Demo brand logo' },
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
    back: 'Return to previous screen',
    navigation: 'Demo destinations',
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
      id: 'single',
      label: 'Single subject',
      icon: '/brands/demo/single.svg',
      cardColor: '#EDF5FF',
      groups: [
        {
          id: 'only-group',
          label: 'Only group',
          pages: [{ src: '/brands/demo/only-page.png', alt: 'Only page' }],
        },
      ],
    },
    {
      id: 'multiple',
      label: 'Multiple subject',
      icon: '/brands/demo/multiple.svg',
      cardColor: '#E4EEFC',
      groups: [
        {
          id: 'group-one',
          label: 'Group one',
          icon: '/brands/demo/group-one.svg',
          pages: [{ src: '/brands/demo/group-one-page.png', alt: 'Group one page' }],
        },
        {
          id: 'group-two',
          label: 'Group two',
          icon: '/brands/demo/group-two.svg',
          pages: [{ src: '/brands/demo/group-two-page.png', alt: 'Group two page' }],
        },
        {
          id: 'group-three',
          label: 'Group three',
          icon: '/brands/demo/group-three.svg',
          pages: [{ src: '/brands/demo/group-three-page.png', alt: 'Group three page' }],
        },
      ],
    },
  ],
  tools: [
    {
      id: 'notes',
      label: 'Notes',
      icon: '/brands/demo/notes.svg',
      note: 'Ideas to discuss',
      items: ['First idea', 'Second idea'],
    },
  ],
}
