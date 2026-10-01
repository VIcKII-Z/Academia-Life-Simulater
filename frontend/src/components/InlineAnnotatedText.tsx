import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n, type Language } from "../lib/i18n";
import { translateCopy } from "../lib/uiCopy";
import { localizeEntity } from "../lib/entities";
import { createPortal } from "react-dom";
import { fetchExchangeRate, type ExchangeRate } from "../lib/api";
import type { PageTermAnnotation, ReferenceProfiles, StorySource, UserProfile } from "../types";

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

type DecisionFact = {
  label: string;
  value: string;
  evidence_ids?: string[];
};

const importanceLabels: Record<Importance, string> = {
  critical: "核心",
  important: "重要",
  supplementary: "补充",
};

const categoryLabels: Record<NonNullable<PageTermAnnotation["category"]>, string> = {
  location: "地点",
  institution: "院校机构",
  discipline: "学科专业",
  professional_term: "专业名词",
  money: "金额",
};

const criticalPattern = /签证|居留许可|入境|合法身份|限制(?:金额)?账户|截止|注册期限|考试次数|退学|毕业资格|work\s*permit|visa|residence permit|deadline|eligibility/i;
const importantPattern = /学费|费用|押金|奖学金|住房|宿舍|实习|工作|课程|学分|语言|保险|tuition|fee|deposit|scholarship|housing|internship|work|course|credit|language|insurance/i;
const moneyPattern = /(?:€|US\$|CN¥|RMB¥|LKR\s*|Rs\.?\s*|\$|£|¥)\s*\d[\d.,]*|\d[\d.,]*\s*(?:欧元|美元|英镑|日元|人民币|斯里兰卡卢比|卢比)|\d[\d.,]*\s*(?:EUR|USD|GBP|JPY|CNY|RMB|LKR)\b/giu;
const moneyTextPattern = /(?:€|US\$|CN¥|RMB¥|LKR\s*|Rs\.?\s*|\$|£|¥)\s*\d[\d.,]*|\d[\d.,]*\s*(?:欧元|美元|英镑|日元|人民币|斯里兰卡卢比|卢比)|\d[\d.,]*\s*(?:EUR|USD|GBP|JPY|CNY|RMB|LKR)\b/iu;
const explicitLocationPattern = /德国|日本|中国|斯里兰卡|慕尼黑|东京|柏林|Germany|Japan|China|Sri Lanka|Munich|Tokyo|Berlin/i;
const explicitInstitutionPattern = /大学|学院|院系|学校|中心|外事局|使领馆|机构|University|School|Faculty|Department|Institute|Center|Centre|Office|Authority/i;
const explicitDisciplinePattern = /专业|学科|硕士|博士|学士|工程|技术|科学|Master|Bachelor|PhD|Engineering|Science|Technology|programme|program|degree/i;

type EntitySeed = {
  term: string;
  aliases?: string[];
  explanation: string;
  category: NonNullable<PageTermAnnotation["category"]>;
  evidence_ids: string[];
};

const entityAliases: Array<{
  pattern: RegExp;
  category: EntitySeed["category"];
  explanation: (term: string) => string;
}> = [
  { pattern: /慕尼黑工业大学（TUM）|慕尼黑工业大学|Technische Universität München|Technical University of Munich/giu, category: "institution", explanation: () => "查看这所大学的类型、所在地，以及带榜单名称和年份的最新可核实排名。" },
  { pattern: /计算、信息与技术学院|TUM School of Computation, Information and Technology|TUM School of CIT/giu, category: "institution", explanation: () => "查看该院系所属大学的可核实背景；具体培养与录取信息见专业资料卡。" },
  { pattern: /电子工程与信息技术硕士|电气工程与信息技术硕士|Electrical Engineering and Information Technology|Electrical and Computer Engineering/giu, category: "discipline", explanation: () => "查看该项目的学制学分、授课语言、录取条件、申请期限、费用与毕业要求。" },
  { pattern: /德国|Germany/giu, category: "location", explanation: () => "本故事的留学目的地国家，其签证、居留和工作规定构成决策背景。" },
  { pattern: /慕尼黑|Munich/giu, category: "location", explanation: () => "本故事的留学城市；当地生活成本、住房和行政办理条件会影响学生决策。" },
];

