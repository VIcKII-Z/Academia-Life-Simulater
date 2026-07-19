import type { Choice, EndingNode, StatBlock, StoryNode } from "../types";
import { PathArrowIcon } from "./icons";

// Pixel-art charm stickers (borrowed from the random-life-challenge asset
// pack) pinned next to each stat bar like little scrapbook stickers —
// deliberately playful against the vintage paper, the way a traveler might
// stick a cute sticker into an otherwise serious journal.
const STAT_CONFIG: {
  key: keyof StatBlock;
  label: string;
  color: string;
  sticker: string;
  tilt: number;
}[] = [
  { key: "health", label: "Health", color: "var(--tone-challenging)", sticker: "/stickers/heart.png", tilt: -6 },
  { key: "mood", label: "Mood", color: "var(--gold)", sticker: "/stickers/sparkle.png", tilt: 5 },
  { key: "money", label: "Money", color: "var(--tone-hopeful)", sticker: "/stickers/coin.png", tilt: -4 },
];

const STAT_MAX = 100;

/** The "value of life" bars, always rendered on paper (not floating over a
 * photo) so they stay legible and out of the way of the immersive scene
 * image — they live in their own sticker-strip between the hero image and
 * the story text. */
export function StatGauges({ stats }: { stats: StatBlock }) {
  return (
    <div className="statBars" role="group" aria-label="Life stats">
      {STAT_CONFIG.map(({ key, label, color, sticker, tilt }) => {
        const value = Math.max(0, Math.min(STAT_MAX, stats[key]));
        const isLow = value <= 20;
        return (
          <div className={`statBar${isLow ? " statBar--low" : ""}`} key={key}>
            <img
              className="statBarSticker"
              src={sticker}
              alt=""
              style={{ transform: `rotate(${tilt}deg)` }}
            />
            <span className="statBarLabel">{label}</span>
            <div className="statBarTrack">
              <div className="statBarFill" style={{ width: `${value}%`, background: color }} />
            </div>
            <span className="statBarValue">{stats[key]}</span>
          </div>
        );
      })}
    </div>
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

export default function SceneCard({
  node,
  caption,
  stats,
  onChoose,
}: {
  node: StoryNode | EndingNode;
  caption: string;
  stats: StatBlock;
  onChoose: (choice: Choice) => void;
}) {
  const isEnding = (node as EndingNode).tone !== undefined;
  const choices = !isEnding ? (node as StoryNode).choices : [];
  const hasImage = Boolean(node.image_url);

  return (
    <div className={`sceneShell ${hasImage ? "sceneShell--immersive" : ""}`}>
      {hasImage && (
        <div className="sceneHero">
          <img className="sceneHeroImg" src={node.image_url} alt="" />
          <div className="sceneHeroOverlay" />
          <span className="sceneHeroCaption">{caption}</span>
        </div>
      )}

      <div className={`statStrip${hasImage ? " statStrip--overlap" : ""}`}>
        <StatGauges stats={stats} />
      </div>

      <div className={`journalCard sceneCard${hasImage ? " sceneCard--overlap" : ""}`}>
        <span className="sceneQuoteMark" aria-hidden="true">
          &ldquo;
        </span>
        <p className="storyText">{node.scene_text}</p>

        {!isEnding && choices.length > 0 && (
          <div className="forkWrapper">
            <div className="forkDivider">
              <span>the path splits</span>
            </div>
            <div className={`choicePaths choicePaths--${choices.length}`}>
              {choices.map((choice, index) => {
                const direction = directionFor(index, choices.length);
                return (
                  <button
                    className={`choicePath choicePath--${direction}`}
                    key={`${choice.next_node}-${index}`}
                    onClick={() => onChoose(choice)}
                  >
                    <PathArrowIcon direction={direction} className="choicePathArrow" />
                    <span className="choicePathText">{choice.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
