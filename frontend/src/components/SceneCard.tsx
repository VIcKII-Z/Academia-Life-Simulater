import type { Choice, EndingNode, StatBlock, StoryNode, StorySource } from "../types";
import HighlightedText from "./HighlightedText";
import Floaty from "./Floaty";

// Pixel-art charm stickers (borrowed from the random-life-challenge asset
// pack) sit next to each stat — deliberately playful pixel accents kept as the
// product's visual identity even inside the cleaner, more professional shell.
export const STAT_CONFIG: {
  key: keyof StatBlock;
  label: string;
  color: string;
  sticker: string;
}[] = [
  { key: "health", label: "Health", color: "var(--theme-coral)", sticker: "/stickers/heart.png" },
  { key: "mood", label: "Mood", color: "var(--theme-yellow)", sticker: "/stickers/sparkle.png" },
  { key: "money", label: "Money", color: "var(--theme-green)", sticker: "/stickers/coin.png" },
  { key: "school", label: "School", color: "var(--theme-blue)", sticker: "/stickers/book.png" },
];

const STAT_MAX = 100;

/** Compact horizontal stat meters designed to live in the top app bar — pixel
 * sticker + slim bar + value. Replaces the old floating "sticker strip" so the
 * player's vitals read like a product status bar rather than a scrapbook.
 *
 * `registerIcon`, when given, hands back each stat's sticker DOM node so a
 * parent (HomeFlow) can read its on-screen position and animate a little icon
 * flying in (gains) or dropping out (losses) from that exact spot whenever a
 * choice changes the player's stats. */