function sourceIdsFor(category: EntitySeed["category"], sources: StorySource[]): string[] {
  const exact = sources.filter((source) => {
    if (!source.evidence_id) return false;
    if (category === "location") return source.used_for?.some((use) => /housing|money|visa|community|life/i.test(use));
    return /program_official|department|catalog|handbook|official_registry/i.test(source.source_type);
  }).map((source) => source.evidence_id as string);
  return [...new Set(exact.length ? exact : sources.map((source) => source.evidence_id).filter((id): id is string => Boolean(id)))].slice(0, 3);
}

function profileEntitySeeds(text: string, profile: UserProfile | undefined, sources: StorySource[]): EntitySeed[] {
  const seeds: EntitySeed[] = [];
  const push = (term: string | undefined, explanation: string, category: EntitySeed["category"]) => {
    const value = term?.trim();
    if (!value || value.length < 2 || !text.toLocaleLowerCase().includes(value.toLocaleLowerCase())) return;
    seeds.push({ term: value, explanation, category, evidence_ids: sourceIdsFor(category, sources) });
  };

  if (profile) {
    push(profile.country, "本故事的留学目的地国家，其签证、居留和工作规定构成决策背景。", "location");
    push(profile.city, "本故事的留学城市；当地生活成本、住房和行政办理条件会影响学生决策。", "location");
    push(profile.school, "查看这所大学的类型、所在地，以及带榜单名称和年份的最新可核实排名。", "institution");
    push(profile.department, "查看该院系所属大学的可核实背景；具体培养与录取信息见专业资料卡。", "institution");
    push(profile.program, "查看该项目的学制学分、授课语言、录取条件、申请期限、费用与毕业要求。", "discipline");
    push(profile.major, "查看该项目的学制学分、授课语言、录取条件、申请期限、费用与毕业要求。", "discipline");
  }

  for (const alias of entityAliases) {
    for (const match of text.matchAll(alias.pattern)) {
      seeds.push({
        term: match[0],
        explanation: alias.explanation(match[0]),
        category: alias.category,
        evidence_ids: sourceIdsFor(alias.category, sources),
      });
    }
  }

  return seeds.filter((seed, index, all) => all.findIndex((candidate) => candidate.term === seed.term) === index);
}

function inferImportance(term: PageTermAnnotation): Importance {
  if (term.importance) return term.importance;
  const text = `${term.term} ${term.explanation}`;
  if (criticalPattern.test(text)) return "critical";
  if (importantPattern.test(text) || term.monetary_amount) return "important";
  return "supplementary";
}

function inferCategory(term: PageTermAnnotation): NonNullable<PageTermAnnotation["category"]> {
  if (term.category) return term.category;
  if (term.monetary_amount || moneyTextPattern.test(term.term)) return "money";
  if (explicitLocationPattern.test(term.term)) return "location";
  if (explicitInstitutionPattern.test(term.term)) return "institution";
  if (explicitDisciplinePattern.test(term.term)) return "discipline";
  return "professional_term";
}

