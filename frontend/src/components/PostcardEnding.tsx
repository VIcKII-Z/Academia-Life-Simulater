import type { EndingNode, StatBlock, StorySource } from "../types";
import HighlightedText from "./HighlightedText";
import { StatMeters } from "./SceneCard";
import { useI18n } from "../lib/i18n";

const TONE_CLASS: Record<string, string> = {
  hopeful: "toneHopeful",
  bittersweet: "toneBittersweet",
  challenging: "toneChallenging",
};

/** Strips the `**bold**` markers the Design Agent uses for in-app highlighting
 * — the saved story file is plain text, so the raw asterisks would just be
 * noise there. */
function stripHighlightMarkers(text?: string): string {
  return (text ?? "").replace(/\*\*(.+?)\*\*/g, "$1");
}

/** Builds a plain-text keepsake of the finished story — the scene, the field
 * note it was grounded in, and the actual research sources — so a player can
 * save something more useful than a screenshot before starting a new run. */
function buildStoryKeepsake({
  ending,
  city,
  country,
  profileSummary,
  contextNote,
  stats,
  sources,
  t,
}: {
  ending: EndingNode;
  city: string;
  country: string;
  profileSummary?: string;
  contextNote?: string;
  stats?: StatBlock;
  sources?: StorySource[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}): string {
  const lines: string[] = [];
  const toneLabel = t(`tone.${ending.tone}`);
  lines.push(t("keepsake.title"));
  lines.push("=".repeat(44));
  lines.push("");
  lines.push(t("keepsake.postmarked", { city, country }));
  if (profileSummary) lines.push(profileSummary);
  lines.push(t("keepsake.tone", { tone: toneLabel === `tone.${ending.tone}` ? ending.tone : toneLabel }));
  lines.push("");
  lines.push(stripHighlightMarkers(ending.scene_text));
  lines.push("");

  if (ending.insight) {
    lines.push(t("keepsake.fieldNote"));
    lines.push("-".repeat(30));
    lines.push(stripHighlightMarkers(ending.insight));
    lines.push("");
  }

  if (contextNote) {
    lines.push(t("keepsake.about"));
    lines.push("-".repeat(30));
    lines.push(contextNote);
    lines.push("");
  }

  if (stats) {
    lines.push(t("keepsake.stats"));
    lines.push("-".repeat(30));
    lines.push(`${t("stats.health")} ${stats.health} · ${t("stats.mood")} ${stats.mood} · ${t("stats.money")} ${stats.money} · ${t("stats.school")} ${stats.school}`);
    lines.push("");
  }

  if (sources && sources.length > 0) {
    lines.push(t("keepsake.sources"));
    lines.push("-".repeat(30));
    for (const source of sources) {
      lines.push(`- ${source.title || source.url}${source.title ? `: ${source.url}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default function PostcardEnding({
  ending,
  city,
  country,
  profileSummary,
  contextNote,
  stats,
  sources,
  onRestart,
}: {
  ending: EndingNode;
  city: string;
  country: string;
  profileSummary?: string;
  contextNote?: string;
  stats?: StatBlock;
  sources?: StorySource[];
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const toneLabel = t(`tone.${ending.tone}`);

  function handleSave() {
    const text = buildStoryKeepsake({ ending, city, country, profileSummary, contextNote, stats, sources, t });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `future-life-story-${city.toLowerCase().replace(/\s+/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="sceneShell">
      {ending.image_url && (
        <figure className="polaroid">
          <span className="tape" />
          <img src={ending.image_url} alt="" />
          <figcaption>{city}, {country}</figcaption>
        </figure>
      )}
      <div className="postcard">
        <div className={`wax-seal ${TONE_CLASS[ending.tone]}`} title={toneLabel}>
          <img className="waxSealIcon" src="/stickers/buttons/envolope.svg" alt={toneLabel} />
        </div>
        <p className="postmark">{t("ending.postmarked", { city })}</p>
        <h2>{t("ending.title")}</h2>
        {stats && (
          <div className="postcardStats">
            <StatMeters stats={stats} />
          </div>
        )}
        <p><HighlightedText text={ending.scene_text} /></p>
        {ending.insight && (
          <div className="postcardInsight">
            <span className="postcardInsightLabel">{t("ending.fieldNote")}</span>
            <p><HighlightedText text={ending.insight} /></p>
          </div>
        )}
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onRestart}>
            {t("ending.restart")}
          </button>
          <button className="journalButton secondary" onClick={handleSave}>
            {t("ending.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

