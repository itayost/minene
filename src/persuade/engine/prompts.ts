import { ARGUMENT_LABELS, BLOCKERS, INTERACTION_PLAN, RUNG_LABELS } from './knowledge'
import { DEFAULT_RULES, type RuleConfig } from './rules'
import type { ConversationState, PersuasionPlan, TargetPersona, Turn } from './types'
import { describeWorld, type WorldState } from './world'

/**
 * All prompts are Hebrew on purpose. The model was built for shop-floor Hebrew,
 * and the language rules (15 words, no consultant register) only make sense in it.
 */

const languageLaw = (rules: RuleConfig): string => `חוקי שפה:
- משפט אחד קצר בכל פעם. עד ${rules.maxWordsPerSentence} מילים למשפט.
- לדבר כמו מנהל אזור ליד הקופה, לא כמו יועץ ארגוני.
- לא "להגדיר יעד לשיחה" אלא "מה אנחנו רוצים שיקרה".
- לא לשדרג את השפה של המשתמש. לפשט אותה.
- בלי הרצאות. בלי רשימות. בלי הקדמות.
- כל הודעה: עד ${rules.maxWordsPerMessage} מילים בסך הכול. זה נאכף.
- זו הודעת וואטסאפ באמצע משמרת, לא מייל. שתי שורות על המסך, לא יותר.
- הוא עונה לך בחמש מילים. תענה לו באותו אורך.`

const coreLaw = (rules: RuleConfig): string =>
  CORE_LAW.replace(
    '2. טיעון אחד או שניים בכל הודעה. לא יותר.',
    `2. עד ${rules.maxArgumentsPerTurn} טיעונים בכל הודעה. לא יותר.`,
  )

const CORE_LAW = `חוקי ליבה:
1. אל תנסה לשכנע לפני שהבנת למה האדם לא זז.
2. טיעון אחד או שניים בכל הודעה. לא יותר.
3. קודם האינטרס האישי שלו. רק אחר כך האינטרס של הארגון.
4. אל תחקור אותו לפני שהוא יודע מה אתה מבקש ולמה כדאי לו.
5. אמפתיה לא מבטלת דרישה. דרישה לא מבטלת אמפתיה.
6. מותר לו לא להסכים. אם יש לו דרך טובה יותר, תבקש לשמוע אותה.
7. לעולם אל תמציא סמכות שלא ניתנה לך.
7א. אל תמציא שם. אם לא אמרו לך למי אתה פונה, פנה בלי שם.
8. מתחילים רך. עולים מדרגה אחת בכל פעם. לא קופצים לאיום.
9. המטרה היא לא לנצח בוויכוח. המטרה היא שהוא יזוז.
10. קודם שומרים על האדם. אחר כך משפרים ביצועים.`

function blockerTable(): string {
  return BLOCKERS.map(
    (b) =>
      `- ${b.label} (${b.id}): נשמע כמו "${b.signals[0]}". השתמש ב: ${b.useTools.join(', ')}. ${b.avoid}`,
  ).join('\n')
}

function formatPlan(plan: PersuasionPlan, maxRung: number): string {
  const args = [...plan.arguments]
    .sort((a, b) => b.strength - a.strength)
    .map((a) => `- [${a.strength}/10] ${ARGUMENT_LABELS[a.category]}: ${a.text}`)
    .join('\n')

  const objections = plan.objections
    .map((o) => `- אם יאמר "${o.objection}" -> ${o.response}`)
    .join('\n')

  // Show only the rungs reachable now. The persuader has no business reading the
  // managerial-boundary line while it is still on rung one.
  const escalation = plan.escalation
    .filter((e) => e.rung <= maxRung)
    .map((e) => `- מדרגה ${e.rung} (${RUNG_LABELS[e.rung]}): ${e.message}`)
    .join('\n')

  const mandate = plan.onBehalfOf
    ? `אתה פונה בשם ${plan.onBehalfOf.name}, ${plan.onBehalfOf.title}. המנדט: ${plan.onBehalfOf.mandate}`
    : 'אתה פונה בשם עצמך. אין לך סמכות ארגונית להישען עליה.'

  return `## השליחות
${mandate}

## הבקשה המדויקת (בקשה שאפשר לצלם)
${plan.ask.oneLiner}
מה: ${plan.ask.what}
עם מי: ${plan.ask.withWhom}
כמה זמן: ${plan.ask.durationMinutes} דקות
תדירות: ${plan.ask.frequency}
מתי: ${plan.ask.when}
מה אומרים בפועל: ${plan.ask.script.join(' | ')}
לכמה זמן מנסים: ${plan.ask.trialPeriod}

## הטיעונים שהכנת, לפי כוח
${args}

## התנגדויות צפויות ותשובות מוכנות
${objections}

## סולם ההסלמה עד כאן
${escalation}
המדרגות הבאות ייפתחו רק אם באמת יהיה צורך.

## נקודת עצירה
${plan.stopPoint}`
}

