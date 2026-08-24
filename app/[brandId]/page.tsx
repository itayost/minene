import Image from "next/image";
import { requireBrand } from "../../src/auth/require-brand";
import { FeatureAction } from "./cockpit/feature-action";
import { MentorBar } from "./cockpit/mentor-bar";
import { ToolsGrid } from "./cockpit/tools-grid";

type BrandHomeParams = { params: Promise<{ brandId: string }> };

const sparkleIcon = (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M10 2c.7 4 2 5.3 6 6-4 .7-5.3 2-6 6-.7-4-2-5.3-6-6 4-.7 5.3-2 6-6Z" />
    <path d="M16 13c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z" />
  </svg>
);

export default async function BrandHomePage({ params }: BrandHomeParams) {
  const { brandId } = await params;
  const { brand } = await requireBrand(brandId);

  /* Built per request so the video tool can carry this brand's wizard path.
     Only that tool has a screen behind it; the rest say so when pressed. */
  const tools = [
    {
      title: "חיים אישיים",
      icon: "/brands/minene/icons/home-tools/personal-life.png",
    },
    {
      title: "תכנית ופרוייקט",
      icon: "/brands/minene/icons/home-tools/plan-project.png",
    },
    {
      title: "ניתוח נתונים",
      icon: "/brands/minene/icons/home-tools/data-analysis.png",
    },
    {
      title: "תרגילי הדרכה",
      icon: "/brands/minene/icons/home-tools/training-exercises.png",
    },
    {
      title: "עידוד ושכנוע",
      icon: "/brands/minene/icons/home-tools/encouragement-persuasion.png",
    },
    {
      title: "מנטורינג לעובדת",
      icon: "/brands/minene/icons/home-tools/employee-mentoring.png",
    },
    {
      title: "יצירת סרטון",
      icon: "/brands/minene/icons/home-tools/create-video.png",
      href: `/${brand.id}/cockpit/video`,
      compact: true,
    },
    {
      title: "יצירת תמונה",
      icon: "/brands/minene/icons/home-tools/create-image.png",
      compact: true,
    },
  ] as const;

  return (
    <div className="cockpit" dir="rtl">
      <section
        aria-labelledby="recommendation-title"
        className="cockpit-feature"
      >
        <div className="cockpit-feature__copy">
          <div className="cockpit-feature__label">
            {sparkleIcon}
            <span>המלצת המנטור</span>
          </div>
          <h1 id="recommendation-title">יש לך שיחה חשובה בקרוב</h1>
          <p>נתכונן יחד לשיחה ונבנה את התוכנית שלך.</p>
          <FeatureAction label="התחילי הכנה" />
        </div>

        <div className="cockpit-feature__visual">
          <Image
            alt="מנהלת ועובדת צעירות מנהלות שיחה מקצועית"
            fill
            priority
            sizes="(max-width: 539px) 52vw, 210px"
            src="/brands/minene/home-manager-conversation-v3.png"
          />
        </div>
      </section>

      <section aria-labelledby="tools-title" className="cockpit-tools">
        <h2 id="tools-title">כלים עבורך</h2>
        <ToolsGrid tools={tools} />
      </section>

      <MentorBar />
    </div>
  );
}