function currencyFromText(value: string): string | null {
  if (/欧元|EUR|€/i.test(value)) return "EUR";
  if (/美元|USD|US\$/i.test(value)) return "USD";
  if (/英镑|GBP|£/i.test(value)) return "GBP";
  if (/日元|JPY/i.test(value)) return "JPY";
  if (/斯里兰卡卢比|卢比|LKR|Rs\.?/i.test(value)) return "LKR";
  if (/人民币|CNY|RMB|CN¥/i.test(value)) return "CNY";
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

function annotationRanges(
  text: string,
  terms: PageTermAnnotation[],
  evidenceIds: string[],
  profile: UserProfile | undefined,
  sources: StorySource[],
  glossaryTerms: PageTermAnnotation[],
  language: Language,
): InlineAnnotation[] {
  const candidates: InlineAnnotation[] = [];

  const expandedTerms: PageTermAnnotation[] = [
    ...terms,
    ...glossaryTerms,
    ...profileEntitySeeds(text, profile, sources).map((entity) => ({
      ...entity,
      importance: entity.category === "location" ? "supplementary" as const : "important" as const,
      importance_reason: entity.category === "location"
        ? "地点决定适用的生活条件、行政流程和政策环境。"
        : entity.category === "institution"
          ? "院校和院系决定项目规则及可使用的校内资源。"
          : "专业和学位项目决定课程结构、培养要求及后续职业方向。",
    })),
  ].flatMap((term) => [
    term,
    ...(term.aliases ?? []).map((alias: string) => ({ ...term, term: alias, aliases: undefined })),
  ]);

  for (const rawTerm of expandedTerms) {
    const term = { ...rawTerm, category: inferCategory(rawTerm) };
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
      category: "money",
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
  return accepted.sort((a, b) => a.start - b.start).map((term) => ({ ...term,
    explanation: translateCopy(term.explanation, language),
    importance_reason: term.importance_reason ? translateCopy(term.importance_reason, language) : undefined,
  }));
}

function formatConverted(amount: number, currency: "CNY" | "LKR", language: Language): string {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function joined(values: string[] | undefined): string | null {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return normalized.length ? normalized.join("；") : null;
}

function decisionFacts(
  annotation: InlineAnnotation,
  profiles: ReferenceProfiles | undefined,
  language: Language,
): { title: string; facts: DecisionFact[] } | null {
  const copy = (text: string) => translateCopy(text, language);
  const entity = (text: string | undefined) => localizeEntity(text ?? "", language);
  if (annotation.category === "institution") {
    const institution = profiles?.institution;
    const facts: DecisionFact[] = [];
    for (const ranking of institution?.rankings ?? []) {
      const subject = ranking.subject ? ` · ${ranking.subject}` : "";
      const note = ranking.note ? `（${ranking.note}）` : "";
      facts.push({
        label: `${ranking.system} · ${ranking.edition}${subject}`,
        value: `${ranking.rank}${note}`,
        evidence_ids: ranking.evidence_ids,
      });
    }
    if (!(institution?.rankings?.length)) {
      facts.push({ label: copy("大学排名"), value: copy("当前资料未确认带榜单名称和年份的可靠排名。") });
    }
    if (institution?.institution_type) facts.push({ label: copy("学校类型"), value: institution.institution_type });
    if (institution?.location) facts.push({ label: copy("所在地"), value: institution.location.split(/[,，]/).map((part) => entity(part.trim())).join(language === "zh" ? "，" : ", ") });
    return { title: copy("院校决策资料"), facts };
  }

  if (annotation.category === "discipline") {
    const program = profiles?.program;
    const facts: DecisionFact[] = [];
    const degree = [program?.degree_type, program?.official_name].filter(Boolean).map(entity).join(" · ");
    const length = [program?.duration, program?.credits].filter(Boolean).join(" · ");
    if (degree) facts.push({ label: copy("项目与学位"), value: degree });
    const prerequisites = joined(program?.prerequisites);
    const admissions = joined(program?.admissions);
    const deadlines = joined(program?.deadlines);
    const funding = joined(program?.funding);
    const milestones = joined(program?.milestones);
    if (prerequisites) facts.push({ label: copy("申请基础"), value: prerequisites });
    if (admissions) facts.push({ label: copy("录取与材料"), value: admissions });
    else facts.push({ label: copy("录取与材料"), value: copy("当前资料未确认完整录取条件，请核对项目官方页面。") });
    if (deadlines) facts.push({ label: copy("申请期限"), value: deadlines });
    if (program?.department) facts.push({ label: copy("所属院系"), value: entity(program.department) });
    if (length) facts.push({ label: copy("学制与学分"), value: length });
    if (program?.delivery_mode) facts.push({ label: copy("授课语言/形式"), value: program.delivery_mode });
    if (funding) facts.push({ label: copy("学费与资金"), value: funding });
    if (milestones) facts.push({ label: copy("培养与毕业"), value: milestones });
    return { title: copy("专业决策资料"), facts };
  }

  return null;
}

function CurrencyConversion({ amount, currency }: { amount: number; currency: string }) {
  const { copy, language } = useI18n();
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRates([]);
    setFailed(false);
    Promise.all([language === "zh" ? "CNY" : "LKR"].map((quote) => fetchExchangeRate(currency, quote)))
      .then((result) => {
        if (!cancelled) setRates(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [amount, currency, language]);

  if (failed) return <p className="termPopoverRateState">{copy("暂时无法取得参考汇率，请以付款当日汇率为准。")}</p>;
  if (!rates.length) return <p className="termPopoverRateState">{language === "zh" ? "正在换算人民币…" : "Converting to Sri Lankan rupees…"}</p>;

  return (
    <div className="termPopoverRates">
      <span>{copy("参考换算")}</span>
      {rates.map((rate) => (
        <strong key={rate.quote}>{copy("约")} {formatConverted(amount * rate.rate, rate.quote as "CNY" | "LKR", language)}</strong>
      ))}
      <small>{copy("汇率日期")} {rates[0].date} · {copy("仅供参考")}</small>
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
  profile?: UserProfile;
  glossaryTerms?: PageTermAnnotation[];
  referenceProfiles?: ReferenceProfiles;
}

export default function InlineAnnotatedText({
  text,
  terms = [],
  evidenceIds = [],
  sources = [],
  profile,
  glossaryTerms = [],
  referenceProfiles,
}: InlineAnnotatedTextProps) {
  const { copy, language } = useI18n();
  const displayText = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  const annotations = useMemo(
    () => annotationRanges(displayText, terms, evidenceIds, profile, sources, glossaryTerms, language),
    [evidenceIds, glossaryTerms, profile, sources, terms, displayText, language],
  );
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
    if (annotation.start > cursor) content.push(displayText.slice(cursor, annotation.start));
    content.push(
      <span
        className={`inlineTerm inlineTerm--${annotation.importance}`}
        key={`${annotation.start}-${annotation.end}`}
        tabIndex={0}
        role="button"
        aria-label={`${annotation.term} · ${annotation.category ? copy(categoryLabels[annotation.category]) : copy("术语")} · ${copy(importanceLabels[annotation.importance])} · ${copy("查看注释")}`}
        onMouseEnter={(event) => open(annotation, event.currentTarget)}
        onMouseLeave={scheduleClose}
        onFocus={(event) => open(annotation, event.currentTarget)}
        onBlur={scheduleClose}
        onClick={(event) => open(annotation, event.currentTarget)}
      >
        {displayText.slice(annotation.start, annotation.end)}
      </span>,
    );
    cursor = annotation.end;
  }
  if (cursor < displayText.length) content.push(displayText.slice(cursor));

  const sourceMap = new Map(sources.map((source) => [source.evidence_id, source]));
  const activeDecisionCard = popover ? decisionFacts(popover.annotation, referenceProfiles, language) : null;
  const activeEvidenceIds = popover
    ? [...new Set([
      ...popover.annotation.evidence_ids,
      ...(activeDecisionCard?.facts.flatMap((fact) => fact.evidence_ids ?? []) ?? []),
    ])]
    : [];
  const activeSources = activeEvidenceIds.map((id) => ({ id, source: sourceMap.get(id) }));

  return (
    <>
      <p>{content}</p>
      {annotations.length > 0 && (
        <div className="inlineTermLegend" aria-label={copy("正文标注重要性说明")}>
          <span><i className="inlineTermLegendDot inlineTermLegendDot--critical" />{copy("核心")}</span>
          <span><i className="inlineTermLegendDot inlineTermLegendDot--important" />{copy("重要")}</span>
          <span><i className="inlineTermLegendDot inlineTermLegendDot--supplementary" />{copy("补充")}</span>
          <small>{copy("悬停或点击红色文字查看注释")}</small>
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
            <span>{popover.annotation.category ? copy(categoryLabels[popover.annotation.category]) : copy("术语")} · {copy(importanceLabels[popover.annotation.importance])}</span>
            <strong>{popover.annotation.term}</strong>
          </div>
          <p>{popover.annotation.explanation}</p>
          {popover.annotation.importance_reason && <small className="termPopoverReason">{copy("为什么重要：")}{popover.annotation.importance_reason}</small>}
          {activeDecisionCard && (
            <section className="termPopoverDecisionCard">
              <span>{activeDecisionCard.title}</span>
              <dl>
                {activeDecisionCard.facts.map((fact, index) => (
                  <div key={`${fact.label}-${index}`}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {popover.annotation.monetary_amount && (
            <CurrencyConversion
              amount={popover.annotation.monetary_amount.amount}
              currency={popover.annotation.monetary_amount.currency}
            />
          )}
          {activeSources.length > 0 && (
            <div className="termPopoverSources">
              <span>{copy("资料来源")}</span>
              {activeSources.map(({ id, source }) => source?.url ? (
                <a href={source.url} target="_blank" rel="noreferrer" key={id}>{copy("资料来源")} {activeSources.findIndex((item) => item.id === id) + 1}</a>
              ) : <small key={id}>{id}</small>)}
            </div>
          )}
        </aside>,
        document.body,
      )}
    </>
  );
}
