export type VideoTopic = 'sales' | 'product' | 'service' | 'energy' | 'encourage' | 'other'
export type VideoGoal = 'upsell' | 'smile' | 'know-product' | 'arrive-energised' | 'love-the-work'
export type VideoStyle = 'encouraging' | 'energetic' | 'professional'
export type VideoLength = 10 | 20 | 30

export type Choice<T> = { id: T; label: string }

/** Step 1: what the video is about. */
export const VIDEO_TOPICS: readonly Choice<VideoTopic>[] = [
  { id: 'sales', label: 'מכירות' },
  { id: 'product', label: 'מוצר' },
  { id: 'service', label: 'שירות' },
  { id: 'energy', label: 'אנרגיות' },
  { id: 'encourage', label: 'עידוד' },
  { id: 'other', label: 'אחר' },
]

/** Step 2: the change it should produce. */
export const VIDEO_GOALS: readonly Choice<VideoGoal>[] = [
  { id: 'upsell', label: 'שיציעו מוצר נוסף' },
  { id: 'smile', label: 'שיחייכו יותר' },
  { id: 'know-product', label: 'שיכירו מוצר' },
  { id: 'arrive-energised', label: 'שיגיעו באנרגיה' },
  { id: 'love-the-work', label: 'שיאהבו את מה שהן עושות' },
]

/** Step 3 carries two choices rather than one: a style and a length. */
export const VIDEO_STYLES: readonly Choice<VideoStyle>[] = [
  { id: 'encouraging', label: 'מעודד' },
  { id: 'energetic', label: 'אנרגטי' },
  { id: 'professional', label: 'מקצועי' },
]

export const VIDEO_LENGTHS: readonly Choice<VideoLength>[] = [
  { id: 10, label: '10 שניות' },
  { id: 20, label: '20 שניות' },
  { id: 30, label: '30 שניות' },
]

export type VideoBrief = {
  topic: VideoTopic
  goal: VideoGoal
  style: VideoStyle
  length: VideoLength
}

const label = <T,>(list: readonly Choice<T>[], id: T) =>
  list.find((choice) => choice.id === id)?.label ?? String(id)

/** Reads a completed brief back to the reader in their own words. */
export function describeBrief(brief: VideoBrief): string {
  return [
    label(VIDEO_TOPICS, brief.topic),
    label(VIDEO_GOALS, brief.goal),
    label(VIDEO_STYLES, brief.style),
    label(VIDEO_LENGTHS, brief.length),
  ].join(' · ')
}