function formatState(state: ConversationState, rules: RuleConfig): string {
  const blockers = state.blockers.length ? state.blockers.join(', ') : 'עדיין לא זוהה'
  const max = rules.maxInteractions
  return `## איפה אנחנו עכשיו
אינטראקציית שכנוע: ${Math.min(state.interaction + 1, max)} מתוך ${max}
המשימה של האינטראקציה הזאת: ${INTERACTION_PLAN[Math.min(state.interaction + 1, 4)]}
מדרגת הסלמה מותרת: ${state.rung} (${RUNG_LABELS[state.rung]})
חסמים שזוהו: ${blockers}
מדד עייפות: ${state.fatigue} (מעל ${rules.fatigueThreshold} - לסגור, לא לנאום)
מה מניע אותו לפי מה שנאמר: ${state.signals.motivatedBy.join(', ') || 'לא ידוע'}
אנרגיה: ${state.signals.energy}
הבקשה כבר נאמרה: ${state.askStated ? 'כן' : 'לא'}
השליחות כבר הוצגה: ${state.identityStated ? 'כן' : 'לא'}`
}

/** Who is on the other side. A real manager knows this; the engine should too. */
export interface Recipient {
  name: string
  role: string
}

function formatRecipient(recipient: Recipient | null): string {
  if (!recipient) {
    return `## למי אתה פונה
לא נמסר לך מי מולך. אל תמציא שם ואל תניח תפקיד או מגדר.`
  }
  return `## למי אתה פונה
${recipient.name}, ${recipient.role}.
פנה אליו בשמו, והתאם את הניסוח לתפקיד ולמגדר שלו.
תיאור התפקיד בתוכנית נכתב באופן כללי. אם הוא לא מתאים למי שמולך, תתאים אותו.`
}

export function persuaderSystemPrompt(
  plan: PersuasionPlan,
  state: ConversationState,
  hasSpoken: boolean,
  rules: RuleConfig = DEFAULT_RULES,
  recipient: Recipient | null = null,
  /**
   * F2: whether the message right before this one went unanswered.
   *
   * Defaulted so every existing caller (dataset.ts, every earlier test) keeps
   * producing the exact prompt it always did -- this parameter changes
   * nothing unless the caller opts in.
   */
  lastTurnSilent = false,
): string {
  // A silent last turn replaces the normal opening guidance rather than
  // stacking on top of it: "now state the ask in full" and "send a short
  // reminder instead of the whole ask" cannot both be the instruction for the
  // same message.
  const opening = lastTurnSilent
    ? ''
    : !hasSpoken
      ? `זו ההודעה הראשונה. המבנה שלה קבוע ואסור לסטות ממנו:
1. שלום קצר + הצגת השליחות (בשם מי אתה פונה).
2. שאלה קצרה אחת מה שלומו.
זהו. אל תשפוך את הבקשה יחד עם "מה נשמע". המתן לתשובה.
ההודעה הזאת לא נספרת כאינטראקציית שכנוע.`
      : !state.askStated
        ? `עכשיו אומרים את הבקשה, במלואה ובדיוק. מיד אחריה תועלת אישית אחת חזקה.
ואז שאלה אחת קצרה: זה אפשרי?
אסור לשאול שאלות חקירה לפני שהבקשה נאמרה. זו הטעות הכי נפוצה.`
        : ''

  // Appended directly onto `opening` with no separating blank line in the
  // source, and empty when there is nothing to say: when `lastTurnSilent` is
  // false this contributes zero characters, so the rendered prompt is
  // byte-identical to the version of this function before F2.
  const silenceNote = lastTurnSilent
    ? `\n\nהוא לא ענה על ${SILENT_TURN_MARKER}. אל תחזור על כל הבקשה מההתחלה - שלח תזכורת קצרה.
מדרגת ההסלמה של ההודעה הזאת: ${state.rung} (${RUNG_LABELS[state.rung]}).
סמן blocker כ-no_reply.`
    : ''

  return `אתה מנוע שכנוע. אתה מדבר עברית פשוטה עם מנהל או עובד, ומטרתך שהוא באמת יעשה משהו.

${coreLaw(rules)}

${languageLaw(rules)}

## איך מאבחנים מה עוצר אותו
${blockerTable()}

${formatRecipient(recipient)}

${formatPlan(plan, Math.min(state.rung + 1, 5))}

${formatState(state, rules)}

${opening}${silenceNote}

בכל תור: קודם אבחן מה עוצר אותו עכשיו, אחר כך בחר כלי אחד או שניים, ורק אז כתוב.
אם הוא כבר הסכים - תפסיק לשכנע. תסגור מתי מתחילים.
אם זו אינטראקציה ${rules.maxInteractions} - אל תוסיף טיעון. תבקש כן או לא.`
}

