import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PassportCard from "../components/PassportCard";
import QuizFlow from "../components/QuizFlow";
import TimeSkipLoader from "../components/TimeSkipLoader";
import BackgroundMusic from "../components/BackgroundMusic";
import SceneCard, { StatMeters, STAT_CONFIG } from "../components/SceneCard";
import StatFlyers, { type StatFlyer } from "../components/StatFlyers";
import PostcardEnding from "../components/PostcardEnding";
import AdmissionLetter from "../components/AdmissionLetter";
import LanguageSwitcher from "../components/LanguageSwitcher";
import GameTutorial, { type TutorialStep } from "../components/GameTutorial";
import { buildRuntimeConfig, fetchCachedStories, startFullGeneration, waitForFullGeneration, type CachedStorySummary } from "../lib/api";
import { loadImageGenerationPreference, saveImageGenerationPreference } from "../lib/storage";
import {
  HOME_TUTORIAL_COMPLETED_KEY,
  STORY_TUTORIAL_PENDING_KEY,
  readTutorialFlag,
  writeTutorialFlag,
} from "../lib/tutorialState";
import { applyStatDelta, DEFAULT_STATS, getFailedStat } from "../lib/gameplay";
import {
  applyLogicDelta,
  applyLogicContentVariant,
  findCriticalVariable,
  findNewBadVariable,
  initLogicVars,
  type LogicVars,
  type LogicWarningsSeen,
} from "../lib/logicRuntime";
import { useI18n } from "../lib/i18n";
import type { Choice, EndingNode, StatBlock, StoryDocument, StoryNode, UserProfile } from "../types";

type FlowStage = "passport" | "quiz" | "admission" | "timeskip" | "play" | "error";

const HOME_TUTORIAL_STEPS: TutorialStep[] = [
  {
    kicker: "欢迎来到留学预演室",
    title: "先从你真正想去的地方开始",
    body: "嗨，我是向导小鸮。这里不是测你适不适合留学，而是把目标院校的真实流程变成一条可以试走、可以回头的时间线。",
  },
  {
    selector: '[data-tutorial="profile-flow"]',
    kicker: "第一步 · 告诉我目的地",
    title: "按顺序选择国家、城市、学校与项目",
    body: "系统会用这些信息检索学校、签证、费用、课程和就业资料。目标越具体，后面的故事与专有名词解释就越贴近你。",
  },
  {
    selector: '[data-tutorial="cached-library"]',
    kicker: "想先试玩？",
    title: "缓存故事可以直接打开",
    body: "这里保存已完整生成的路线，不会再次调用模型或图片接口。你可以先挑一所学校看看成品，再决定是否生成自己的。",
  },
  {
    selector: '[data-tutorial="image-toggle"]',
    kicker: "插图开关",
    title: "决定本轮是否生成场景插图",
    body: "打开后，生成器会为关键场景、警告和结局制作插图；关闭则只生成文字，速度更快，也不会产生图片调用。",
  },
  {
    selector: ".languageSwitcher",
    kicker: "选择叙事语言",
    title: "语言也会影响主角设定与货币提示",
    body: "中文路线默认以中国女性为主角，并提供人民币换算；英文路线面向斯里兰卡女性，并提供相应的语言与货币参考。",
  },
  {
    selector: '[data-tutorial="travel-key"]',
    kicker: "生成凭证",
    title: "需要时在这里配置 API",
    body: "新生成会使用这里保存的服务配置；直接打开缓存不需要调用 API。密钥只应保存在本机配置中，不要分享在聊天或截图里。",
  },
  {
    kicker: "首页认识完毕",
    title: "生成后，我会在故事页继续带路",
    body: "完成资料选择会先看到录取信，后台同时收集资料并生成故事。进入正式故事后，小鸮会继续介绍正文、红色术语、选项、插图与失败回退。",
  },
];

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

let flyerSeq = 0;

