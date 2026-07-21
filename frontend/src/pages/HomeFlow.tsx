import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import PassportCard from "../components/PassportCard";
import QuizFlow from "../components/QuizFlow";
import TimeSkipLoader from "../components/TimeSkipLoader";
import BackgroundMusic from "../components/BackgroundMusic";
import SceneCard, { StatMeters, STAT_CONFIG } from "../components/SceneCard";
import StatFlyers, { type StatFlyer } from "../components/StatFlyers";
import PostcardEnding from "../components/PostcardEnding";
import AdmissionLetter from "../components/AdmissionLetter";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { buildRuntimeConfig, generateStory } from "../lib/api";
import { hasStoredApiKey, loadImageGenerationPreference, saveImageGenerationPreference } from "../lib/storage";
import { applyStatDelta, DEFAULT_STATS, getFailedStat } from "../lib/gameplay";
import { useI18n } from "../lib/i18n";
import type { Choice, EndingNode, StatBlock, StoryDocument, StoryNode, UserProfile } from "../types";

type FlowStage = "passport" | "quiz" | "admission" | "timeskip" | "play" | "error";

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

let flyerSeq = 0;

export default function HomeFlow() {
  const { t } = useI18n();
  const [stage, setStage] = useState<FlowStage>(hasStoredApiKey() ? "quiz" : "passport");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState("A");
  const [stats, setStats] = useState<StatBlock>(DEFAULT_STATS);
  const [gameOverReason, setGameOverReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [reusedStory, setReusedStory] = useState(false);
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(loadImageGenerationPreference);
  const [flyers, setFlyers] = useState<StatFlyer[]>([]);
  // Positions of each stat's sticker icon in the top app bar, so a flyer
  // animation can be aimed at (or launched from) the exact right spot.
  const statIconRefs = useRef<Partial<Record<keyof StatBlock, HTMLImageElement>>>({});
  // Holds the in-flight /api/generate request so the agents can keep working
  // in the background while the player reads the admission letter and makes
  // their accept/decline call — instead of the player watching a blank
  // "dreaming" screen and THEN reading the letter, the two happen at once,
  // which shortens the total time-to-play whenever the letter + decision
  // takes longer than the agents still needed.
  const storyRequestRef = useRef<Promise<StoryDocument> | null>(null);

  function registerStatIcon(key: keyof StatBlock, el: HTMLImageElement | null) {
    if (el) statIconRefs.current[key] = el;
    else delete statIconRefs.current[key];
  }

  /** Spawns one little flying sticker per stat the choice actually changed —
   * gains fly from where the player clicked up into the app bar, losses drop
   * out of the app bar and tumble away — then self-removes after its
   * animation via StatFlyers' onAnimationEnd callback. */
  function spawnStatFlyers(delta: StatBlock | undefined, originRect: DOMRect) {
    if (!delta) return;
    const originX = originRect.left + originRect.width / 2;
    const originY = originRect.top + originRect.height / 2;
    const next: StatFlyer[] = [];
    for (const { key, sticker } of STAT_CONFIG) {
      const change = delta[key] ?? 0;
      if (change === 0) continue;
      const iconEl = statIconRefs.current[key];
      const targetRect = iconEl?.getBoundingClientRect();
      const targetX = targetRect ? targetRect.left + targetRect.width / 2 : originX;
      const targetY = targetRect ? targetRect.top + targetRect.height / 2 : originY - 120;
      const id = `flyer-${flyerSeq++}`;
      if (change > 0) {
        next.push({ id, icon: sticker, x: originX, y: originY, dx: targetX - originX, dy: targetY - originY, kind: "gain" });
      } else {
        next.push({ id, icon: sticker, x: targetX, y: targetY, dx: (Math.random() - 0.5) * 60, dy: 90, kind: "loss" });
      }
    }
    if (next.length > 0) setFlyers((current) => [...current, ...next]);
  }

  function removeFlyer(id: string) {
    setFlyers((current) => current.filter((flyer) => flyer.id !== id));
  }

  function toggleImageGeneration() {
    setImageGenerationEnabled((current) => {
      const next = !current;
      saveImageGenerationPreference(next);
      return next;
    });
  }

  function startStory(nextProfile: UserProfile) {
    setProfile(nextProfile);
    setError(null);
    storyRequestRef.current = generateStory({
      mode: "live_search",
      profile: nextProfile,
      runtimeConfig: buildRuntimeConfig(undefined, {
        enableImageGeneration: imageGenerationEnabled,
        maxImagesPerStory: imageGenerationEnabled ? 30 : 0,
      }),
    });
    // The admission letter only needs the profile the player just entered
    // (already the authoritative, fully-normalized values — school/program/
    // department come straight from their search picks), so it can show
    // immediately without waiting on the agents at all.
    setStage("admission");
  }

  async function acceptOffer() {
    setStage("timeskip");
    const request = storyRequestRef.current;
    try {
      // Even a cache hit resolves in a few milliseconds (it's just a JSON
      // file read), which would make the "time skip" loader flash by so fast
      // it looked broken/skipped. Keep it on screen for a minimum stretch so
      // the transition always feels real, whether the story was freshly
      // generated, already finished while the player was on the letter, or
      // reused from the cache.
      const minSkipTime = new Promise((resolve) => setTimeout(resolve, 4200));
      const [doc] = await Promise.all([request, minSkipTime]);
      if (!doc) throw new Error("Story generation did not return a result.");
      setStory(doc);
      setCurrentNodeId(Object.keys(doc.nodes)[0] ?? "A");
      setStats({ ...DEFAULT_STATS, ...doc.initial_stats });
      setGameOverReason(null);
      setReusedStory(Boolean(doc.cached));
      setStage("play");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  function handleChoice(choice: Choice, originRect: DOMRect) {
    spawnStatFlyers(choice.stat_delta, originRect);
    const nextStats = applyStatDelta(stats, choice.stat_delta);
    setStats(nextStats);
    const failedStat = getFailedStat(nextStats);
    if (failedStat) {
      setGameOverReason(t("story.gameOver", { stat: t(`stats.${failedStat}`) }));
      return;
    }
    setCurrentNodeId(choice.next_node);
  }

  function restart() {
    storyRequestRef.current = null;
    setStory(null);
    setProfile(null);
    setReusedStory(false);
    setStage("quiz");
  }

  const currentNode = story ? story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null : null;
  const ending = currentNode && isEnding(currentNode) ? currentNode : null;
  // Only the actual gameplay stage gets the wide, edge-to-edge "app shell"
  // layout (sticky app bar + two-column stage) — admission/timeskip/error
  // stay in the same centered single-card layout as onboarding, otherwise
  // they'd inherit the play shell's stretch/no-padding rules and end up
  // pinned to the top-left instead of centered on screen.
  const hasAppBar = stage === "play" && Boolean(story);
  const isCenteredStage = stage === "admission" || stage === "timeskip" || stage === "error";

  return (
    <main
      className={`journal ${stage === "passport" || stage === "quiz" ? "journal--onboarding" : ""} ${hasAppBar ? "journal--play" : ""} ${isCenteredStage ? "journal--centered" : ""}`}
    >
      <BackgroundMusic playing={stage === "admission" || stage === "timeskip" || stage === "play"} />
      <StatFlyers flyers={flyers} onDone={removeFlyer} />

      {hasAppBar && story ? (
        <header className="appBar">
          <div className="appBarStart">
            <div className="appBarBrand">
              <img className="appBarMascot" src="/branding/mascot.png" alt="" />
              <img className="appBarLogo" src="/branding/title.png" alt="Future Life Simulator" />
            </div>
            <div className="appBarProfile">
              <span className="appBarProfileCity">{story.user_profile.school || story.user_profile.city}</span>
              <span className="appBarProfileMeta">
                {[story.user_profile.grade, story.user_profile.major].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
          <StatMeters stats={stats} registerIcon={registerStatIcon} />
          <div className="appBarActions">
            <LanguageSwitcher inline />
            <button className="apiKeyEditTrigger apiKeyEditTrigger--inline" onClick={() => setShowKeyEditor(true)}>
              <img className="apiKeyEditTriggerIcon" src="/stickers/lock.svg" alt="" /> {t("top.travelKey")}
            </button>
            <button
              className={`imageGenerationToggle imageGenerationToggle--inline${imageGenerationEnabled ? " active" : ""}`}
              type="button"
              aria-pressed={imageGenerationEnabled}
              onClick={toggleImageGeneration}
            >
              <img className="imageGenerationToggleIcon" src={imageGenerationEnabled ? "/stickers/✅.png" : "/stickers/sparkle.png"} alt="" />
              {imageGenerationEnabled ? t("top.imagesOn") : t("top.imagesOff")}
            </button>
          </div>
        </header>
      ) : (
        <img className="journalTitleImage" src="/branding/title.png" alt="Future Life Simulator — Live, Learn, Grow" />
      )}

      {!hasAppBar && <LanguageSwitcher />}

      {stage !== "passport" && !hasAppBar && (
        <>
          <button className="apiKeyEditTrigger" onClick={() => setShowKeyEditor(true)}>
            <img className="apiKeyEditTriggerIcon" src="/stickers/lock.svg" alt="" /> {t("top.travelKey")}
          </button>
          <button
            className={`imageGenerationToggle${imageGenerationEnabled ? " active" : ""}`}
            type="button"
            aria-pressed={imageGenerationEnabled}
            onClick={toggleImageGeneration}
            disabled={stage === "timeskip"}
          >
            <img className="imageGenerationToggleIcon" src="/stickers/sparkle.png" alt="" />
            {imageGenerationEnabled ? t("top.imagesOn") : t("top.imagesOff")}
          </button>
        </>
      )}

      {showKeyEditor && (
        <div className="keyEditorOverlay" role="dialog" aria-modal="true">
          <PassportCard compact onComplete={() => setShowKeyEditor(false)} onCancel={() => setShowKeyEditor(false)} />
        </div>
      )}

      {stage === "passport" && <PassportCard onComplete={() => setStage("quiz")} />}

      {stage === "quiz" && <QuizFlow onComplete={startStory} />}

      {stage === "admission" && profile && <AdmissionLetter profile={profile} onAccept={acceptOffer} onDecline={restart} />}

      {stage === "timeskip" && profile && <TimeSkipLoader profile={profile} />}

      {stage === "error" && (
        <div className="journalCard passportCard">
          <h2>{t("error.title")}</h2>
          <p className="lede">{error}</p>
          <div className="journalButtonRow">
            <button className="journalButton" onClick={() => setStage("quiz")}>
              {t("error.tryAgain")}
            </button>
          </div>
        </div>
      )}

      {stage === "play" && story && currentNode && !ending && !gameOverReason && (
        <>
          {reusedStory && (
            <div className="reusedStoryBanner">
              <img className="inlineIcon" src="/stickers/sparkle.png" alt="" /> {t("story.reused")}
            </div>
          )}
          <SceneCard
            node={currentNode}
            caption={`${story.user_profile.city}, ${story.user_profile.country}`}
            schoolQuery={story.user_profile.school || story.user_profile.city}
            contextNote={story.framework_reason}
            sources={story.sources}
            onChoose={handleChoice}
          />
        </>
      )}

      {stage === "play" && story && gameOverReason && (
        <PostcardEnding
          ending={{
            scene_text: t("story.gameOverEnding", { reason: gameOverReason }),
            image_prompt: null,
            has_image: false,
            tone: "challenging",
          }}
          city={story.user_profile.city}
          country={story.user_profile.country}
          profileSummary={[story.user_profile.school, story.user_profile.grade, story.user_profile.major]
            .filter(Boolean)
            .join(" · ")}
          contextNote={story.framework_reason}
          stats={stats}
          sources={story.sources}
          onRestart={restart}
        />
      )}

      {stage === "play" && story && ending && !gameOverReason && (
        <PostcardEnding
          ending={ending}
          city={story.user_profile.city}
          country={story.user_profile.country}
          profileSummary={[story.user_profile.school, story.user_profile.grade, story.user_profile.major]
            .filter(Boolean)
            .join(" · ")}
          contextNote={story.framework_reason}
          stats={stats}
          sources={story.sources}
          onRestart={restart}
        />
      )}

      <Link className="devLink" to="/debug">
        dev
      </Link>
    </main>
  );
}
