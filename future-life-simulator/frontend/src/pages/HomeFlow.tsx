import { useState } from "react";
import { Link } from "react-router-dom";
import PassportCard from "../components/PassportCard";
import QuizFlow from "../components/QuizFlow";
import DreamingLoader from "../components/DreamingLoader";
import SceneCard from "../components/SceneCard";
import PostcardEnding from "../components/PostcardEnding";
import { buildRuntimeConfig, generateStory } from "../lib/api";
import { hasStoredApiKey } from "../lib/storage";
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

  async function startStory(nextProfile: UserProfile) {
    setProfile(nextProfile);
    setStage("dreaming");
    setError(null);
    try {
      const doc = await generateStory({
        mode: "live_search",
        profile: nextProfile,
        runtimeConfig: buildRuntimeConfig(),
      });
      setStory(doc);
      setCurrentNodeId(Object.keys(doc.nodes)[0] ?? "A");
      setStats(doc.initial_stats ?? DEFAULT_STATS);
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

  return (
    <main className={`journal ${stage === "passport" ? "journal--onboarding" : ""}`}>
      <img className="journalTitleImage" src="/branding/title.png" alt="Future Life Simulator — Live, Learn, Grow" />

      {stage !== "passport" && (
        <button className="apiKeyEditTrigger" onClick={() => setShowKeyEditor(true)}>
          🔑 API key
        </button>
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
              ✨ Reusing a story we already generated for this exact profile — no need to regenerate.
            </div>
          )}
          <SceneCard
            node={currentNode}
            caption={`${story.user_profile.city}, ${story.user_profile.country}`}
            stats={stats}
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
          onRestart={restart}
        />
      )}

      {stage === "play" && story && ending && !gameOverReason && (
        <PostcardEnding ending={ending} city={story.user_profile.city} country={story.user_profile.country} onRestart={restart} />
      )}

      <Link className="devLink" to="/debug">
        dev
      </Link>
    </main>
  );
}
