import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchStory } from "../lib/api";
import InlineAnnotatedText from "../components/InlineAnnotatedText";
import GameTutorial from "../components/GameTutorial";
import {
  STORY_TUTORIAL_COMPLETED_KEY,
  STORY_TUTORIAL_PENDING_KEY,
  readTutorialFlag,
  writeTutorialFlag,
} from "../lib/tutorialState";
import {
  applyLogicContentVariant,
  applyLogicDelta,
  findCriticalVariable,
  findNewBadVariable,
  initLogicVars,
  previewLogicDelta,
  type LogicVars,
  type LogicWarningsSeen,
} from "../lib/logicRuntime";
import type { Choice, EndingNode, FailureRecovery, StoryDocument, StoryNode } from "../types";
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

const LOGIC_LABELS: Record<string, string> = {
  money: "钱包厚度",
  time: "时间余量",
  visa: "签证把握",
  housing: "住房安稳度",
  school: "学业状态",
  wellbeing: "身心电量",
  local_language: "当地语言熟练度",
  career: "职业筹码",
  academic_network: "学术人脉",
  gpa: "成绩余量",
};

function friendlyVariableLabel(id: string, fallback?: string): string {
  return LOGIC_LABELS[id] ?? fallback ?? id.split("_").join(" ");
}

function qualitativeChange(change: number): string {
  const magnitude = Math.abs(change);
  if (magnitude >= 16) return "一大截";
  if (magnitude >= 8) return "一些";
  return "一点点";
}

function choiceEffectLines(choice: Choice, story: StoryDocument, logicVars: LogicVars, warningsSeen: LogicWarningsSeen): { summary: string | null; warning: string | null; danger: boolean } {
  const entries = Object.entries(choice.logic_delta ?? {}).filter(([, change]) => change !== 0);
  const losses = entries.filter(([, change]) => change < 0).map(([id, change]) => `${qualitativeChange(change)}${friendlyVariableLabel(id)}`);
  const gains = entries.filter(([, change]) => change > 0).map(([id, change]) => `${qualitativeChange(change)}${friendlyVariableLabel(id)}`);
  let summary: string | null = null;
  if (losses.length && gains.length) summary = `拿${losses.join("、")}，换${gains.join("、")}——宇宙不收现金，只收取舍。`;
  else if (losses.length) summary = `会消耗${losses.join("、")}，这张选择看起来正在刷你的资源卡。`;
  else if (gains.length) summary = `会收获${gains.join("、")}，属于命运难得主动发优惠券。`;

  const preview = previewLogicDelta(logicVars, choice.logic_delta, story.logic?.variables ?? [], warningsSeen);
  if (preview.criticalVariables.length) {
    return {
      summary,
      warning: `${preview.criticalVariables.map((variable) => friendlyVariableLabel(variable.id, variable.label)).join("、")}会直接撞上极限；点下去将进入变量失败页。`,
      danger: true,
    };
  }
  if (preview.warningVariables.length) {
    return {
      summary,
      warning: `${preview.warningVariables.map((variable) => friendlyVariableLabel(variable.id, variable.label)).join("、")}将滑入危险区，系统会先亮出警告牌。`,
      danger: false,
    };
  }
  if (preview.approachingVariables.length) {
    return {
      summary,
      warning: `${preview.approachingVariables.map((variable) => friendlyVariableLabel(variable.id, variable.label)).join("、")}正在靠近危险区，再薅一次可能就要听见警报。`,
      danger: false,
    };
  }
  return { summary, warning: null, danger: false };
}

function sceneAsset(nodeId: string, node: StoryNode | EndingNode): string {
  const haystack = `${nodeId} ${node.scene_text}`.toLowerCase();
  if (haystack.includes("career") || haystack.includes("job") || haystack.includes("intern")) return "/branding/career.png";
  if (haystack.includes("housing") || haystack.includes("dorm") || haystack.includes("rent")) return "/branding/dorm.png";
  if (haystack.includes("lab") || haystack.includes("course") || haystack.includes("school")) return "/branding/lecture.png";
  if (haystack.includes("visa") || haystack.includes("coe") || haystack.includes("ward")) return "/branding/compass.png";
  if (haystack.includes("language") || haystack.includes("japanese")) return "/branding/social.png";
  if (haystack.includes("typhoon") || haystack.includes("arrival") || haystack.includes("tokyo")) return "/branding/campus.png";
  if (node.failure_recovery || node.logic_page_role === "warning" || node.logic_page_role === "failure") return "/stickers/lock.svg";
  return "/branding/mascot.png";
}

