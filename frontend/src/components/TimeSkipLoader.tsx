import { useEffect, useState } from "react";
import type { UserProfile } from "../types";

function buildTimeSkipLines(profile: UserProfile): { text: string; icon: string }[] {
  const school = profile.school?.trim() || `your new school in ${profile.city}`;
  return [
    { text: `A few months pass while you get ready to leave...`, icon: "/stickers/gear.png" },
    { text: `After a long summer, moving day finally arrives...`, icon: "/stickers/buttons/rocket.svg" },
    { text: `You settle into ${profile.city} and find your way around ${school}...`, icon: "/stickers/map.png" },
    { text: `Orientation week wraps up — your first semester is about to begin...`, icon: "/stickers/buttons/speechbubble.svg" },
  ];
}

/**
 * Shown right after the player accepts their admission offer — a short
 * "time skip" montage (a few months pass, summer ends, orientation wraps
 * up) that bridges the letter and the first scene. Purely time-based, not
 * tied to real pipeline progress: by the time this finishes, the Search →
 * Design → Artist pipeline that started the moment the player finished the
 * quiz (well before they even saw the admission letter) has usually already
 * caught up in the background, so there's little to no extra wait once this
 * montage ends.
 */
export default function TimeSkipLoader({ profile }: { profile: UserProfile }) {
  const lines = buildTimeSkipLines(profile);
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
      <p className="dreamingSub">Your first scene is on its way.</p>
    </div>
  );
}
