import { useEffect, useState } from "react";
import type { UserProfile } from "../types";

function buildNarrativeLines(profile: UserProfile): string[] {
  return [
    `Looking up what life is really like for a ${profile.grade.toLowerCase()} in ${profile.city}...`,
    `Picturing your first week studying ${profile.major} in ${profile.country}...`,
    `Sketching the choices that could shape your story...`,
    `Stamping your passport for ${profile.city}...`,
  ];
}

/**
 * Purely time-based narrative sequence (not tied to real pipeline progress) —
 * cycles through lines tied to the user's own input while the /api/generate
 * request is in flight, then holds on the last line until the promise resolves.
 */
export default function DreamingLoader({ profile }: { profile: UserProfile }) {
  const lines = buildNarrativeLines(profile);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => Math.min(current + 1, lines.length - 1));
    }, 2200);
    return () => window.clearInterval(timer);
  }, [lines.length]);

  return (
    <div className="journalCard dreamingCard">
      <div className="dreamingStamp">🛂</div>
      <p className="dreamingLine">{lines[index]}</p>
      <p className="dreamingSub">This usually takes under a minute.</p>
    </div>
  );
}
