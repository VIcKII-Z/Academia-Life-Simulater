import { useEffect, useState } from "react";
import type { UserProfile } from "../types";
import { useI18n } from "../lib/i18n";

function buildTimeSkipLines(
  profile: UserProfile,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { text: string; icon: string }[] {
  const school = profile.school?.trim() || t("timeskip.schoolFallback", { city: profile.city });
  return [
    { text: t("timeskip.line1"), icon: "/stickers/gear.png" },
    { text: t("timeskip.line2"), icon: "/stickers/buttons/rocket.svg" },
    { text: t("timeskip.line3", { city: profile.city, school }), icon: "/stickers/map.png" },
    { text: t("timeskip.line4"), icon: "/stickers/buttons/speechbubble.svg" },
  ];
}

export default function TimeSkipLoader({ profile }: { profile: UserProfile }) {
  const { t } = useI18n();
  const lines = buildTimeSkipLines(profile, t);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => Math.min(current + 1, lines.length - 1));
    }, 2200);
    return () => window.clearInterval(timer);
  }, [lines.length]);

  return (
    <div className="journalCard dreamingCard">
      <div className="dreamingStamp">
        <img className="dreamingStampIcon" src={lines[index].icon} alt="" />
      </div>
      <p className="dreamingLine">{lines[index].text}</p>
      <p className="dreamingSub">{t("timeskip.sub")}</p>
    </div>
  );
}
