import type { ArgumentCategory, BlockerId } from './engine/types'

/**
 * Hebrew for the engine's vocabulary.
 *
 * The engine speaks in identifiers because they are stable across a rename; a
 * screen has to speak in words. Kept here rather than in a component so the
 * matrix, the bank and the conversation cannot disagree about what a blocker is
 * called.
 */
export const CATEGORY_LABELS: Record<ArgumentCategory, string> = {
  personal_benefit: 'תועלת אישית',
  emotional_benefit: 'תועלת רגשית',
  career_money: 'קריירה וכסף',
  less_work_later: 'פחות עבודה בהמשך',
  org_benefit: 'תועלת ארגונית',
  values_culture: 'ערכים ותרבות',
  role_standard: 'סטנדרט התפקיד',
  cost_of_inaction: 'מחיר אי-עשייה',
  numbers: 'מספרים',
  social_proof: 'הוכחה חברתית',
  authority: 'סמכות',
}

export const BLOCKER_LABELS: Record<BlockerId, string> = {
  no_why: 'לא מבינה למה',
  no_price: 'לא רואה מחיר',
  overloaded: 'עמוסה מדי',
  dont_know_how: 'לא יודעת איך',
  thinks_already_doing: 'חושבת שכבר עושה',
  vague_definition: 'הגדרה מעורפלת',
  disagrees: 'לא מסכימה',
  afraid: 'מפחדת',
  low_confidence: 'ביטחון נמוך',
  low_energy: 'אנרגיה נמוכה',
  overwhelmed: 'מוצפת',
  agrees_no_action: 'מסכימה ולא עושה',
  repeated_no_action: 'שוב לא עשתה',
  refuses_role: 'מסרבת לתפקיד',
  unclear_request: 'הבקשה לא ברורה',
  wants_autonomy: 'רוצה אוטונומיה',
  skeptical: 'סקפטית',
  wants_to_quit: 'רוצה לעזוב',
  no_reply: 'לא ענתה',
  none: 'ללא חסם',
}
