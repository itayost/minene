import type { Topic } from './types'

/**
 * The rule vocabulary, and NOT the brand's subjects.
 *
 * These two look alike and must never be merged. A brand subject drives the
 * content viewer and comes from the brand manifest; a topic classifies a rule
 * and is constrained in the database by rules_topic_id_check. Sub-project 1
 * decided deliberately that both vocabularies coexist.
 */
export const RULE_TOPICS: readonly Topic[] = [
  { id: 'live', title: 'תזכורת לחיות', lines: ['נשימה • פרופורציה', 'הכרת תודה • משפחה'] },
  { id: 'store', title: 'בדקי נראות חנות', lines: ['כניסה • חלון • קופה', 'מדפים • סדר • ניקיון'] },
  { id: 'numbers', title: 'המספרים שלי', lines: ['יעד • מכירות • סל קנייה', 'פריטים בסל • המרה'] },
  { id: 'energy', title: 'תטעיני אותי', lines: ['רוגע • ביטחון', 'פוקוס • אנרגיה'] },
  { id: 'team-energy', title: 'אנרגיות לצוות', lines: ['פרגון • חיוך', 'מוזיקה • הרמת הצוות'] },
  { id: 'briefing', title: 'תדריך צוות', lines: ['4 דקות', 'מוצר • מכירה • שירות'] },
  { id: 'performance', title: 'שעוני ביצועים', lines: ['פר עובד', 'מקצוענות • אנרגיות • חיוך'] },
] as const

export function getTopic(topicId: string): Topic | undefined {
  return RULE_TOPICS.find((topic) => topic.id === topicId)
}
