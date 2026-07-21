import { useState } from "react";
import { Link } from "react-router-dom";
import PassportCard from "../components/PassportCard";
import QuizFlow from "../components/QuizFlow";
import DreamingLoader from "../components/DreamingLoader";
import BackgroundMusic from "../components/BackgroundMusic";
import SceneCard, { StatMeters } from "../components/SceneCard";
import PostcardEnding from "../components/PostcardEnding";
import { buildRuntimeConfig, generateStory } from "../lib/api";
import { hasStoredApiKey, loadImageGenerationPreference, saveImageGenerationPreference } from "../lib/storage";
import { applyStatDelta, DEFAULT_STATS, getFailedStat } from "../lib/gameplay";
import type { Choice, EndingNode, StatBlock, StoryDocument, StoryNode, UserProfile } from "../types";

type FlowStage = "passport" | "quiz" | "dreaming" | "play" | "error";

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

export default function HomeFlow() {
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

  function toggleImageGeneration() {
    setImageGenerationEnabled((current) => {
      const next = !current;
      saveImageGenerationPreference(next);
      return next;
    });
  }

  async function startStory(nextProfile: UserProfile) {
    setProfile(nextProfile);
    setStage("dreaming");
    setError(null);
    try {
      // Even a cache hit resolves in a few milliseconds (it's just a JSON
      // file read), which made the "dreaming" loader flash by so fast it
      // looked broken/skipped. Keep it on screen for a minimum stretch so
      // the loading phase always feels real, whether the story was freshly
      // generated or reused from the cache.
      const minDreamTime = new Promise((resolve) => setTimeout(resolve, 4800));
      const [doc] = await Promise.all([
        generateStory({
          mode: "live_search",
          profile: nextProfile,
          runtimeConfig: buildRuntimeConfig(undefined, {
            enableImageGeneration: imageGenerationEnabled,
            maxImagesPerStory: imageGenerationEnabled ? 30 : 0,
          }),
        }),
        minDreamTime,
      ]);
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

  function handleChoice(choice: Choice) {
    const nextStats = applyStatDelta(stats, choice.stat_delta);
    setStats(nextStats);
    const failedStat = getFailedStat(nextStats);
    if (failedStat) {
      setGameOverReason(`Your ${failedStat} ran out.`);
      return;
    }
    setCurrentNodeId(choice.next_node);
  }

  function restart() {
    setStory(null);
    setProfile(null);
    setReusedStory(false);
    setStage("quiz");
  }

  const currentNode = story ? story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null : null;
  const ending = currentNode && isEnding(currentNode) ? currentNode : null;
  const isPlaying = stage === "play" && Boolean(story);

  return (
    <main className={`journal ${stage === "passport" ? "journal--onboarding" : ""} ${isPlaying ? "journal--play" : ""}`}>
      <BackgroundMusic playing={stage === "dreaming" || stage === "play"} />

      {isPlaying && story ? (
        <header className="appBar">
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
          <StatMeters stats={stats} />
        </header>
      ) : (
        <img className="journalTitleImage" src="/branding/title.png" alt="Future Life Simulator — Live, Learn, Grow" />
      )}

      {stage !== "passport" && (
        <>
          <button className="apiKeyEditTrigger" onClick={() => setShowKeyEditor(true)}>
            <img className="apiKeyEditTriggerIcon" src="/stickers/lock.svg" alt="" /> Travel key
          </button>
          <button
            className={`imageGenerationToggle${imageGenerationEnabled ? " active" : ""}`}
            type="button"
            aria-pressed={imageGenerationEnabled}
            onClick={toggleImageGeneration}
            disabled={stage === "dreaming"}
          >
            <img className="imageGenerationToggleIcon" src="/stickers/sparkle.png" alt="" />
            {imageGenerationEnabled ? "Images on" : "Images off"}
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

      {stage === "dreaming" && profile && <DreamingLoader profile={profile} />}

      {stage === "error" && (
        <div className="journalCard passportCard">
          <h2>Something went wrong</h2>
          <p className="lede">{error}</p>
          <div className="journalButtonRow">
            <button className="journalButton" onClick={() => setStage("quiz")}>
              Try again
            </button>
          </div>
        </div>
      )}

      {stage === "play" && story && currentNode && !ending && !gameOverReason && (
        <>
          {reusedStory && (
            <div className="reusedStoryBanner">
              <img className="inlineIcon" src="/stickers/sparkle.png" alt="" /> Reusing a story we already
              generated for this exact profile — no need to regenerate.
            </div>
          )}
          <SceneCard
            node={currentNode}
            caption={`${story.user_profile.city}, ${story.user_profile.country}`}
            contextNote={story.framework_reason}
            sources={story.sources}
            onChoose={handleChoice}
          />
        </>
      )}

      {stage === "play" && story && gameOverReason && (
        <PostcardEnding
          ending={{
            scene_text: `${gameOverReason} Your study-abroad story ends here — sometimes life abroad doesn't go as planned.`,
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