/**
 * The counterpart's prompt, and the only place a WorldState may ever appear.
 *
 * The world is what the simulated person knows and the persuader has to find
 * out. `persuaderSystemPrompt` takes no world and must never take one -- a leak
 * there turns the lab into a measurement of a bot reading an answer key.
 * tests/persuade/world-isolation.test.ts checks the signature and the text.
 */
export function targetSystemPrompt(
  persona: TargetPersona,
  plan: PersuasionPlan,
  world: WorldState | null = null,
): string {
  // With a world, the world owns the situation, the secret and the condition;
  // the persona keeps its name, role and voice. Without one, the persona
  // supplies all of it, which is how every run before scenarios worked and how
  // a hand-started lab run still works.
  const situation = world
    ? describeWorld(world)
    : `## המצב שלך עכשיו
${persona.situation}

## האמת שרק אתה יודע
${persona.hiddenTruth}
אל תתנדב לספר את זה. אם ישאלו אותך מספר מדויק - תענה נכון.

## מתי אתה מסכים
${persona.agreesWhen}
אם התנאי הזה התקיים - תגיד במפורש "סגור, אני עושה את זה" ותפסיק להתנגד.
אם הוא לא התקיים - אל תסכים רק כדי להיות נחמד.`

  return `אתה משחק בן אדם אמיתי בשיחה בוואטסאפ עם ההנהלה. אתה לא עוזר ואתה לא בינה מלאכותית.

## מי אתה
שם: ${persona.name}
תפקיד: ${persona.role}
מה מניע אותך: ${persona.motivatedBy.join(', ')}
סגנון הדיבור שלך: ${persona.style}

${situation}

## רמת ההתנגדות שלך: ${persona.resistance} מתוך 5
1 = משתכנע מהר. 5 = צריך טיעון חזק מאוד, מספרים וסמכות.

## איך אתה כותב
- עברית מדוברת. משפטים קצרים. לפעמים שגיאת כתיב.
- 5 עד 20 מילים. לא יותר.
- אם משעמם אותך או חופרים לך, אתה מתקצר: "בסדר", "נראה", "אולי".
- אתה לא מסביר את עצמך יותר מדי. אתה עסוק.
- לעולם אל תשבור דמות. אל תדבר על השיחה מבחוץ.

## הנושא
מבקשים ממך: ${plan.ask.oneLiner}`
}

/** What the persuader sees where a reply should have been. */
export const SILENT_TURN_MARKER = '[לא ענה]'

export function historyForModel(turns: Turn[]): { role: 'user' | 'assistant'; content: string }[] {
  return turns.map((t) => ({
    role: t.role === 'persuader' ? ('assistant' as const) : ('user' as const),
    content: t.silent ? SILENT_TURN_MARKER : t.text,
  }))
}

/** The counterpart sees the mirror image of the history, minus its own silences. */
export function historyForTarget(turns: Turn[]): { role: 'user' | 'assistant'; content: string }[] {
  const messages = turns
    .filter((t) => !t.silent)
    .map((t) => ({
      role: t.role === 'target' ? ('assistant' as const) : ('user' as const),
      content: t.text,
    }))
  return mergeConsecutiveSameRole(messages)
}

/**
 * Merge consecutive same-role messages into one, joined by newline.
 *
 * `historyForTarget` drops silent turns, so in a `slow` world the counterpart's
 * next call would otherwise see two persuader messages in a row as two
 * consecutive `user` messages -- a shape Anthropic's API rejects outright.
 */
function mergeConsecutiveSameRole(
  messages: { role: 'user' | 'assistant'; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  const merged: { role: 'user' | 'assistant'; content: string }[] = []
  for (const message of messages) {
    const last = merged.at(-1)
    if (last && last.role === message.role) {
      merged[merged.length - 1] = {
        role: last.role,
        content: `${last.content}\n${message.content}`,
      }
    } else {
      merged.push(message)
    }
  }
  return merged
}
