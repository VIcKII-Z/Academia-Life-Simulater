import { useMemo } from "react";
import type { UserProfile } from "../types";
import { useI18n } from "../lib/i18n";

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

export default function AdmissionLetter({
  profile,
  onAccept,
  onDecline,
}: {
  profile: UserProfile;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t, dateLocale, language } = useI18n();
  const confetti = useConfetti(70);
  const university = profile.school?.trim() || t("admission.fallbackUniversity", { city: profile.city });
  const programLine = profile.program?.trim() || profile.major?.trim() || "";
  const departmentLine = profile.department?.trim() && profile.department.trim() !== programLine
    ? profile.department.trim()
    : "";
  const today = useMemo(
    () => new Date().toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric" }),
    [dateLocale],
  );
  const knownDegrees = ["Undergraduate", "Graduate", "PhD", "Exchange Student"];
  const gradeLabel = knownDegrees.includes(profile.grade) ? t(`degree.${profile.grade}`) : profile.grade;
  const salutationGrade = language === "en" ? gradeLabel.toLowerCase() : gradeLabel;

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
            <p className="admissionDept">{t("admission.department")}</p>
          </div>
        </div>
        <p className="admissionDate">{today}</p>
        <p className="admissionSalutation">{t("admission.salutation", { grade: salutationGrade })}</p>
        <p className="admissionBody">
          <strong>{t("admission.congrats")}</strong> {t("admission.bodyStart")} <strong>{university}</strong>
          {programLine ? (
            <>
              {" "}
              {t("admission.toPursue")} <strong>{programLine}</strong>
            </>
          ) : null}
          {departmentLine ? (
            <>
              {" "}
              {t("admission.inDepartment")} <strong>{departmentLine}</strong>
            </>
          ) : null}
          .
        </p>

        <div className="admissionBanner">
          <p className="admissionBannerTitle">{t("admission.welcome", { university })}</p>
        </div>
        <p className="admissionTagline">
          {t("admission.tagline", { city: profile.city, country: profile.country })}
        </p>

        <p className="admissionBody admissionBody--closing">{t("admission.closing")}</p>

        <div className="admissionFooterBar" />
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onAccept}>
            {t("admission.accept")}
          </button>
          <button className="journalButton secondary" onClick={onDecline}>
            {t("admission.decline")}
          </button>
        </div>
      </div>
    </div>
  );
}
