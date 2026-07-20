import type { EndingNode, StatBlock, StorySource } from "../types";
import HighlightedText from "./HighlightedText";
import { StatMeters } from "./SceneCard";

const TONE_LABEL: Record<string, string> = {
  hopeful: "Hopeful",
  bittersweet: "Bittersweet",
  challenging: "Challenging",
};

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
}: {
  ending: EndingNode;
  city: string;
  country: string;
  profileSummary?: string;
  contextNote?: string;
  stats?: StatBlock;
  sources?: StorySource[];
}): string {
  const lines: string[] = [];
  lines.push("FUTURE LIFE SIMULATOR — YOUR STORY, SEALED");
  lines.push("=".repeat(44));
  lines.push("");
  lines.push(`Postmarked from ${city}, ${country}`);
  if (profileSummary) lines.push(profileSummary);
  lines.push(`Ending tone: ${TONE_LABEL[ending.tone] ?? ending.tone}`);
  lines.push("");
  lines.push(stripHighlightMarkers(ending.scene_text));
  lines.push("");

  if (ending.insight) {
    lines.push("FIELD NOTE — WHY THIS HAPPENS");
    lines.push("-".repeat(30));
    lines.push(stripHighlightMarkers(ending.insight));
    lines.push("");
  }

  if (contextNote) {
    lines.push("ABOUT THIS STORY");
    lines.push("-".repeat(30));
    lines.push(contextNote);
    lines.push("");
  }

  if (stats) {
    lines.push("FINAL STATS");
    lines.push("-".repeat(30));
    lines.push(`Health ${stats.health} · Mood ${stats.mood} · Money ${stats.money} · School ${stats.school}`);
    lines.push("");
  }

  if (sources && sources.length > 0) {
    lines.push("SOURCES");
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
  function handleSave() {
    const text = buildStoryKeepsake({ ending, city, country, profileSummary, contextNote, stats, sources });
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
        <div className={`wax-seal ${TONE_CLASS[ending.tone]}`} title={TONE_LABEL[ending.tone]}>
          <img className="waxSealIcon" src="/stickers/buttons/envolope.svg" alt={TONE_LABEL[ending.tone]} />
        </div>
        <p className="postmark">Postmarked from {city}</p>
        <h2>Your story, sealed</h2>
        {stats && (
          <div className="postcardStats">
            <StatMeters stats={stats} />
          </div>
        )}
        <p><HighlightedText text={ending.scene_text} /></p>
        {ending.insight && (
          <div className="postcardInsight">
            <span className="postcardInsightLabel">Field note</span>
            <p><HighlightedText text={ending.insight} /></p>
          </div>
        )}
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onRestart}>
            Start a new chapter
          </button>
          <button className="journalButton secondary" onClick={handleSave}>
            Save this story
          </button>
        </div>
      </div>
    </div>
  );
}

