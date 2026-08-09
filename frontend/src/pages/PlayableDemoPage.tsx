import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchStory } from "../lib/api";
import { applyStatDelta, DEFAULT_STATS } from "../lib/gameplay";
import {
  applyLogicContentVariant,
  applyLogicDelta,
  findCriticalVariable,
  findNewBadVariable,
  initLogicVars,
  logicBand,
  type LogicBand,
  type LogicVars,
  type LogicWarningsSeen,
} from "../lib/logicRuntime";
import type { Choice, EndingNode, PageAnnotation, StatBlock, StoryDocument, StoryNode, StorySource } from "../types";
import "../styles/playDemo.css";

const DEMO_STORY_ID = "technische_universit_t_m_nchen_full_f81bb5c0b506";

type RouteEvent = {
  id: number;
  label: string;
  target: string;
  vars: LogicVars;
};

function isStoryDocument(value: unknown): value is StoryDocument {
  return Boolean(value && typeof value === "object" && "nodes" in value && "endings" in value);
}

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

function stripChoicePrefix(text: string): string {
  return text.replace(/^[^:：]+[:：]\s*/, "");
}

function bandLabel(band: LogicBand): string {
  if (band === "good") return "好";
  if (band === "mid") return "中";
  if (band === "bad") return "差";
  return "非常差";
}

function deltaLabel(delta?: Record<string, number>): string {
  const entries = Object.entries(delta ?? {}).filter(([, value]) => value !== 0);
  if (entries.length === 0) return "变量不变";
  return entries.map(([key, value]) => `${key}${value > 0 ? "+" : ""}${value}`).join("  ");
}

function choiceKind(index: number): string {
  if (index === 0) return "正常";
  if (index === 1) return "好的偏激";
  return "坏的偏激";
}

function statLabel(key: keyof StatBlock): string {
  if (key === "health") return "健康";
  if (key === "mood") return "心态";
  if (key === "money") return "金钱";
  return "学业";
}

function currentCaption(story: StoryDocument): string {
  return [story.user_profile.school, story.user_profile.department, story.user_profile.city].filter(Boolean).join(" · ");
}

function roleLabel(role?: string): string {
  if (role === "result") return "选择后页面";
  if (role === "warning") return "变量警告页";
  if (role === "failure") return "失败结局";
  if (role === "ending") return "结局";
  return "剧情节点";
}

function sourceId(source: StorySource, index: number): string {
  return source.evidence_id?.trim() || `S${String(index + 1).padStart(2, "0")}`;
}