type FailureCheckpoint = {
  nodeId: string;
  logicVars: LogicVars;
  logicWarningsSeen: LogicWarningsSeen;
  warningReturnNodeId: string | null;
  resultReturnNodeId: string | null;
};

function checkpointLabel(story: StoryDocument, checkpoint: FailureCheckpoint): string {
  const page = story.nodes[checkpoint.nodeId] ?? story.endings[checkpoint.nodeId];
  const label = page?.annotation?.current_step?.trim() || page?.scene_text?.split(/[。！？.!?]/)[0]?.trim() || checkpoint.nodeId;
  return label.length > 46 ? `${label.slice(0, 46)}……` : label;
}

function recoveryText(recovery: FailureRecovery, story: StoryDocument, checkpoint: FailureCheckpoint): string {
  return recovery.scene_text.split("{previous_node}").join(`“${checkpointLabel(story, checkpoint)}”`);
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
  const [failureCheckpoint, setFailureCheckpoint] = useState<FailureCheckpoint | null>(null);
  const [showingFailureRecovery, setShowingFailureRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

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
        setFailureCheckpoint(null);
        setShowingFailureRecovery(false);
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

  useEffect(() => {
    if (!story || !currentNodeId) return;
    const continuingFromHome = readTutorialFlag(STORY_TUTORIAL_PENDING_KEY);
    if (!continuingFromHome && readTutorialFlag(STORY_TUTORIAL_COMPLETED_KEY)) return;
    const timer = window.setTimeout(() => setTutorialOpen(true), 450);
    return () => window.clearTimeout(timer);
  }, [story, currentNodeId]);

  const rawCurrentNode = story ? story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null : null;
  const currentNode = story && rawCurrentNode ? applyLogicContentVariant(story, currentNodeId, rawCurrentNode, logicVars) : null;
  const ending = currentNode && isEnding(currentNode) ? currentNode : null;
  const failureRecovery = currentNode?.failure_recovery;
  const canRecover = Boolean(failureRecovery && failureCheckpoint);
  const recoveryActive = Boolean(showingFailureRecovery && failureRecovery && failureCheckpoint);
  const storyGlossaryTerms = useMemo(() => {
    if (!story) return [];
    const pages = [...Object.values(story.nodes), ...Object.values(story.endings)];
    const seen = new Set<string>();
    return [...(story.glossary_terms ?? []), ...pages.flatMap((page) => page.annotation?.terms ?? [])].filter((term) => {
      const key = term.term.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [story]);

  function restart() {
    if (!story) return;
    setCurrentNodeId(story.logic?.start_node_id ?? Object.keys(story.nodes)[0] ?? "");
    setLogicVars(initLogicVars(story));
    setLogicWarningsSeen({});
    setWarningReturnNodeId(null);
    setResultReturnNodeId(null);
    setFailureCheckpoint(null);
    setShowingFailureRecovery(false);
  }

  function finishTutorial() {
    writeTutorialFlag(STORY_TUTORIAL_COMPLETED_KEY, true);
    writeTutorialFlag(STORY_TUTORIAL_PENDING_KEY, false);
    setTutorialOpen(false);
  }

  function beginFailureRecovery() {
    if (!failureRecovery || !failureCheckpoint) return;
    setShowingFailureRecovery(true);
  }

  function returnFromFailure() {
    if (!failureCheckpoint) return;
    setCurrentNodeId(failureCheckpoint.nodeId);
    setLogicVars({ ...failureCheckpoint.logicVars });
    setLogicWarningsSeen({ ...failureCheckpoint.logicWarningsSeen });
    setWarningReturnNodeId(failureCheckpoint.warningReturnNodeId);
    setResultReturnNodeId(failureCheckpoint.resultReturnNodeId);
    setFailureCheckpoint(null);
    setShowingFailureRecovery(false);
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
      const checkpoint: FailureCheckpoint = {
        nodeId: currentNodeId,
        logicVars: { ...logicVars },
        logicWarningsSeen: { ...logicWarningsSeen },
        warningReturnNodeId,
        resultReturnNodeId,
      };
      const directTarget = story.nodes[choice.next_node] ?? story.endings[choice.next_node];
      const plannedTarget = choice.logic_planned_next_node
        ? story.nodes[choice.logic_planned_next_node] ?? story.endings[choice.logic_planned_next_node]
        : undefined;
      const leadsToRecoverableFailure = Boolean(directTarget?.failure_recovery || plannedTarget?.failure_recovery);
      if (leadsToRecoverableFailure) setFailureCheckpoint(checkpoint);
      else setFailureCheckpoint(null);
      setShowingFailureRecovery(false);

      const nextLogicVars = applyLogicDelta(logicVars, choice.logic_delta);
      setLogicVars(nextLogicVars);
      if (choice.logic_planned_next_node) setResultReturnNodeId(choice.logic_planned_next_node);

      const critical = findCriticalVariable(nextLogicVars, story.logic.variables);
      if (critical) {
        setFailureCheckpoint(checkpoint);
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
      {loading && <section className="playDemoState">正在加载生成好的故事...</section>}
      {error && <section className="playDemoState playDemoState--error">{error}</section>}

      {story && currentNode && (
        <section className="playDemoGrid">
          <section className={`playDemoScene ${ending ? "playDemoScene--ending" : ""}`}>
            <div className="playDemoSceneHead">
              <span>{recoveryActive ? "时空回卷" : failureRecovery ? "失败页" : roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node"))}</span>
              <div className="playDemoSceneActions">
                <Link to="/" data-tutorial="home">回首页</Link>
                <button type="button" onClick={restart} data-tutorial="restart">重新开始</button>
              </div>
            </div>

            <article className={`playDemoText ${recoveryActive ? "playDemoText--recovery" : ""}`} aria-live="polite" data-tutorial="story">
              {recoveryActive && failureRecovery && failureCheckpoint ? (
                <div className="playDemoRecovery" data-testid="failure-recovery-scene">
                  <span>纯属虚构的时间线维修插曲</span>
                  <h2>{failureRecovery.title}</h2>
                  <p>{recoveryText(failureRecovery, story, failureCheckpoint)}</p>
                  <small>现实中的签证、学业、健康与财务后果不会自动撤销；这里的回卷只服务于游戏重试。</small>
                </div>
              ) : (
                <InlineAnnotatedText
                  text={currentNode.scene_text}
                  terms={currentNode.annotation?.terms}
                  evidenceIds={currentNode.annotation?.evidence_ids}
                  sources={story.sources}
                  profile={story.user_profile}
                  glossaryTerms={storyGlossaryTerms}
                  referenceProfiles={story.reference_profiles}
                />
              )}
            </article>

            {recoveryActive && failureRecovery && (
              <div className="playDemoDecision playDemoRecoveryAction">
                <button className="playDemoChoice playDemoChoice--recovery" type="button" onClick={returnFromFailure} data-testid="failure-recovery-return">
                  <span>↶</span>
                  <strong>{failureRecovery.return_choice_text}</strong>
                </button>
              </div>
            )}

            {!recoveryActive && canRecover && (
              <div className="playDemoDecision playDemoRecoveryAction">
                <p className="playDemoDecisionPrompt">这条时间线撞墙了。要不要看看宇宙准备了什么补丁？</p>
                <button className="playDemoChoice playDemoChoice--recovery" type="button" onClick={beginFailureRecovery} data-testid="failure-recovery-open">
                  <span>🌀</span>
                  <strong>打开失败页附赠的时空回卷</strong>
                </button>
              </div>
            )}

            {!ending && !canRecover && !recoveryActive && (
              <div className="playDemoDecision" data-tutorial="choices">
                <p className="playDemoDecisionPrompt">你会怎么做？</p>
                <div className="playDemoChoices">
                  {(currentNode as StoryNode).choices.map((choice, index) => {
                    const preview = choiceEffectLines(choice, story, logicVars, logicWarningsSeen);
                    return (
                      <button
                        className={`playDemoChoice playDemoChoice--${index} ${preview.danger ? "playDemoChoice--danger" : ""}`}
                        key={`${choice.next_node}-${index}`}
                        onClick={() => handleChoice(choice)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <span className="playDemoChoiceCopy">
                          <strong>{stripChoicePrefix(choice.text)}</strong>
                          {preview.summary && <small className="playDemoChoiceEffect">{preview.summary}</small>}
                          {preview.warning && <small className="playDemoChoiceWarning">⚠ {preview.warning}</small>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={`playDemoVisual ${recoveryActive ? "playDemoVisual--recovery" : ""}`} aria-hidden="true" data-tutorial="visual">
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
              {recoveryActive && <span className="playDemoRecoveryStamp">TIMELINE<br />REPAIRED</span>}
            </div>

            {ending && !canRecover && !recoveryActive && (
              <div className={`playDemoEnding playDemoEnding--${ending.tone}`}>
                <span>{ending.tone}</span>
                <button type="button" onClick={restart}>再玩一轮</button>
              </div>
            )}
          </section>
          <footer className="playDemoPageFooter">
            <button type="button" onClick={() => setTutorialOpen(true)} data-testid="tutorial-reopen">
              <span aria-hidden="true">🦉</span>
              新手指引
            </button>
          </footer>
          <GameTutorial open={tutorialOpen} onFinish={finishTutorial} />
        </section>
      )}
    </main>
  );
}
