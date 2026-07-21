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
        delay: Math.random() * 2.4,
        duration: 5 + Math.random() * 3.5,
        drift: (Math.random() - 0.5) * 220,
        rotate: 360 + Math.random() * 720,
      })),
    [count],
  );
}

/**
 * Shown right after a story finishes generating/loading, before the first
 * scene node — an "official" admission-letter layout (date line, accent
 * rule, university header with our mascot standing in for a crest,
 * salutation, bold congratulations paragraph) styled after a real college
 * acceptance-letter email, popping in with a confetti burst behind it and
 * addressing the player by the exact profile they just entered (university,
 * program, grade, city/country). Dismisses into the first story node on
 * click.
 */
export default function AdmissionLetter({
  profile,
  onAccept,
  onDecline,
}: {
  profile: UserProfile;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const confetti = useConfetti(70);
  const university = profile.school?.trim() || `a university in ${profile.city}`;
  // `major` is set from `program` (falling back to `department`) upstream, so
  // showing both together would just repeat the same phrase twice — pick the
  // most specific single program line, and let department stand on its own.
  const programLine = profile.program?.trim() || profile.major?.trim() || "";
  const departmentLine = profile.department?.trim() && profile.department.trim() !== programLine
    ? profile.department.trim()
    : "";
  const today = useMemo(
    () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
    [],
  );

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
        <div className="admissionHeader">
          <img className="admissionSealIcon" src="/branding/badge.png" alt="" />
          <div>
            <h2 className="admissionUniversity">{university}</h2>
            <p className="admissionDept">Admissions &amp; Life Simulator</p>
          </div>
        </div>
        <p className="admissionDate">{today}</p>
        <p className="admissionSalutation">Dear future {profile.grade.toLowerCase()} student,</p>
        <p className="admissionBody">
          <strong>Congratulations!</strong> We are delighted to inform you that the Admissions Committee has
          offered you a place at <strong>{university}</strong>
          {programLine ? (
            <>
              {" "}
              to pursue <strong>{programLine}</strong>
            </>
          ) : null}
          {departmentLine ? (
            <>
              {" "}
              in the <strong>{departmentLine}</strong>
            </>
          ) : null}
          .
        </p>

        <div className="admissionBanner">
          <p className="admissionBannerTitle">Welcome to {university}!</p>
        </div>
        <p className="admissionTagline">
          We can&rsquo;t wait to see you in {profile.city}, {profile.country}.
        </p>

        <p className="admissionBody admissionBody--closing">
          A transformative study-abroad experience awaits you — new routines, new people, and choices only
          you can make. Your journey begins the moment you turn the page.
        </p>

        <div className="admissionFooterBar" />
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onAccept}>
            Accept the offer
          </button>
          <button className="journalButton secondary" onClick={onDecline}>
            Decline the offer
          </button>
        </div>
      </div>
    </div>
  );
}
