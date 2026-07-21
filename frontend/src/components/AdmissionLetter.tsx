import { useMemo } from "react";
import type { UserProfile } from "../types";

const CONFETTI_COLORS = ["var(--theme-blue)", "var(--theme-coral)", "var(--theme-yellow)", "var(--theme-green)", "var(--gold)"];

interface ConfettiPiece {
  id: number;
  left: number;
  color: string;
  delay: number;
  duration: number;
  drift: number;
  rotate: number;
}

/** One-time randomized confetti burst — generated on mount and never
 * recomputed, so the streamers don't jump around on re-render while the
 * letter is on screen. */
function useConfetti(count: number): ConfettiPiece[] {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, id) => ({
        id,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[id % CONFETTI_COLORS.length],
        delay: Math.random() * 0.6,
        duration: 2.6 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        rotate: 360 + Math.random() * 360,
      })),
    [count],
  );
}

/**
 * Shown right after a story finishes generating/loading, before the first
 * scene node — a pixel-journal "admission letter" that pops in with a
 * confetti burst and addresses the player by the exact profile they just
 * entered (university, program, grade, city/country), so it reads like the
 * acceptance letter that kicked off this whole trip. Dismisses into the
 * first story node on click.
 */
export default function AdmissionLetter({ profile, onContinue }: { profile: UserProfile; onContinue: () => void }) {
  const confetti = useConfetti(28);
  const university = profile.school?.trim() || `a university in ${profile.city}`;
  const programLine = [profile.program, profile.major].filter(Boolean).join(" — ");

  return (
    <div className="admissionOverlay">
      <div className="confettiField" aria-hidden="true">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="confettiPiece"
            style={
              {
                left: `${piece.left}%`,
                backgroundColor: piece.color,
                animationDelay: `${piece.delay}s`,
                animationDuration: `${piece.duration}s`,
                "--drift": `${piece.drift}px`,
                "--rotate": `${piece.rotate}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="admissionLetter">
        <div className="admissionSeal">
          <img className="admissionSealIcon" src="/branding/mascot.png" alt="" />
        </div>
        <p className="admissionKicker">Official Admission</p>
        <h2 className="admissionTitle">Congratulations!</h2>
        <p className="admissionBody">
          On behalf of the Admissions Committee, we are delighted to offer you a place at{" "}
          <strong>{university}</strong>
          {programLine ? (
            <>
              {" "}
              to pursue <strong>{programLine}</strong>
            </>
          ) : null}{" "}
          as a <strong>{profile.grade}</strong> student in <strong>{profile.city}, {profile.country}</strong>.
        </p>
        <p className="admissionFooter">Your journey begins now — pack light, dream big.</p>
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onContinue}>
            Begin your story
          </button>
        </div>
      </div>
    </div>
  );
}