function legacyAnnotation(nodeId: string, node: StoryNode | EndingNode): PageAnnotation {
  const ending = isEnding(node);
  const role = node.logic_page_role ?? (ending ? "ending" : "node");
  if (ending) {
    return {
      cause: "此前的选择和状态共同把路线带到了这个结局。",
      current_step: node.insight || "这里汇总整条留学路线最终形成的状态。",
      consequence: node.scene_text,
      next_impact: "重新游玩时，可以比较哪些更早的准备、求助或风险选择改变了结果。",
      terms: [],
      evidence_ids: [],
    };
  }
  if (role === "result") {
    return {
      cause: "你刚才选择的行动把路线带到了这个直接结果。",
      current_step: node.insight || "这里说明该行动造成的现实影响。",
      consequence: "本页保留了该选择带来的状态变化；继续后会按原路线进入下一项流程。",
      next_impact: "后续节点会继续读取累积状态，过低的关键条件仍可能触发警告或失败。",
      terms: [],
      evidence_ids: [],
    };
  }
  if (role === "warning") {
    return {
      cause: "此前选择已使一项关键条件进入需要注意的状态。",
      current_step: node.insight || "这是一次可挽回的风险提醒，不是最终失败。",
      consequence: "确认后会回到刚才被打断的结果页。",
      next_impact: "如果同一条件继续恶化，路线可能进入相应失败结局。",
      terms: [],
      evidence_ids: [],
    };
  }
  return {
    cause: `你已沿既定流程进入 ${nodeId}。`,
    current_step: node.insight || "这里是一项需要你作出取舍的现实留学流程。",
    consequence: "每个选项都会先进入自己的结果页，并改变相应状态。",
    next_impact: "结果页会说明行动影响，再进入该选项连接的后续流程。",
    terms: [],
    evidence_ids: [],
  };
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
  const [stats, setStats] = useState<StatBlock>(DEFAULT_STATS);
  const [logicVars, setLogicVars] = useState<LogicVars>({});
  const [logicWarningsSeen, setLogicWarningsSeen] = useState<LogicWarningsSeen>({});
  const [warningReturnNodeId, setWarningReturnNodeId] = useState<string | null>(null);
  const [resultReturnNodeId, setResultReturnNodeId] = useState<string | null>(null);
  const [history, setHistory] = useState<RouteEvent[]>([]);
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
        setStats({ ...DEFAULT_STATS, ...doc.initial_stats });
        setLogicVars(initLogicVars(doc));
        setLogicWarningsSeen({});
        setWarningReturnNodeId(null);
        setResultReturnNodeId(null);
        setHistory([]);
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
  const annotation = currentNode ? currentNode.annotation ?? legacyAnnotation(currentNodeId, currentNode) : null;
  const safeSources = (story?.sources ?? []).filter((source) => /^https?:\/\//i.test(source.url));
  const sourceMap = new Map(safeSources.map((source, index) => [sourceId(source, index), source]));
  const citedSources = annotation?.evidence_ids.length
    ? annotation.evidence_ids.flatMap((id) => {
        const source = sourceMap.get(id);
        return source ? [{ id, source }] : [];
      })
    : safeSources.slice(0, 8).map((source, index) => ({ id: sourceId(source, index), source }));

  const visibleVariables = useMemo(() => story?.logic?.variables ?? [], [story]);

  function addHistory(label: string, target: string, vars: LogicVars) {
    setHistory((current) => [{ id: Date.now() + current.length, label, target, vars }, ...current].slice(0, 8));
  }

  function restart() {
    if (!story) return;
    setCurrentNodeId(story.logic?.start_node_id ?? Object.keys(story.nodes)[0] ?? "");
    setStats({ ...DEFAULT_STATS, ...story.initial_stats });
    setLogicVars(initLogicVars(story));
    setLogicWarningsSeen({});
    setWarningReturnNodeId(null);
    setResultReturnNodeId(null);
    setHistory([]);
  }

  function handleChoice(choice: Choice) {
    if (!story) return;
    if (story.logic && choice.next_node === story.logic.warning_return_sentinel) {
      const target = warningReturnNodeId ?? story.logic.start_node_id;
      addHistory("警告页返回", target, logicVars);
      setCurrentNodeId(target);
      setWarningReturnNodeId(null);
      return;
    }

    if (story.logic && choice.next_node === story.logic.result_return_sentinel) {
      const target = resultReturnNodeId ?? story.logic.start_node_id;
      addHistory("结果页继续", target, logicVars);
      setCurrentNodeId(target);
      setResultReturnNodeId(null);
      return;
    }

    const nextStats = applyStatDelta(stats, choice.stat_delta);
    setStats(nextStats);

    if (story.logic) {
      const nextLogicVars = applyLogicDelta(logicVars, choice.logic_delta);
      setLogicVars(nextLogicVars);
      if (choice.logic_planned_next_node) setResultReturnNodeId(choice.logic_planned_next_node);

      const critical = findCriticalVariable(nextLogicVars, story.logic.variables);
      if (critical) {
        addHistory(`${choice.logic_choice_id ?? "choice"} 触发斩杀线`, critical.failure_page_id, nextLogicVars);
        setCurrentNodeId(critical.failure_page_id);
        return;
      }

      const newlyBad = findNewBadVariable(logicVars, nextLogicVars, story.logic.variables, logicWarningsSeen);
      if (newlyBad) {
        setLogicWarningsSeen((current) => ({ ...current, [newlyBad.id]: true }));
        setWarningReturnNodeId(choice.next_node);
        addHistory(`${choice.logic_choice_id ?? "choice"} 触发警告`, newlyBad.warning_page_id, nextLogicVars);
        setCurrentNodeId(newlyBad.warning_page_id);
        return;
      }

      addHistory(choice.logic_choice_id ?? "choice", choice.next_node, nextLogicVars);
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
          <small className="playDemoRunId">{storyId}</small>
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
          <aside className="playDemoSidebar">
            <section className="playDemoPanel">
              <span className="playDemoPanelLabel">当前位置</span>
              <strong>{currentNodeId}</strong>
              <small>{currentCaption(story)}</small>
            </section>

            <section className="playDemoPanel">
              <span className="playDemoPanelLabel">基础状态</span>
              <div className="playDemoStats">
                {(Object.keys(stats) as Array<keyof StatBlock>).map((key) => (
                  <div className="playDemoStat" key={key}>
                    <span>{statLabel(key)}</span>
                    <meter min={0} max={100} value={stats[key]} />
                    <strong>{stats[key]}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="playDemoPanel">
              <span className="playDemoPanelLabel">逻辑变量</span>
              <div className="playDemoVars">
                {visibleVariables.map((variable) => {
                  const value = logicVars[variable.id] ?? variable.initial;
                  const band = logicBand(value);
                  return (
                    <div className={`playDemoVar playDemoVar--${band}`} key={variable.id}>
                      <div>
                        <strong>{variable.label}</strong>
                        <span>{variable.id}</span>
                      </div>
                      <meter min={0} max={100} value={value} />
                      <em>{value} / {bandLabel(band)}</em>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="playDemoPanel">
              <span className="playDemoPanelLabel">最近路线</span>
              <div className="playDemoHistory">
                {history.length === 0 ? (
                  <small>还没有选择。</small>
                ) : (
                  history.map((item) => (
                    <div key={item.id}>
                      <strong>{item.label}</strong>
                      <span>{item.target}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className={`playDemoScene ${ending ? "playDemoScene--ending" : ""}`}>
            <div className="playDemoSceneHead">
              <span>{roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node"))}</span>
              <button type="button" onClick={restart}>重新开始</button>
            </div>

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

            <article className="playDemoText">
              <p>{currentNode.scene_text}</p>
            </article>

            {!ending && (
              <div className="playDemoChoices">
                {(currentNode as StoryNode).choices.map((choice, index) => (
                  <button className={`playDemoChoice playDemoChoice--${index}`} key={`${choice.next_node}-${index}`} onClick={() => handleChoice(choice)}>
                    <span>{choice.logic_choice_id ?? `choice_${index + 1}`}</span>
                    <strong>{stripChoicePrefix(choice.text)}</strong>
                    <em>{choiceKind(index)}</em>
                    <small>{deltaLabel(choice.logic_delta)}</small>
                  </button>
                ))}
              </div>
            )}

            {ending && (
              <div className={`playDemoEnding playDemoEnding--${ending.tone}`}>
                <span>{ending.tone}</span>
                <button type="button" onClick={restart}>再玩一轮</button>
              </div>
            )}
          </section>

          {annotation && (
            <aside className="playDemoGuide" aria-label="本页流程说明与资料来源">
              <div className="playDemoGuideHead">
                <span>本页说明</span>
                <strong>{roleLabel(currentNode.logic_page_role ?? (ending ? "ending" : "node"))}</strong>
              </div>

              {currentNode.insight && (
                <section className="playDemoGuideHighlight">
                  <span>现实依据</span>
                  <p>{currentNode.insight}</p>
                </section>
              )}

              <section className="playDemoGuideBlock">
                <span>为什么会到这一步</span>
                <p>{annotation.cause}</p>
              </section>
              <section className="playDemoGuideBlock">
                <span>这一步是什么</span>
                <p>{annotation.current_step}</p>
              </section>
              <section className="playDemoGuideBlock">
                <span>直接后果</span>
                <p>{annotation.consequence}</p>
              </section>
              <section className="playDemoGuideBlock">
                <span>会影响什么</span>
                <p>{annotation.next_impact}</p>
              </section>

              {annotation.terms.length > 0 && (
                <section className="playDemoGuideBlock playDemoTerms">
                  <span>专业名词</span>
                  {annotation.terms.map((term) => (
                    <div key={`${term.term}-${term.evidence_ids.join("-")}`}>
                      <strong>{term.term}</strong>
                      <p>{term.explanation}</p>
                      <small>{term.evidence_ids.join(" · ")}</small>
                    </div>
                  ))}
                </section>
              )}

              <section className="playDemoGuideBlock playDemoSources">
                <span>资料来源</span>
                {citedSources.length > 0 ? (
                  citedSources.map(({ id, source }) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={`${id}-${source.url}`}>
                      <strong>{id} · {source.title}</strong>
                      <small>{source.source_type} · {source.confidence}</small>
                    </a>
                  ))
                ) : (
                  <p>本页没有引用具体政策、金额或专业名词；涉及个人办理时请以目标院校和官方机构的最新页面为准。</p>
                )}
              </section>
            </aside>
          )}
        </section>
      )}
    </main>
  );
}
