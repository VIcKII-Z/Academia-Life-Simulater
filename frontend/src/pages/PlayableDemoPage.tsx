import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchStory } from "../lib/api";
import {
  applyLogicContentVariant,
  applyLogicDelta,
  findCriticalVariable,
  findNewBadVariable,
  initLogicVars,
  type LogicVars,
  type LogicWarningsSeen,
} from "../lib/logicRuntime";
import type { Choice, EndingNode, StoryDocument, StoryNode } from "../types";
import "../styles/playDemo.css";

const DEMO_STORY_ID = "technische_universit_t_m_nchen_full_f81bb5c0b506";

function isStoryDocument(value: unknown): value is StoryDocument {
  return Boolean(value && typeof value === "object" && "nodes" in value && "endings" in value);
}

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

function stripChoicePrefix(text: string): string {
  return text.replace(/^[^:：]+[:：]\s*/, "");
}

function roleLabel(role?: string): string {
  if (role === "result") return "选择后页面";
  if (role === "warning") return "变量警告页";
  if (role === "failure") return "失败结局";
  if (role === "ending") return "结局";
  return "剧情节点";
}

function sceneAsset(nodeId: string, node: StoryNode | EndingNode): string {
  const haystack = `${nodeId} ${node.scene_text}`.toLowerCase();
  if (haystack.includes("career") || haystack.includes("job") || haystack.includes("intern")) return "/branding/career.png";
  if (haystack.includes("housing") || haystack.includes("dorm") || haystack.includes("rent")) return "/branding/dorm.png";
  if (haystack.includes("lab") || haystack.includes("course") || haystack.includes("school")) return "/branding/lecture.png";
  if (haystack.includes("visa") || haystack.includes("coe") || haystack.includes("ward")) return "/branding/compass.png";
  if (haystack.includes("language") || haystack.includes("japanese")) return "/branding/social.png";
  if (haystack.includes("typhoon") || haystack.includes("arrival") || haystack.includes("tokyo")) return "/branding/campus.png";
  if (node.logic_page_role === "warning" || node.logic_page_role === "failure") return "/stickers/lock.svg";
  return "/branding/mascot.png";
}

export default function PlayableDemoPage() {
  const [searchParams] = useSearchParams();
  const storyId = searchParams.get("storyId")?.trim() || DEMO_STORY_ID;
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState("");
  const [logicVars, setLogicVars] = useState<LogicVars>({});
  const [logicWarningsSeen, setLogicWarningsSeen] = useState<LogicWarningsSeen>({});
  const [warningReturnNodeId, setWarningReturnNodeId] = useState<string | null>(null);
  const [resultReturnNodeId, setResultReturnNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadDemo() {
      try {
        setLoading(true);
        setStory(null);
        setCurrentNodeId("");
        setError(null);
        const doc = await fetchStory(storyId);
        if (!isStoryDocument(doc)) throw new Error(`没有找到 ${storyId} 的最终故事文件。`);
        if (cancelled) return;
        setStory(doc);
        setCurrentNodeId(doc.logic?.start_node_id ?? Object.keys(doc.nodes)[0] ?? "");
        setLogicVars(initLogicVars(doc));
        setLogicWarningsSeen({});
        setWarningReturnNodeId(null);
        setResultReturnNodeId(null);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDemo();
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  const rawCurrentNode = story ? story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null : null;
  const currentNode = story && rawCurrentNode ? applyLogicContentVariant(story, currentNodeId, rawCurrentNode, logicVars) : null;
  const ending = currentNode && isEnding(currentNode) ? currentNode : null;

  function restart() {
    if (!story) return;
    setCurrentNodeId(story.logic?.start_node_id ?? Object.keys(story.nodes)[0] ?? "");
    setLogicVars(initLogicVars(story));
    setLogicWarningsSeen({});
    setWarningReturnNodeId(null);
    setResultReturnNodeId(null);
  }

  function handleChoice(choice: Choice) {
    if (!story) return;
    if (story.logic && choice.next_node === story.logic.warning_return_sentinel) {
      const target = warningReturnNodeId ?? story.logic.start_node_id;
      setCurrentNodeId(target);
      setWarningReturnNodeId(null);
      return;
    }

    if (story.logic && choice.next_node === story.logic.result_return_sentinel) {
      const target = resultReturnNodeId ?? story.logic.start_node_id;
      setCurrentNodeId(target);
      setResultReturnNodeId(null);
      return;
    }

    if (story.logic) {
      const nextLogicVars = applyLogicDelta(logicVars, choice.logic_delta);
      setLogicVars(nextLogicVars);
      if (choice.logic_planned_next_node) setResultReturnNodeId(choice.logic_planned_next_node);

      const critical = findCriticalVariable(nextLogicVars, story.logic.variables);
      if (critical) {
        setCurrentNodeId(critical.failure_page_id);
        return;
      }

      const newlyBad = findNewBadVariable(logicVars, nextLogicVars, story.logic.variables, logicWarningsSeen);
      if (newlyBad) {
        setLogicWarningsSeen((current) => ({ ...current, [newlyBad.id]: true }));
        setWarningReturnNodeId(choice.next_node);
        setCurrentNodeId(newlyBad.warning_page_id);
        return;
      }
    }

    setCurrentNodeId(choice.next_node);
  }

  return (
    <main className="playDemo">
      <header className="playDemoTopbar">
        <div>
          <span className="playDemoKicker">Playable demo</span>
          <h1>
            {story
              ? `${story.user_profile.school || story.user_profile.city} · ${story.user_profile.major}`
              : "留学录取后路线"}
          </h1>
          {story && (
            <small className="playDemoRunId">
              {[story.user_profile.department, story.user_profile.city].filter(Boolean).join(" · ")}
            </small>
          )}
        </div>
        <nav>
          <Link to="/debug">逻辑树</Link>
          <Link to="/">回首页</Link>
        </nav>
      </header>

      {loading && <section className="playDemoState">正在加载生成好的故事...</section>}
      {error && <section className="playDemoState playDemoState--error">{error}</section>}

      {story && currentNode && (
        <section className="playDemoGrid">
          <section className={`playDemoScene ${ending ? "playDemoScene--ending" : ""}`}>
            <div className="playDemoSceneHead">
              <span>{roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node"))}</span>
              <button type="button" onClick={restart}>重新开始</button>
            </div>

            <article className="playDemoText">
              <p>{currentNode.scene_text}</p>
            </article>

            <div className="playDemoVisual" aria-hidden="true">
              {currentNode.image_url ? (
                <img src={currentNode.image_url} alt="" />
              ) : (
                <div className="playDemoVisualFallback">
                  <div className="playDemoVisualCard">
                    <img src={sceneAsset(currentNodeId, currentNode)} alt="" />
                    <strong>{roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node"))}</strong>
                    <span>{currentNodeId}</span>
                  </div>
                </div>
              )}
            </div>

            {!ending && (
              <div className="playDemoDecision">
                <p className="playDemoDecisionPrompt">你会怎么做？</p>
                <div className="playDemoChoices">
                  {(currentNode as StoryNode).choices.map((choice, index) => (
                    <button
                      className={`playDemoChoice playDemoChoice--${index}`}
                      key={`${choice.next_node}-${index}`}
                      onClick={() => handleChoice(choice)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{stripChoicePrefix(choice.text)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {ending && (
              <div className={`playDemoEnding playDemoEnding--${ending.tone}`}>
                <span>{ending.tone}</span>
                <button type="button" onClick={restart}>再玩一轮</button>
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}
