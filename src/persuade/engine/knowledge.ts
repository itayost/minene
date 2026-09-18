import type { ArgumentCategory, BlockerId, Rung } from './types'

/**
 * The persuasion knowledge base, distilled from Eran's model.
 * Hebrew, because that is the language the engine speaks and the register it was designed for.
 */

export interface BlockerSpec {
  id: BlockerId
  label: string
  signals: string[]
  useTools: string[]
  avoid: string
}

/** "Do not try to persuade before you understand why the person is not moving." */
export const BLOCKERS: BlockerSpec[] = [
  {
    id: 'no_why',
    label: 'לא מבין למה',
    signals: ['בשביל מה צריך את זה', 'למה זה חשוב', 'לא ברור לי מה זה נותן'],
    useTools: ['תועלת אישית', 'תועלת לארגון'],
    avoid: 'לא להתחיל באכיפה. הוא עדיין לא קנה את הרעיון.',
  },
  {
    id: 'no_price',
    label: 'לא רואה מחיר',
    signals: ['לא נורא אם לא נעשה', 'מסתדרים גם ככה'],
    useTools: ['מחיר אי עשייה', 'מספרים'],
    avoid: 'לא לאיים. להמחיש הפסד, לא עונש.',
  },
  {
    id: 'overloaded',
    label: 'עמוס',
    signals: ['אין לי זמן', 'אין לי שנייה', 'יום מטורף', 'קרטונים', 'חג'],
    useTools: ['אמפתיה', 'פירוק עומס', 'זמן במספרים', 'התחלה קטנה'],
    avoid: 'לא להגיד "זה רק כמה דקות" לפני שהכרת בעומס.',
  },
  {
    id: 'dont_know_how',
    label: 'לא יודע איך',
    signals: ['אבל איך עושים את זה', 'מה אני אמור להגיד', 'איך זה נראה בפועל'],
    useTools: ['מנוע האיך', 'שניים עד ארבעה צעדים', 'סקריפט מוכן'],
    avoid: 'להפסיק לשכנע. הוא כבר משוכנע, הוא תקוע ב"איך".',
  },
  {
    id: 'thinks_already_doing',
    label: 'חושב שהוא כבר עושה',
    signals: ['אני כבר עושה את זה', 'מדי פעם', 'על הדרך', 'תמיד'],
    useTools: ['מדידה במקום תחושה', 'לשאול מספר מדויק לשבוע האחרון'],
    avoid: 'לא להתווכח. לבקש מספר.',
  },
  {
    id: 'vague_definition',
    label: 'ההגדרה מעורפלת',
    signals: ['מה זה מקצוענות בכלל', 'מה זה שירות טוב'],
    useTools: ['עשה ואל תעשה', 'מקרים ותגובות', 'מי מה ומתי'],
    avoid: 'לא לחזור על מושג מופשט. לפרק להתנהגות.',
  },
  {
    id: 'disagrees',
    label: 'לא מסכים',
    signals: ['אני לא מאמין בזה', 'זה שטויות', 'כבר ניסינו וזה לא עבד'],
    useTools: ['מותר לא להסכים', 'בקשת חלופה טובה יותר', 'היגיון מעל היררכיה'],
    avoid: 'לא ללחוץ בסמכות. לבקש את ההיגיון שלו.',
  },
  {
    id: 'afraid',
    label: 'מפחד',
    signals: ['לא נעים לי', 'מה הם יגידו', 'אני מעדיף לא'],
    useTools: ['דיבור פנימי', 'גוף ונשימה', 'פעולה קטנה אחת'],
    avoid: 'לא לזלזל בפחד.',
  },
  {
    id: 'low_confidence',
    label: 'חסר ביטחון',
    signals: ['אני לא טובה בזה', 'אני לא יודעת להדריך'],
    useTools: ['הצלחה קטנה', 'חיזוק מיידי', 'דוגמה אישית'],
    avoid: 'לא להעמיס יעד גדול.',
  },
  {
    id: 'low_energy',
    label: 'אנרגיה נמוכה',
    signals: ['אין לי כוח', 'יום קשה', 'תשובות של מילה אחת'],
    useTools: ['לבדוק מה שלומו', 'לקצר', 'משימה קטנה יותר'],
    avoid: 'לא להעמיס טיעונים.',
  },
  {
    id: 'overwhelmed',
    label: 'מוצף ממש',
    signals: ['אין לי כוח לכלום', 'אני בקושי מחזיק'],
    useTools: ['היום לא מדברים על עבודה', 'לשמור על האדם'],
    avoid: 'לא לדחוף משימה היום. אמון לפני תפוקה.',
  },
  {
    id: 'agrees_no_action',
    label: 'מסכים אבל לא עושה',
    signals: ['כן כן', 'בטח', 'מחר', 'אשתדל'],
    useTools: ['התחייבות מדויקת', 'מתי מתחילים', 'מעקב'],
    avoid: 'להפסיק לשכנע. הוא כבר אמר כן.',
  },
  {
    id: 'repeated_no_action',
    label: 'שוב ושוב לא מבצע',
    signals: ['לא יצא לי', 'שכחתי', 'היה עמוס'],
    useTools: ['בקרה', 'טבלת ביצוע', 'אסרטיביות', 'ציפייה ברורה'],
    avoid: 'לא לחזור על אותו טיעון בפעם הרביעית.',
  },
  {
    id: 'refuses_role',
    label: 'מסרב לחלק מהתפקיד',
    signals: ['אני לא עושה מכירות', 'זה לא התפקיד שלי'],
    useTools: ['הגדרת תפקיד', 'הסכם העסקה', 'גבול ניהולי'],
    avoid: 'לא לוותר, אבל גם לא לאיים בפיטורים בשיחה ראשונה.',
  },
  {
    id: 'unclear_request',
    label: 'לא הבין מה מבקשים',
    signals: ['מה בדיוק אתה רוצה ממני', 'לא הבנתי מה לעשות'],
    useTools: ['בקשה אחת ברורה שאפשר לצלם'],
    avoid: 'לעצור הכול ולנסח מחדש. זו אשמת המשכנע.',
  },
  {
    id: 'wants_autonomy',
    label: 'צריך עצמאות',
    signals: ['אל תגידו לי מה לעשות', 'אני יודע לנהל את החנות שלי'],
    useTools: ['בחירה בין שתי אפשרויות', 'בקשת חלופה', 'שותפות'],
    avoid: 'לא פקודות. לא "חייב".',
  },
  {
    id: 'skeptical',
    label: 'ספקן',
    signals: ['מי אמר שזה עובד', 'יש נתונים', 'לא בטוח'],
    useTools: ['מספרים', 'דוגמה מחנות אחרת', 'לחץ חברתי חיובי', 'ניסוי קצר'],
    avoid: 'לא הצהרות כלליות.',
  },
  {
    id: 'wants_to_quit',
    label: 'רוצה להרים ידיים',
    signals: ['נמאס לי', 'אני מוותר', 'זה לא בשבילי'],
    useTools: ['שכנוע להתמדה', 'חזרה ללמה התחלת', 'להקטין ולא לנתק רצף'],
    avoid: 'לא להגיד "אין דבר כזה אין כוח". להיות אמפתי וחד.',
  },
]