export default function HomeFlow() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [stage, setStage] = useState<FlowStage>("quiz");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState("A");
  const [stats, setStats] = useState<StatBlock>(DEFAULT_STATS);
  const [logicVars, setLogicVars] = useState<LogicVars>({});
  const [logicWarningsSeen, setLogicWarningsSeen] = useState<LogicWarningsSeen>({});
  const [warningReturnNodeId, setWarningReturnNodeId] = useState<string | null>(null);
  const [resultReturnNodeId, setResultReturnNodeId] = useState<string | null>(null);
  const [gameOverReason, setGameOverReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [reusedStory, setReusedStory] = useState(false);
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(loadImageGenerationPreference);
  const [flyers, setFlyers] = useState<StatFlyer[]>([]);
  const [cachedStories, setCachedStories] = useState<CachedStorySummary[]>([]);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // Positions of each stat's sticker icon in the top app bar, so a flyer
  // animation can be aimed at (or launched from) the exact right spot.
  const statIconRefs = useRef<Partial<Record<keyof StatBlock, HTMLImageElement>>>({});
  // Holds the in-flight /api/generate request so the agents can keep working
  // in the background while the player reads the admission letter and makes
  // their accept/decline call — instead of the player watching a blank
  // "dreaming" screen and THEN reading the letter, the two happen at once,
  // which shortens the total time-to-play whenever the letter + decision
  // takes longer than the agents still needed.
  const storyRequestRef = useRef<ReturnType<typeof waitForFullGeneration> | null>(null);

  useEffect(() => {
    if (stage !== "quiz") return;
    void fetchCachedStories(2).then(setCachedStories);
  }, [stage]);

  useEffect(() => {
    if (stage !== "quiz" || readTutorialFlag(HOME_TUTORIAL_COMPLETED_KEY)) return;
    const timer = window.setTimeout(() => setTutorialOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [stage]);

  function finishHomeTutorial() {
    writeTutorialFlag(HOME_TUTORIAL_COMPLETED_KEY, true);
    writeTutorialFlag(STORY_TUTORIAL_PENDING_KEY, true);
    setTutorialOpen(false);
  }

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
    const runtimeConfig = buildRuntimeConfig(undefined, {
      enableImageGeneration: imageGenerationEnabled,
      maxImagesPerStory: imageGenerationEnabled ? 12 : 0,
    }, language === "zh" ? "zh" : "en");
    const generationRequest = startFullGeneration({
      profile: nextProfile,
      runtimeConfig,
    }).then((job) => waitForFullGeneration(job));
    storyRequestRef.current = generationRequest;
    // The player may spend several minutes reading the letter. Attach a
    // rejection handler immediately so an early backend failure is retained
    // for acceptOffer without becoming an unhandled browser rejection.
    void generationRequest.catch(() => undefined);
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
      const [job] = await Promise.all([request, minSkipTime]);
      if (!job?.storyId || !job.hasFinalStory) throw new Error("Story generation did not return a playable result.");
      navigate(`/play-demo?storyId=${encodeURIComponent(job.storyId)}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  function handleChoice(choice: Choice, originRect: DOMRect) {
    if (story?.logic && choice.next_node === story.logic.warning_return_sentinel) {
      setCurrentNodeId(warningReturnNodeId ?? story.logic.start_node_id);
      setWarningReturnNodeId(null);
      return;
    }
    if (story?.logic && choice.next_node === story.logic.result_return_sentinel) {
      setCurrentNodeId(resultReturnNodeId ?? story.logic.start_node_id);
      setResultReturnNodeId(null);
      return;
    }

    spawnStatFlyers(choice.stat_delta, originRect);
    const nextStats = applyStatDelta(stats, choice.stat_delta);
    setStats(nextStats);
    const failedStat = story?.logic ? null : getFailedStat(nextStats);
    if (failedStat) {
      setGameOverReason(t("story.gameOver", { stat: t(`stats.${failedStat}`) }));
      return;
    }

    if (story?.logic) {
      const nextLogicVars = applyLogicDelta(logicVars, choice.logic_delta);
      setLogicVars(nextLogicVars);
      if (choice.logic_planned_next_node) {
        setResultReturnNodeId(choice.logic_planned_next_node);
      }

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

  function restart() {
    storyRequestRef.current = null;
    setStory(null);
    setProfile(null);
    setReusedStory(false);
    setLogicVars({});
    setLogicWarningsSeen({});
    setWarningReturnNodeId(null);
    setResultReturnNodeId(null);
    setStage("quiz");
  }

  const rawCurrentNode = story ? story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null : null;
  const currentNode = story && rawCurrentNode ? applyLogicContentVariant(story, currentNodeId, rawCurrentNode, logicVars) : null;
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
          <button className="apiKeyEditTrigger" onClick={() => setShowKeyEditor(true)} data-tutorial="travel-key">
            <img className="apiKeyEditTriggerIcon" src="/stickers/lock.svg" alt="" /> {t("top.travelKey")}
          </button>
          <button
            className={`imageGenerationToggle${imageGenerationEnabled ? " active" : ""}`}
            type="button"
            aria-pressed={imageGenerationEnabled}
            onClick={toggleImageGeneration}
            disabled={stage === "timeskip"}
            data-tutorial="image-toggle"
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

      {!hasAppBar && (stage === "passport" || stage === "quiz") && (
        <section className="cachedStoryLibrary" data-tutorial="cached-library" aria-label={t("cacheDemo.title")}>
          <div className="cachedStoryLibraryHead">
            <img className="cachedDemoCalloutIcon" src="/stickers/book.png" alt="" />
            <span>
              <strong>{t("cacheDemo.title")}</strong>
              <small>{t("cacheDemo.subtitle")}</small>
            </span>
          </div>
          <div className="cachedStoryList">
            {cachedStories.map((item) => (
              <Link className="cachedStoryOption" to={`/play-demo?storyId=${encodeURIComponent(item.storyId)}`} key={item.storyId}>
                <span className="cachedStoryOptionFlag">{item.outputLanguage === "zh" ? "中文" : "EN"}</span>
                <span>
                  <strong>{item.school}</strong>
                  <small>{[item.program, item.city].filter(Boolean).join(" · ")}</small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
            {cachedStories.length === 0 && <small className="cachedStoryEmpty">正在整理故事书架…</small>}
          </div>
        </section>
      )}

      {stage === "passport" && <PassportCard onComplete={() => setStage("quiz")} />}

      {stage === "quiz" && <div data-tutorial="profile-flow"><QuizFlow onComplete={startStory} /></div>}

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
      {stage === "quiz" && (
        <>
          <button className="homeTutorialReopen" type="button" onClick={() => setTutorialOpen(true)}>
            <span aria-hidden="true">🦉</span> 新手指引
          </button>
          <GameTutorial open={tutorialOpen} onFinish={finishHomeTutorial} steps={HOME_TUTORIAL_STEPS} />
        </>
      )}
    </main>
  );
}
