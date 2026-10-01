import { LEARNING_POLICY, isLearningStory, durationLabel } from "../../../shared/studyDesign";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { applyLogicContentVariant, previewLogicDelta, type LogicVars, type LogicWarningsSeen } from "../lib/logicRuntime";
import { advanceStory, initialPlayState, type PlayState, type Checkpoint as FailureCheckpoint } from "../lib/storyRuntime";
import { DEFAULT_STATS } from "../lib/gameplay";
import { useI18n, type Language } from "../lib/i18n";
import { translateCopy } from "../lib/uiCopy";
import { storyLanguage, storyLanguageIssues } from "../../../shared/storyLanguage";
import type { Choice, EndingNode, FailureRecovery, StoryDocument, StoryNode } from "../types";
import "../styles/playDemo.css";

const DEMO_STORY_ID = "technische_universit_t_m_nchen_full_f81bb5c0b506";

function isStoryDocument(value: unknown): value is StoryDocument {
  return Boolean(value && typeof value === "object" && "nodes" in value && "endings" in value);
}

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

function stripChoicePrefix(choice: Choice): string {
  const prefix = choice.logic_choice_id;
  if (!prefix || !choice.text.startsWith(prefix)) return choice.text;
  return choice.text.slice(prefix.length).replace(/^\s*[:：]\s*/, "");
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

function friendlyVariableLabel(id: string, language: Language, fallback?: string): string {
  return LOGIC_LABELS[id] ? translateCopy(LOGIC_LABELS[id], language) : fallback ?? (language === "zh" ? "资源" : "resource");
}

function qualitativeChange(change: number, language: Language): string {
  const magnitude = Math.abs(change);
  if (magnitude >= 16) return language === "zh" ? "一大截" : "a large amount of ";
  if (magnitude >= 8) return language === "zh" ? "一些" : "some ";
  return language === "zh" ? "一点点" : "a little ";
}

function choiceEffectLines(choice: Choice, story: StoryDocument, logicVars: LogicVars, warningsSeen: LogicWarningsSeen, language: Language): { summary: string | null; warning: string | null; danger: boolean } {
  if (choice.next_node === story.logic?.warning_return_sentinel || choice.next_node === story.logic?.result_return_sentinel) return { summary: null, warning: null, danger: false };
  const entries = Object.entries(choice.logic_delta ?? {}).filter(([, change]) => change !== 0);
  const target = story.nodes[choice.next_node] ?? story.endings[choice.next_node];
  const planned = choice.logic_planned_next_node ? story.nodes[choice.logic_planned_next_node] ?? story.endings[choice.logic_planned_next_node] : undefined;
  if (target?.failure_recovery || planned?.failure_recovery || target?.logic_page_role === "failure" || planned?.logic_page_role === "failure") {
    return { summary: null, warning: language === "zh" ? "这条路线包含严重后果案例；可以了解后回看选择、再次尝试。" : "This route includes a serious consequence; you can learn from it, review your decision and retry.", danger: true };
  }
  const losses = entries.filter(([, change]) => change < 0).map(([id, change]) => `${qualitativeChange(change, language)}${friendlyVariableLabel(id, language)}`);
  const gains = entries.filter(([, change]) => change > 0).map(([id, change]) => `${qualitativeChange(change, language)}${friendlyVariableLabel(id, language)}`);
  let summary: string | null = null;
  if (losses.length && gains.length) summary = language === "zh" ? `拿${losses.join("、")}，换${gains.join("、")}。` : `Trade ${losses.join(", ")} for ${gains.join(", ")}.`;
  else if (losses.length) summary = language === "zh" ? `会消耗${losses.join("、")}。` : `Uses ${losses.join(", ")}.`;
  else if (gains.length) summary = language === "zh" ? `会收获${gains.join("、")}。` : `Gains ${gains.join(", ")}.`;

  const preview = previewLogicDelta(logicVars, choice.logic_delta, story.logic?.variables ?? [], warningsSeen, isLearningStory(story));
  if (preview.criticalVariables.length) {
    return {
      summary,
      warning: `${preview.criticalVariables.map((variable) => friendlyVariableLabel(variable.id, language, variable.label)).join(language === "zh" ? "、" : ", ")}${language === "zh" ? "会直接撞上极限；点下去将进入变量失败页。" : " will reach a critical limit and lead to failure."}`,
      danger: true,
    };
  }
  if (preview.warningVariables.length) {
    return {
      summary,
      warning: `${preview.warningVariables.map((variable) => friendlyVariableLabel(variable.id, language, variable.label)).join(language === "zh" ? "、" : ", ")}${language === "zh" ? "需要关注；了解提示后可以继续探索。" : " needs attention; read the guidance, then continue exploring."}`,
      danger: false,
    };
  }
  if (preview.approachingVariables.length) {
    return {
      summary,
      warning: `${preview.approachingVariables.map((variable) => friendlyVariableLabel(variable.id, language, variable.label)).join(language === "zh" ? "、" : ", ")}${language === "zh" ? "需要提前规划；可以留意后续的支持建议。" : " needs some planning; look for support in the next steps."}`,
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

function checkpointLabel(story: StoryDocument, checkpoint: FailureCheckpoint): string {
  const page = story.nodes[checkpoint.nodeId] ?? story.endings[checkpoint.nodeId];
  const label = page?.annotation?.current_step?.trim() || page?.scene_text?.split(/[。！？.!?]/)[0]?.trim() || checkpoint.nodeId;
  return label.length > 46 ? `${label.slice(0, 46)}……` : label;
}

function recoveryText(recovery: FailureRecovery, story: StoryDocument, checkpoint: FailureCheckpoint): string {
  return recovery.scene_text.split("{previous_node}").join(`“${checkpointLabel(story, checkpoint)}”`);
}

export default function PlayableDemoPage() {
  const { language, copy, t } = useI18n();
  const [searchParams] = useSearchParams();
  const storyId = searchParams.get("storyId")?.trim() || DEMO_STORY_ID;
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [playState, setPlayState] = useState<PlayState | null>(null);
  const { nodeId: currentNodeId = "", logicVars = {}, logicWarningsSeen = {}, failureCheckpoint = null } = playState ?? {};
  const choiceLock = useRef(false);
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
        setPlayState(null);
        setError(null);
        const fetched = await fetchStory(storyId);
        const doc = { ...fetched, learning_policy: LEARNING_POLICY };
        if (!isStoryDocument(doc)) throw new Error("missing");
        if (storyLanguage(doc) !== language || storyLanguageIssues(doc, language).length) throw new Error("language");
        if (cancelled) return;
        const initial = initialPlayState(doc);
        setStory(doc);
        setPlayState(initial);
        setShowingFailureRecovery(false);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(copy(err instanceof Error && err.message === "language" ? "此故事的正文语言与当前选择不一致，请返回首页选择同语言故事。" : "无法打开这个故事，请返回首页选择其他故事。"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDemo();
    return () => {
      cancelled = true;
    };
  }, [storyId, language]);

  useEffect(() => { choiceLock.current = false; }, [currentNodeId]);

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
    setPlayState(initialPlayState(story));
    choiceLock.current = false;
    setError(null);
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
    setPlayState({ ...failureCheckpoint, failureCheckpoint: null, failedStat: null });
    choiceLock.current = false;
    setShowingFailureRecovery(false);
  }

  function handleChoice(choice: Choice) {
    if (!story || !playState || choiceLock.current) return;
    choiceLock.current = true;
    try {
      setPlayState(advanceStory(story, playState, choice));
      setShowingFailureRecovery(false);
    } catch {
      choiceLock.current = false;
      setError(copy("故事的下一页不存在，请重新开始或返回首页。"));
    }
  }

  return (
    <main className="playDemo">
      {loading && <section className="playDemoState">{copy("正在加载生成好的故事...")}</section>}
      {error && <section className="playDemoState playDemoState--error"><p>{error}</p><Link to="/">{copy("回首页")}</Link></section>}

      {story && currentNode && !error && (
        <section className="playDemoGrid">
          <section className={`playDemoScene ${ending ? "playDemoScene--ending" : ""}`}>
            <div className="playDemoSceneHead">
              <span>{recoveryActive ? copy("时空回卷") : failureRecovery ? copy("失败页") : copy(roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node")))}</span>
              <div className="playDemoSceneActions">
                <Link to="/" data-tutorial="home">{copy("回首页")}</Link>
                <button type="button" onClick={restart} data-tutorial="restart">{copy("重新开始")}</button>
              </div>
            </div>

            <p className="playDemoDecisionPrompt" data-testid="learning-mode">{language === "zh" ? "学习模式：资源数值只用于提示，不会自动终止旅程。遇到严重后果，可以回看并重新选择。" : "Learning mode: resource scores give guidance and never automatically end your journey. Review and retry when a serious consequence occurs."}</p>
            {story.study_duration && <p className="playDemoDecisionPrompt">{durationLabel(story.study_duration, language)}</p>}
            {!story.logic && <div className="legacyStats" aria-label={t("stats.group")}>
              {Object.entries(playState?.stats ?? DEFAULT_STATS).map(([key, value]) => <span key={key}>{t(`stats.${key}`)}: {value}</span>)}
            </div>}
            {playState?.failedStat && <div className="playDemoState"><p>{t("story.gameOver", { stat: t(`stats.${playState.failedStat}`) })}</p><button onClick={restart}>{copy("再玩一轮")}</button></div>}
            <article className={`playDemoText ${recoveryActive ? "playDemoText--recovery" : ""}`} aria-live="polite" data-tutorial="story">
              {recoveryActive && failureRecovery && failureCheckpoint ? (
                <div className="playDemoRecovery" data-testid="failure-recovery-scene">
                  <span>{copy("纯属虚构的时间线维修插曲")}</span>
                  <h2>{failureRecovery.title}</h2>
                  <p>{recoveryText(failureRecovery, story, failureCheckpoint)}</p>
                  <small>{copy("现实中的签证、学业、健康与财务后果不会自动撤销；这里的回卷只服务于游戏重试。")}</small>
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
                <p className="playDemoDecisionPrompt">{language === "zh" ? "你已经了解这条路线的后果。可以回到决定前，继续尝试。" : "You have learned the consequence of this route. Return to the decision and explore another approach."}</p>
                <button className="playDemoChoice playDemoChoice--recovery" type="button" onClick={returnFromFailure} data-testid="learning-retry"><span>↶</span><strong>{language === "zh" ? "回看选择，继续探索" : "Review the decision and keep exploring"}</strong></button>
                <button className="playDemoChoice playDemoChoice--recovery" type="button" onClick={beginFailureRecovery} data-testid="failure-recovery-open">
                  <span>🌀</span>
                  <strong>{copy("打开失败页附赠的时空回卷")}</strong>
                </button>
              </div>
            )}

            {!ending && !playState?.failedStat && !canRecover && !recoveryActive && (
              <div className="playDemoDecision" data-tutorial="choices">
                <p className="playDemoDecisionPrompt">{copy("你会怎么做？")}</p>
                <div className="playDemoChoices">
                  {(currentNode as StoryNode).choices.map((choice, index) => {
                    const preview = choiceEffectLines(choice, story, logicVars, logicWarningsSeen, language);
                    return (
                      <button
                        className={`playDemoChoice playDemoChoice--${index} ${preview.danger ? "playDemoChoice--danger" : ""}`}
                        key={`${choice.next_node}-${index}`}
                        onClick={(event) => { if (event.detail <= 1) handleChoice(choice); }}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <span className="playDemoChoiceCopy">
                          <strong>{stripChoicePrefix(choice)}</strong>
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
                    <strong>{copy(roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node")))}</strong>
                  </div>
                </div>
              )}
              {recoveryActive && <span className="playDemoRecoveryStamp">{copy("时间线已修复")}</span>}
            </div>

            {ending && !canRecover && !recoveryActive && (
              <div className={`playDemoEnding playDemoEnding--${t(`tone.${ending.tone}`)}`}>
                <span>{ending.tone}</span>
                <button type="button" onClick={restart}>{copy("再玩一轮")}</button>
              </div>
            )}
          </section>
          <footer className="playDemoPageFooter">
            <button type="button" onClick={() => setTutorialOpen(true)} data-testid="tutorial-reopen">
              <span aria-hidden="true">🦉</span>
              {copy("新手指引")}
            </button>
          </footer>
          <GameTutorial open={tutorialOpen} onFinish={finishTutorial} />
        </section>
      )}
    </main>
  );
}