export function StatMeters({
  stats,
  registerIcon,
}: {
  stats: StatBlock;
  registerIcon?: (key: keyof StatBlock, el: HTMLImageElement | null) => void;
}) {
  return (
    <div className="statMeters" role="group" aria-label="Life stats">
      {STAT_CONFIG.map(({ key, label, color, sticker }) => {
        const value = Math.max(0, Math.min(STAT_MAX, stats[key]));
        const isLow = value <= 20;
        return (
          <div className={`statMeter${isLow ? " statMeter--low" : ""}`} key={key} title={`${label}: ${stats[key]}`}>
            <img
              className="statMeterSticker"
              src={sticker}
              alt=""
              ref={registerIcon ? (el) => registerIcon(key, el) : undefined}
            />
            <div className="statMeterBody">
              <div className="statMeterHead">
                <span className="statMeterLabel">{label}</span>
                <span className="statMeterValue">{stats[key]}</span>
              </div>
              <div className="statMeterTrack">
                <div className="statMeterFill" style={{ width: `${value}%`, background: color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Small "field notes" glyph for the insight panel — an open book with a
 * bookmark, drawn in the same line style as icons.tsx. */
function FieldNoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 6.5C10.4 5.2 8.4 4.6 4.8 4.6v12.2c3.6 0 5.6.6 7.2 1.9 1.6-1.3 3.6-1.9 7.2-1.9V4.6c-3.6 0-5.6.6-7.2 1.9z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 6.5v11.9" stroke="currentColor" strokeWidth="1.3" />
      <path d="M14.6 9.2c1.2-.5 2.4-.7 3.6-.7M14.6 11.8c1.2-.5 2.4-.7 3.6-.7M6 9.2c1.2-.5 2.4-.7 3.6-.7"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

const CONFIDENCE_RANK: Record<string, number> = {
  official_registry: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Which "aspect of student life" a scene is mainly about — purely a
 * client-side keyword heuristic over scene_text/insight (no backend schema
 * change needed, so it works even on already-cached stories) used to pick
 * one of the game's life-category illustrations for the Field Notes card. */
const LIFE_CATEGORIES: { icon: string; label: string; keywords: RegExp }[] = [
  { icon: "/branding/lecture.png", label: "Academics", keywords: /\b(class|lecture|professor|exam|study|studying|assignment|course|homework|grade|grades|seminar|thesis|research|lab|major|gpa)\b/i },
  { icon: "/branding/career.png", label: "Career", keywords: /\b(job|internship|career|interview|resume|r[ée]sum[ée]|employer|hiring|work permit|visa sponsor|networking|offer)\b/i },
  { icon: "/branding/dorm.png", label: "Housing", keywords: /\b(dorm|apartment|housing|rent|lease|landlord|roommate|move[- ]in|utilities)\b/i },
  { icon: "/branding/social.png", label: "Social Life", keywords: /\b(friend|friends|roommate|party|date|dating|relationship|classmate|club|hang out|hangout)\b/i },
  { icon: "/branding/events.png", label: "Campus Events", keywords: /\b(festival|event|holiday|celebration|ceremony|orientation|trip|concert|fair)\b/i },
];

function categorizeScene(insight?: string, sceneText?: string): { icon: string; label: string } {
  const text = `${insight ?? ""} ${sceneText ?? ""}`;
  for (const category of LIFE_CATEGORIES) {
    if (category.keywords.test(text)) return category;
  }
  return { icon: "/branding/campus.png", label: "Campus Life" };
}

/** Picks the handful of sources worth showing per scene: de-duplicated by
 * URL and sorted so the most authoritative citations (official registries,
 * then high-confidence pages) surface first. */
function pickTopSources(sources: StorySource[] | undefined, limit = 5): StorySource[] {
  if (!sources || sources.length === 0) return [];
  const seen = new Set<string>();
  const deduped = sources.filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
  return deduped
    .sort((a, b) => (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0))
    .slice(0, limit);
}

/**
 * The right-hand "Field Notes" panel: while the player reads a scene, this
 * surfaces a short, research-grounded explanation of WHY that challenge is
 * realistic for their study-abroad profile — turning the game into something
 * they also learn from. Falls back to the persistent story context when a node
 * has no specific insight. Also lists the actual research sources the story
 * was grounded in, as clickable links, so the player can verify the facts.
 */
export function InsightPanel({
  insight,
  sceneText,
  caption,
  schoolQuery,
  contextNote,
  sources,
}: {
  insight?: string;
  sceneText?: string;
  caption: string;
  schoolQuery?: string;
  contextNote?: string;
  sources?: StorySource[];
}) {
  const topSources = pickTopSources(sources);
  const category = categorizeScene(insight, sceneText);

  return (
    <Floaty className="insightPanel" driftDuration={13} driftDelay={0.4}>
      <aside className="insightPanelBody" aria-label="Field notes">
        <div className="insightCard">
        <div className="insightHead">
          <FieldNoteIcon className="insightIcon" />
          <span className="insightKicker">Field Notes</span>
          <div className="insightCategory">
            <img className="insightCategoryIcon" src={category.icon} alt="" />
            <span>{category.label}</span>
          </div>
        </div>

        {insight ? (
          <>
            <h3 className="insightTitle">Why this happens</h3>
            <p className="insightBody">
              <HighlightedText text={insight} schoolQuery={schoolQuery} />
            </p>
          </>
        ) : (
          <p className="insightBody insightBody--muted">
            Every scene in your story is generated from live research about student life in{" "}
            <strong>{caption}</strong>. Watch this space for notes on why each challenge tends to
            show up.
          </p>
        )}

        {contextNote && (
          <div className="insightContext">
            <span className="insightContextLabel">About this story</span>
            <p>{contextNote}</p>
          </div>
        )}

        {topSources.length > 0 && (
          <div className="insightContext">
            <span className="insightContextLabel">Sources</span>
            <ul className="insightSourceList">
              {topSources.map((source, index) => (
                <li key={`${source.url}-${index}`}>
                  <a
                    className="insightSourceLink"
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img className="insightSourceIcon" src="/stickers/link.svg" alt="" />
                    <span>{source.title || source.url}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

          <div className="insightFoot">
            <img className="insightFootIcon" src="/stickers/address.svg" alt="" />
            {caption}
          </div>
        </div>
      </aside>
    </Floaty>
  );
}

/** Assigns each fork a signpost direction: two choices go left/right; any
 * extra choices (not currently produced by the story generator, but kept as
 * a safe fallback) point straight ahead. */
function directionFor(index: number, total: number): "left" | "right" | "straight" {
  if (total <= 1) return "straight";
  if (index === 0) return "left";
  if (index === total - 1) return "right";
  return "straight";
}

// Whimsical sticker marks (from the buttons sticker pack) standing in for
// the old plain signpost arrows on each choice card — rocket for the
// bolder/first path, crystal ball for the more cautious/second path, and
// the mystery box for any extra fallback choices.
const CHOICE_STICKER: Record<"left" | "right" | "straight", string> = {
  left: "/stickers/buttons/rocket.svg",
  right: "/stickers/buttons/crystalball.svg",
  straight: "/stickers/buttons/mysterybox.svg",
};

export default function SceneCard({
  node,
  caption,
  schoolQuery,
  contextNote,
  sources,
  onChoose,
}: {
  node: StoryNode | EndingNode;
  caption: string;
  schoolQuery?: string;
  contextNote?: string;
  sources?: StorySource[];
  onChoose: (choice: Choice, originRect: DOMRect) => void;
}) {
  const isEnding = (node as EndingNode).tone !== undefined;
  const choices = !isEnding ? (node as StoryNode).choices : [];
  const hasImage = Boolean(node.image_url);

  return (
    <div className={`stage${hasImage ? " stage--immersive" : ""}`}>
      <div className={`sceneStage${hasImage ? " sceneStage--immersive" : ""}`}>
        {hasImage && (
          <div className="sceneImmersiveBg">
            <img className="sceneHeroImg" src={node.image_url} alt="" />
            <div className="sceneImmersiveScrim" />
            <a
              className="sceneImmersiveCaption"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(caption)}`}
              target="_blank"
              rel="noreferrer"
            >
              <img className="sceneImmersiveCaptionIcon" src="/stickers/map.png" alt="" />
              {caption}
            </a>
          </div>
        )}

        <div className="stageGrid">
          <div className="sceneMain">
            <Floaty className="sceneCardFloaty" driftDuration={10.5}>
              <div className="journalCard sceneCard">
              <span className="sceneQuoteMark" aria-hidden="true">
                &ldquo;
              </span>
              <p className="storyText">
                <HighlightedText text={node.scene_text} mapQuery={caption} schoolQuery={schoolQuery} />
              </p>

              {!isEnding && choices.length > 0 && (
                <div className="forkWrapper">
                  <div className="forkDivider">
                    <span>what do you do?</span>
                  </div>
                  <div className={`choicePaths choicePaths--${choices.length}`}>
                    {choices.map((choice, index) => {
                      const direction = directionFor(index, choices.length);
                      return (
                        <button
                          className={`choicePath${choice.recommended ? " choicePath--recommended" : ""}`}
                          key={`${choice.next_node}-${index}`}
                          onClick={(event) => onChoose(choice, event.currentTarget.getBoundingClientRect())}
                        >
                          {choice.recommended && (
                            <img className="choicePathStar" src="/stickers/star.svg" alt="Recommended" />
                          )}
                          <img
                            className="choicePathArrow"
                            src={CHOICE_STICKER[direction]}
                            alt=""
                          />
                          <span className="choicePathText">{choice.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            </Floaty>
          </div>

          <InsightPanel
            insight={node.insight}
            sceneText={node.scene_text}
            caption={caption}
            schoolQuery={schoolQuery}
            contextNote={contextNote}
            sources={sources}
          />
        </div>
      </div>
    </div>
  );
}
