export type CockpitAction = {
  number: number
  title: string
  subtitle: string
  /** Not shown on the card. It is the action's own copy, for its screen. */
  description: string
  cardColor: string
  accent: string
  icon: string
  /** Absent means the flow is not built yet, and the card says so. */
  slug?: string
}

/**
 * The eight things a shop manager can ask the co-manager to do. Copy is taken
 * verbatim from the cockpit sheet: it is the product, not placeholder text.
 *
 * Only the first has a flow. The rest render with their copy and are visibly
 * unavailable rather than linking somewhere that 404s -- a card that looks live
 * and then fails reads as a broken app. `לשכנע` is deliberately left alone
 * rather than stubbed, because the persuader is its own piece of work.
 */
export const COCKPIT_ACTIONS: readonly CockpitAction[] = [
  {
    number: 1,
    icon: '/brands/minene/icons/cockpit/create-training-video.png',
    title: 'ליצור',
    subtitle: 'סרטון הדרכה',
    description: 'צרי סרטון לעובדות על מוצר, מכירות, שירות, אנרגיות או כל מסר שחשוב לך.',
    cardColor: '#f3f0fd',
    accent: '#5b3fd6',
    slug: 'video',
  },
  {
    number: 2,
    icon: '/brands/minene/icons/cockpit/create-training-image.png',
    title: 'ליצור',
    subtitle: 'תמונת הדרכה',
    description: 'הפכי מסר אחד לתמונה פשוטה וברורה שאפשר לשלוח מיד לצוות.',
    cardColor: '#fdf0f6',
    accent: '#e8368f',
  },
  {
    number: 3,
    icon: '/brands/minene/icons/cockpit/encourage-employees.png',
    title: 'לעודד',
    subtitle: 'את העובדות',
    description: 'פירגון, מוטיבציה, אנרגיות, חיזוק ביטחון או מסר לפתיחת ויום.',
    cardColor: '#fdf6ee',
    accent: '#e8368f',
  },
  {
    number: 4,
    icon: '/brands/minene/icons/cockpit/persuade.png',
    title: 'לעשות',
    subtitle: 'לשכנע',
    description: 'מה החסם של העובדת? איך לרתום אותה לפעולה שאני רוצה.',
    cardColor: '#eaf7f5',
    accent: '#12897e',
  },
  {
    number: 5,
    icon: '/brands/minene/icons/cockpit/analyze.png',
    title: 'לעשות',
    subtitle: 'לנתח',
    description: 'משהו לא עובד? למה? מה הסיבות? במה כדאי לטפל?',
    cardColor: '#eef4fb',
    accent: '#2f6fb5',
  },
  {
    number: 6,
    icon: '/brands/minene/icons/cockpit/team-exercise.png',
    title: 'לעשות',
    subtitle: 'תרגיל לצוות',
    description: 'תרגיל טיל, אנרגיות, שפת גוף, ביטחון עצמי או פינג-פונג מוצרים.',
    cardColor: '#fdf5e8',
    accent: '#e0912a',
  },
  {
    number: 7,
    icon: '/brands/minene/icons/cockpit/employee-conversation.png',
    title: 'לעשות',
    subtitle: 'בשיחה עם עובדת',
    description: 'הכנה לשיחה, משוב, גבולות, שימור, גיוס או התמודדות עם קושי.',
    cardColor: '#f3f0fd',
    accent: '#5b3fd6',
  },
  {
    number: 8,
    icon: '/brands/minene/icons/cockpit/personal-control.png',
    title: 'לעשות',
    subtitle: 'שליטה אישית',
    description: 'לעצור רגע בשבילי: אנרגיה, רוגע, עומס, נשימה, משפחה ואיך אני מגיעה ליום.',
    cardColor: '#eef7ee',
    accent: '#3f8f4a',
  },
] as const