export const BLOCKER_LOOKUP: Record<string, BlockerSpec> = Object.fromEntries(
  BLOCKERS.map((b) => [b.id, b]),
)

/** Argument order matters: personal interest first, organization second. */
export const ARGUMENT_ORDER: ArgumentCategory[] = [
  'personal_benefit',
  'emotional_benefit',
  'career_money',
  'less_work_later',
  'values_culture',
  'org_benefit',
  'numbers',
  'social_proof',
  'role_standard',
  'cost_of_inaction',
  'authority',
]

export const ARGUMENT_LABELS: Record<ArgumentCategory, string> = {
  personal_benefit: 'תועלת אישית',
  emotional_benefit: 'תועלת רגשית',
  career_money: 'קריירה וכסף',
  less_work_later: 'פחות עבודה בהמשך',
  org_benefit: 'תועלת לארגון',
  values_culture: 'ערכים ותרבות',
  role_standard: 'סטנדרט והגדרת תפקיד',
  cost_of_inaction: 'מחיר אי עשייה',
  numbers: 'מספרים',
  social_proof: 'לחץ חברתי חיובי',
  authority: 'סמכות ושליחות',
}

export const RUNG_LABELS: Record<Rung, string> = {
  1: 'שכנוע חיובי',
  2: 'חד יותר',
  3: 'סטנדרט ותפקיד',
  4: 'מחיר ובקרה',
  5: 'גבול ניהולי',
}

