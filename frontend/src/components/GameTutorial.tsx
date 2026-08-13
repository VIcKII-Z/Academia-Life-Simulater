import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type TutorialStep = {
  selector?: string;
  kicker: string;
  title: string;
  body: string;
};

export const STORY_TUTORIAL_STEPS: TutorialStep[] = [
  {
    kicker: "欢迎上船",
    title: "这是一趟可以重来的留学预演",
    body: "嗨，我是你的临时向导小鸮。接下来我会用一分钟带你认认路：先读情境，再做选择，看看这条留学时间线会把你送到哪里。",
  },
  {
    selector: '[data-tutorial="story"]',
    kicker: "第一站 · 读情境",
    title: "先看看此刻发生了什么",
    body: "每一页正文都是一个真实流程中的关键节点。它会告诉你眼前的处境、期限与必须权衡的问题，不用急着做“标准答案”。",
  },
  {
    selector: ".inlineTerm",
    kicker: "顺手查资料",
    title: "红色词语都可以悬停查看",
    body: "大学、学科、制度名词、金额和重要地点会按重要性标红。把鼠标移上去，或用键盘聚焦，就能看到解释、换算和资料来源。",
  },
  {
    selector: '[data-tutorial="choices"]',
    kicker: "轮到你了",
    title: "选择会推动时间线",
    body: "选项不只换一段文字，也可能改变后续路线。遇到警告或失败别慌——游戏会用一个小小的时空事故，把你送回上一步重新考虑。",
  },
  {
    selector: '[data-tutorial="visual"]',
    kicker: "旅途剪影",
    title: "插图记录这一幕",
    body: "图片会呼应当前学校、城市或生活场景。同一段旅程可能复用镜头，让人物形象保持一致，也避免为了热闹而生成一大堆无关图片。",
  },
  {
    selector: '[data-tutorial="restart"]',
    kicker: "想换一种活法？",
    title: "“重新开始”会清空本轮选择",
    body: "点它会回到故事起点，变量和路线也会一起复原。适合通关以后尝试另一种决定，看看是否会遇见不同结局。",
  },
  {
    selector: '[data-tutorial="home"]',
    kicker: "回到港口",
    title: "“回首页”带你离开当前故事",
    body: "你可以回首页生成或打开另一所学校的留学预演。当前故事不会因为这份指引被改动。",
  },
  {
    kicker: "准备完成",
    title: "没有唯一正确的留学人生",
    body: "把它当成一次低成本的沙盘推演：留意事实、比较代价，也观察自己在意什么。现在，去做第一个选择吧。",
  },
];

type GameTutorialProps = {
  open: boolean;
  onFinish: () => void;
  steps?: TutorialStep[];
};

type TargetBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const VIEWPORT_GAP = 16;

export default function GameTutorial({ open, onFinish, steps = STORY_TUTORIAL_STEPS }: GameTutorialProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [cardStyle, setCardStyle] = useState<CSSProperties>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const step = steps[stepIndex] ?? steps[0];
  const isLast = stepIndex === steps.length - 1;

  const target = useMemo(() => {
    if (!open || !step.selector) return null;
    return document.querySelector<HTMLElement>(step.selector);
  }, [open, step.selector, stepIndex]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStepIndex(0);
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onFinish();
      if (event.key === "ArrowRight") setStepIndex((current) => Math.min(steps.length - 1, current + 1));
      if (event.key === "ArrowLeft") setStepIndex((current) => Math.max(0, current - 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onFinish, stepIndex, steps.length]);

  useLayoutEffect(() => {
    if (!open) return;

    function positionTutorial() {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const cardWidth = Math.min(400, viewportWidth - VIEWPORT_GAP * 2);
      const cardHeight = cardRef.current?.offsetHeight ?? 290;

      if (!target) {
        setTargetBox(null);
        setCardStyle({
          width: cardWidth,
          left: Math.max(VIEWPORT_GAP, (viewportWidth - cardWidth) / 2),
          top: Math.max(VIEWPORT_GAP, (viewportHeight - cardHeight) / 2),
        });
        return;
      }

      const rect = target.getBoundingClientRect();
      const padding = 8;
      const box = {
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: Math.min(viewportWidth - 16, rect.width + padding * 2),
        height: Math.min(viewportHeight - 16, rect.height + padding * 2),
      };
      setTargetBox(box);

      const centeredLeft = rect.left + rect.width / 2 - cardWidth / 2;
      const left = Math.min(viewportWidth - cardWidth - VIEWPORT_GAP, Math.max(VIEWPORT_GAP, centeredLeft));
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      let top: number;
      if (spaceBelow >= cardHeight + VIEWPORT_GAP * 2) {
        top = rect.bottom + VIEWPORT_GAP;
      } else if (spaceAbove >= cardHeight + VIEWPORT_GAP * 2) {
        top = rect.top - cardHeight - VIEWPORT_GAP;
      } else {
        top = viewportHeight - cardHeight - VIEWPORT_GAP;
      }
      setCardStyle({ width: cardWidth, left, top: Math.max(VIEWPORT_GAP, top) });
    }

    target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    const frame = window.requestAnimationFrame(positionTutorial);
    window.addEventListener("resize", positionTutorial);
    window.addEventListener("scroll", positionTutorial, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionTutorial);
      window.removeEventListener("scroll", positionTutorial, true);
    };
  }, [open, stepIndex, target]);

  if (!open) return null;

  return createPortal(
    <div className="gameTutorial" data-testid="game-tutorial">
      {targetBox && (
        <div
          className="gameTutorialSpotlight"
          style={{
            top: targetBox.top,
            left: targetBox.left,
            width: targetBox.width,
            height: targetBox.height,
          }}
          aria-hidden="true"
        />
      )}
      {!targetBox && <div className="gameTutorialBackdrop" aria-hidden="true" />}

      <div
        className="gameTutorialCard"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-tutorial-title"
        aria-describedby="game-tutorial-description"
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="gameTutorialTopline">
          <span className="gameTutorialMascot" aria-hidden="true">🦉</span>
          <span>{step.kicker}</span>
          <span>{stepIndex + 1} / {steps.length}</span>
        </div>
        <h2 id="game-tutorial-title">{step.title}</h2>
        <p id="game-tutorial-description">{step.body}</p>

        <div className="gameTutorialProgress" aria-label={`指引进度：第 ${stepIndex + 1} 步，共 ${steps.length} 步`}>
          {steps.map((item, index) => (
            <span className={index === stepIndex ? "is-active" : ""} key={item.title} />
          ))}
        </div>

        <div className="gameTutorialActions">
          <button className="gameTutorialSkip" type="button" onClick={onFinish}>跳过指引</button>
          <div>
            {stepIndex > 0 && (
              <button type="button" onClick={() => setStepIndex((current) => current - 1)}>上一步</button>
            )}
            <button
              className="gameTutorialNext"
              type="button"
              onClick={() => isLast ? onFinish() : setStepIndex((current) => current + 1)}
              data-testid="game-tutorial-next"
            >
              {isLast ? "开始探索" : "下一步"}
            </button>
          </div>
        </div>
        <small>也可以用 ← → 翻页，按 Esc 关闭</small>
      </div>
    </div>,
    document.body,
  );
}
