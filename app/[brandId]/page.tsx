import { requireBrand } from '../../src/auth/require-brand'
import { MentorBar } from './cockpit/mentor-bar'
import { ToolsGrid } from './cockpit/tools-grid'

type BrandHomeParams = { params: Promise<{ brandId: string }> }

export default async function BrandHomePage({ params }: BrandHomeParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  /* Two columns, four rows, in DOM order -- which in RTL fills right to left.
     Built per request so the cards that have a screen can carry this brand's
     path; the rest say they are not connected yet when pressed.

     Three of them are now the only way to reach their tool: the bottom nav that
     used to carry קמפיינר, משכנע and מוח ארגני is gone.

     Every card carries a line saying what it does. Eight titles on their own
     are eight guesses, and the subtitle is the half that makes one choosable. */
  const tools = [
    {
      title: 'חיים אישיים',
      subtitle: 'האיזון, האנרגיה והזמן שלך',
      icon: '/brands/minene/icons/home-tools/personal-life.png',
    },
    {
      title: 'תוכנית ופרויקט',
      subtitle: 'לבנות תוכנית ופרויקט לחנות',
      icon: '/brands/minene/icons/home-tools/plan-project.png',
    },
    {
      title: 'לנתח נתונים',
      subtitle: 'מה המספרים אומרים על החנות',
      icon: '/brands/minene/icons/home-tools/data-analysis.png',
    },
    {
      /* One card, not two. Creating a training video and creating a training
         image are the same errand with a different output, and the icon set was
         drawn for this: training-media.png existed unused while create-video
         and create-image split the job between them. */
      title: 'הדרכה: סרטון, תמונה',
      subtitle: 'סרטון או תמונה להדרכת הצוות',
      icon: '/brands/minene/icons/home-tools/training-media.png',
      href: `/${brand.id}/tools/campaign`,
    },
    {
      title: 'עידוד ושכנוע',
      subtitle: 'חיזוק, הכרה ומסר שמזיז לפעולה',
      icon: '/brands/minene/icons/home-tools/encouragement-persuasion.png',
      href: `/${brand.id}/tools/persuade`,
    },
    {
      title: 'תרגילי הדרכה',
      subtitle: 'תרגול קצר שמטמיע בפועל',
      icon: '/brands/minene/icons/home-tools/training-exercises.png',
    },
    {
      title: 'מנטורינג לעובדות',
      subtitle: 'שיחה אישית עם כל עובדת',
      icon: '/brands/minene/icons/home-tools/employee-mentoring.png',
    },
    {
      /* The brain is also in the bottom nav. Both stay: the nav is how you get
         back to it from anywhere, and the card is how you meet it while
         reading what this screen offers. */
      title: 'ספר ארגוני ומוח',
      subtitle: 'הידע הארגוני והמוח של החנות',
      icon: '/brands/minene/icons/home-tools/organizational-book-brain.png',
      href: `/${brand.id}/tools/brain`,
    },
  ] as const

  return (
    <div className="cockpit" dir="rtl">
      <section aria-labelledby="tools-title" className="cockpit-tools">
        <header className="cockpit-tools__header">
          <h2 id="tools-title">קוקפיט מנהלת</h2>
          <p>כל מה שמנהלת צריכה, במקום אחד</p>
        </header>

        <ToolsGrid tools={tools} />
      </section>

      <MentorBar />
    </div>
  )
}