/** What each of the four interactions is for. Interaction 4 must force a decision. */
export const INTERACTION_PLAN: Record<number, string> = {
  1: 'בקשה ברורה + תועלת אישית חזקה. לא לשאול שאלות לפני שאמרת מה אתה רוצה.',
  2: 'לזהות את החסם ולתת תשובה קצרה אחת.',
  3: 'טיעון חזק יותר: מספרים, כסף, קריירה, סטנדרט, מחיר.',
  4: 'חתירה להחלטה. "מתחייב או לא? אם לא, תגיד למה ואעביר הלאה."',
}

/** Hebrew closure/fatigue markers. Short, non-committal, or shrinking replies. */
export const FATIGUE_MARKERS = [
  'בסדר',
  'סבבה',
  'נראה',
  'אולי',
  'עזוב',
  'הבנתי',
  'טוב',
  'יאללה',
  'נדבר',
  'בהמשך',
  'אחר כך',
  'אחכ',
  'נשתמע',
  'אשתדל',
  'אוקיי',
  'אוקי',
  'ok',
]

export const COMMITMENT_MARKERS = [
  'סגור',
  'אני מתחייב',
  'עושה את זה',
  'אני איתך',
  'מקבל',
  'שוכנעתי',
  'מסכים',
  'נעשה',
  'מתחילים',
  'בוא ננסה',
  'מוכן לנסות',
  'כן כן',
]

export const REFUSAL_MARKERS = [
  'לא מסכים',
  'לא מתחייב',
  'לא מקבל',
  'לא מאמין בזה',
  'לא אעשה',
  'לא הולך לעשות',
  'זה לא התפקיד שלי',
]

/**
 * A yes with nothing behind it.
 *
 * "כן כן, מחר" is the product spec's own example of the failure this engine
 * exists to prevent: agreement that never became execution. A commitment marker
 * next to one of these, with no concrete start, is a deferral.
 */
export const VAGUE_COMMITMENT_MARKERS = [
  'כן כן',
  'מחר',
  'אשתדל',
  'בקרוב',
  'נראה מה יהיה',
  'אחר כך',
  'בהמשך',
  'נסתדר',
]

/** A time you could put in a calendar. A vague yes next to one of these is a real yes. */
export const CONCRETE_TIME_MARKERS = [
  'בשעה',
  'בבוקר',
  'בערב',
  'לפני הפתיחה',
  'אחרי הסגירה',
  'ביום ראשון',
  'ביום שני',
  'ביום שלישי',
  'ביום רביעי',
  'ביום חמישי',
  'בתשע',
  'בעשר',
  'בשמונה',
]

export const MAX_INTERACTIONS = 4

/**
 * WhatsApp lengths, not memo lengths.
 *
 * These were 15 and 45. Forty-five Hebrew words is four or five lines on a
 * phone -- a paragraph, and the field report called it exactly that: "התשובות
 * ארוכות לפעמים... צריך תשובות משני הצדדים קצרות ומידיות, כמו במציאות".
 *
 * The counterpart persona has always been told 5 to 20 words, because that is
 * what a busy person actually types. The persuader was held to more than twice
 * that, which is what made the two sides of the same conversation read as a
 * consultant answering a shift manager. One standard now covers both.
 *
 * Both are still `RuleConfig` fields and both are still editable on the rules
 * page: these are the defaults, not the ceiling.
 */
export const MAX_WORDS_PER_SENTENCE = 12
export const MAX_WORDS_PER_MESSAGE = 25
export const MAX_ARGUMENTS_PER_TURN = 2
