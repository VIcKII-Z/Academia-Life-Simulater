import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fetchExchangeRate, type ExchangeRate } from "../lib/api";
import type { PageTermAnnotation, StorySource } from "../types";

type Importance = NonNullable<PageTermAnnotation["importance"]>;

type InlineAnnotation = PageTermAnnotation & {
  importance: Importance;
  start: number;
  end: number;
};

type PopoverState = {
  annotation: InlineAnnotation;
  rect: DOMRect;
};

const importanceLabels: Record<Importance, string> = {
  critical: "核心",
  important: "重要",
  supplementary: "补充",
};

const criticalPattern = /签证|居留许可|入境|合法身份|限制(?:金额)?账户|截止|注册期限|考试次数|退学|毕业资格|work\s*permit|visa|residence permit|deadline|eligibility/i;
const importantPattern = /学费|费用|押金|奖学金|住房|宿舍|实习|工作|课程|学分|语言|保险|tuition|fee|deposit|scholarship|housing|internship|work|course|credit|language|insurance/i;
const moneyPattern = /(?:€|US\$|CN¥|RMB¥|LKR\s*|Rs\.?\s*|\$|£|¥)\s*\d[\d.,]*|\d[\d.,]*\s*(?:欧元|美元|英镑|日元|人民币|斯里兰卡卢比|卢比)|\d[\d.,]*\s*(?:EUR|USD|GBP|JPY|CNY|RMB|LKR)\b/giu;

function inferImportance(term: PageTermAnnotation): Importance {
  if (term.importance) return term.importance;
  const text = `${term.term} ${term.explanation}`;
  if (criticalPattern.test(text)) return "critical";
  if (importantPattern.test(text) || term.monetary_amount) return "important";
  return "supplementary";
}

function currencyFromText(value: string): string | null {
  if (/欧元|EUR|€/i.test(value)) return "EUR";
  if (/美元|USD|US\$|\$/i.test(value)) return "USD";
  if (/英镑|GBP|£/i.test(value)) return "GBP";
  if (/日元|JPY/i.test(value)) return "JPY";
  if (/斯里兰卡卢比|卢比|LKR|Rs\.?/i.test(value)) return "LKR";
  if (/人民币|CNY|RMB|CN¥/i.test(value)) return "CNY";
  if (/¥/.test(value)) return "CNY";
  return null;
}

function amountFromText(value: string): number | null {
  const match = value.match(/\d[\d.,]*/u)?.[0];
  if (!match) return null;
  let normalized = match;
  if (match.includes(",") && match.includes(".")) {
    normalized = match.lastIndexOf(",") > match.lastIndexOf(".")
      ? match.replace(/\./g, "").replace(",", ".")
      : match.replace(/,/g, "");
  } else if (match.includes(",")) {
    const decimals = match.length - match.lastIndexOf(",") - 1;
    normalized = decimals > 0 && decimals <= 2 ? match.replace(",", ".") : match.replace(/,/g, "");
  } else if (match.includes(".")) {
    const decimals = match.length - match.lastIndexOf(".") - 1;
    normalized = decimals === 3 ? match.replace(/\./g, "") : match;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function findAll(text: string, needle: string): number[] {
  if (!needle) return [];
  const result: number[] = [];
  const haystack = text.toLocaleLowerCase();
  const search = needle.toLocaleLowerCase();
  let cursor = 0;
  while (cursor <= haystack.length - search.length) {
    const index = haystack.indexOf(search, cursor);
    if (index < 0) break;
    result.push(index);
    cursor = index + Math.max(1, search.length);
  }
  return result;
}

function annotationRanges(text: string, terms: PageTermAnnotation[], evidenceIds: string[]): InlineAnnotation[] {
  const candidates: InlineAnnotation[] = [];

  for (const term of terms) {
    for (const start of findAll(text, term.term.trim())) {
      candidates.push({ ...term, importance: inferImportance(term), start, end: start + term.term.trim().length });
    }
  }

  for (const match of text.matchAll(moneyPattern)) {
    if (match.index === undefined) continue;
    const amount = amountFromText(match[0]);
    const currency = currencyFromText(match[0]);
    if (amount === null || !currency) continue;
    candidates.push({
      term: match[0],
      explanation: "正文中的原币金额。下方换算使用最近可用的参考汇率，仅用于帮助比较成本。",
      importance: criticalPattern.test(text.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24))
        ? "critical"
        : "important",
      importance_reason: "金额会直接影响资金准备和方案比较。",
      monetary_amount: { amount, currency },
      evidence_ids: evidenceIds,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const importanceRank: Record<Importance, number> = { critical: 3, important: 2, supplementary: 1 };
  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || importanceRank[b.importance] - importanceRank[a.importance]);
  const accepted: InlineAnnotation[] = [];
  for (const candidate of candidates) {
    if (accepted.some((current) => candidate.start < current.end && candidate.end > current.start)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function formatConverted(amount: number, currency: "CNY" | "LKR"): string {
  return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function CurrencyConversion({ amount, currency }: { amount: number; currency: string }) {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRates([]);
    setFailed(false);
    Promise.all(["CNY", "LKR"].map((quote) => fetchExchangeRate(currency, quote)))
      .then((result) => {
        if (!cancelled) setRates(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [amount, currency]);

  if (failed) return <p className="termPopoverRateState">暂时无法取得参考汇率，请以付款当日汇率为准。</p>;
  if (!rates.length) return <p className="termPopoverRateState">正在换算人民币和斯里兰卡卢比…</p>;

  return (
    <div className="termPopoverRates">
      <span>参考换算</span>
      {rates.map((rate) => (
        <strong key={rate.quote}>约 {formatConverted(amount * rate.rate, rate.quote as "CNY" | "LKR")}</strong>
      ))}
      <small>汇率日期 {rates[0].date} · 仅供参考</small>
    </div>
  );
}

function popoverPosition(rect: DOMRect): CSSProperties {
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const estimatedHeight = 270;
  const showAbove = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;
  return {
    width,
    left,
    top: showAbove ? Math.max(12, rect.top - 10) : Math.min(window.innerHeight - 12, rect.bottom + 10),
    transform: showAbove ? "translateY(-100%)" : undefined,
  };
}

export interface InlineAnnotatedTextProps {
  text: string;
  terms?: PageTermAnnotation[];
  evidenceIds?: string[];
  sources?: StorySource[];
}

export default function InlineAnnotatedText({ text, terms = [], evidenceIds = [], sources = [] }: InlineAnnotatedTextProps) {
  const annotations = useMemo(() => annotationRanges(text, terms, evidenceIds), [evidenceIds, terms, text]);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const closeTimer = useRef<number | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPopover(null), 120);
  }

  function open(annotation: InlineAnnotation, target: HTMLElement) {
    cancelClose();
    setPopover({ annotation, rect: target.getBoundingClientRect() });
  }

  useEffect(() => {
    const dismiss = () => setPopover(null);
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".inlineTerm, .termPopover")) dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      cancelClose();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  const content: ReactNode[] = [];
  let cursor = 0;
  for (const annotation of annotations) {
    if (annotation.start > cursor) content.push(text.slice(cursor, annotation.start));
    content.push(
      <span
        className={`inlineTerm inlineTerm--${annotation.importance}`}
        key={`${annotation.start}-${annotation.end}`}
        tabIndex={0}
        role="button"
        aria-label={`${annotation.term}，${importanceLabels[annotation.importance]}术语。查看注释`}
        onMouseEnter={(event) => open(annotation, event.currentTarget)}
        onMouseLeave={scheduleClose}
        onFocus={(event) => open(annotation, event.currentTarget)}
        onBlur={scheduleClose}
        onClick={(event) => open(annotation, event.currentTarget)}
      >
        {text.slice(annotation.start, annotation.end)}
      </span>,
    );
    cursor = annotation.end;
  }
  if (cursor < text.length) content.push(text.slice(cursor));

  const sourceMap = new Map(sources.map((source) => [source.evidence_id, source]));
  const activeSources = popover?.annotation.evidence_ids.map((id) => ({ id, source: sourceMap.get(id) })) ?? [];

  return (
    <>
      <p>{content}</p>
      {annotations.length > 0 && (
        <div className="inlineTermLegend" aria-label="正文标注重要性说明">
          <span><i className="inlineTermLegendDot inlineTermLegendDot--critical" />核心</span>
          <span><i className="inlineTermLegendDot inlineTermLegendDot--important" />重要</span>
          <span><i className="inlineTermLegendDot inlineTermLegendDot--supplementary" />补充</span>
          <small>悬停或点击红色文字查看注释</small>
        </div>
      )}
      {popover && createPortal(
        <aside
          className={`termPopover termPopover--${popover.annotation.importance}`}
          style={popoverPosition(popover.rect)}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onFocus={cancelClose}
          onBlur={scheduleClose}
        >
          <div className="termPopoverHead">
            <span>{importanceLabels[popover.annotation.importance]}术语</span>
            <strong>{popover.annotation.term}</strong>
          </div>
          <p>{popover.annotation.explanation}</p>
          {popover.annotation.importance_reason && <small className="termPopoverReason">为什么重要：{popover.annotation.importance_reason}</small>}
          {popover.annotation.monetary_amount && (
            <CurrencyConversion
              amount={popover.annotation.monetary_amount.amount}
              currency={popover.annotation.monetary_amount.currency}
            />
          )}
          {activeSources.length > 0 && (
            <div className="termPopoverSources">
              <span>资料来源</span>
              {activeSources.map(({ id, source }) => source?.url ? (
                <a href={source.url} target="_blank" rel="noreferrer" key={id}>{id} · {source.title}</a>
              ) : <small key={id}>{id}</small>)}
            </div>
          )}
        </aside>,
        document.body,
      )}
    </>
  );
}
