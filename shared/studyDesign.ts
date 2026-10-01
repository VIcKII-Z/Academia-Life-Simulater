export type StudyLanguage = "zh" | "en";
export type StudyProfile = { country: string; city?: string; school?: string; grade: string };
export type StudyDuration = {
  months: number;
  semesters: number;
  basis: "typical" | "program" | "provisional";
  evidenceIds: string[];
};
export type DurationEvidence = {
  months: number;
  study_load: "full_time";
  evidence_ids: string[];
};

/** Half-year planning blocks, not a claim about a university's term calendar. */
export function inferStudyDuration(profile: StudyProfile): StudyDuration {
  const undergraduate = /undergraduate|bachelor|本科/i.test(profile.grade);
  const country = profile.country.trim().toLowerCase();
  const uk = /^(united kingdom|uk|u\.k\.|great britain|england|scotland|wales|northern ireland|英国|苏格兰)$/.test(country);
  const germany = /^(germany|deutschland|德国)$/.test(country);
  const us = /^(united states( of america)?|usa|us|u\.s\.?a?\.?|美国)$/.test(country);
  const scotland = /scotland|edinburgh|glasgow|aberdeen|dundee|st\.? andrews|stirling|爱丁堡|格拉斯哥|苏格兰/i.test(`${profile.country} ${profile.city ?? ""} ${profile.school ?? ""}`);
  const months = uk ? (undergraduate ? (scotland ? 48 : 36) : 12)
    : germany ? (undergraduate ? 36 : 24) : undergraduate ? 48 : 24;
  return { months, semesters: Math.ceil(months / 6), basis: uk || germany || us ? "typical" : "provisional", evidenceIds: [] };
}

export function resolveStudyDuration(profile: StudyProfile, evidence?: DurationEvidence, sources: Array<{ evidence_id?: string; source_type: string; confidence: string; url: string }> = []): StudyDuration {
  const ids = evidence?.evidence_ids;
  const supported = Array.isArray(ids) && ids.length > 0 && ids.every((id) => sources.some((source) =>
    source.evidence_id === id && source.confidence === "high" &&
    ["program_official", "department", "catalog", "handbook"].includes(source.source_type) && /^https?:\/\//.test(source.url)));
  if (evidence?.study_load === "full_time" && Number.isInteger(evidence.months) && evidence.months >= 6 && evidence.months <= 72 && supported) {
    return { months: evidence.months, semesters: Math.ceil(evidence.months / 6), basis: "program", evidenceIds: [...ids!] };
  }
  return inferStudyDuration(profile);
}

export function durationLabel(duration: StudyDuration, language: StudyLanguage): string {
  const years = duration.months / 12;
  return language === "zh"
    ? `${years} 年（${duration.semesters} 个学期等长阶段）${duration.basis === "program" ? " · 项目资料学制" : " · 待具体项目核实"}`
    : `${years} years (${duration.semesters} semester-length stages)${duration.basis === "program" ? " · program duration" : " · pending program verification"}`;
}

export function cohortForLanguage(language: StudyLanguage) {
  return language === "zh"
    ? { id: "china_zh" as const, homeCountry: "China", language, gender: "woman" as const, homeCurrency: "CNY" }
    : { id: "sri_lanka_en" as const, homeCountry: "Sri Lanka", language, gender: "woman" as const, homeCurrency: "LKR" };
}

export function cohortNarrativeRules(language: StudyLanguage, grade: string): string {
  const cohort = cohortForLanguage(language);
  return `The protagonist is a woman from ${cohort.homeCountry}, studying STEM abroad, narrated in ${language === "zh" ? "Simplified Chinese" : "English"}. The destination country is NOT her home country. Keep this identity consistent in text, images, family contacts, home-country documents, currency context and return-home endings.
Her life stage fits ${grade}; do not fix every protagonist's age at 24. Establish a specific STEM interest, an existing skill, a personal goal and a trusted relationship early, then recall them later. Give her agency and ordinary moments of competence, belonging and enjoyment.
Do not infer poverty, religion, ethnicity, accent, family opposition or low ability from nationality or gender. Family relationships can be supportive and complex. Structural barriers are not personal inadequacy. Include realistic peer solidarity, female STEM role models, mentoring and asking for help; name actual services only with evidence. Never promise admission, funding, visas or jobs. Both cohorts receive equally rich learning opportunities and respectful, credible support.`;
}

export const LEARNING_POLICY = "supported_exploration_v1" as const;
/** Conservative initial design gate; this is random-route QA, not a human success prediction. */
export const MAX_SEVERE_ROUTE_PROBABILITY = 0.2;
export type LearningStory = { learning_policy?: typeof LEARNING_POLICY };
export function isLearningStory(story: LearningStory): boolean {
  return story.learning_policy === LEARNING_POLICY;
}

/** Shared by risk previews, player transitions and generator simulations. */
export function shouldWarn(previous: number, next: number, seen: boolean, learning = false): boolean {
  if (seen) return false;
  return learning ? next <= 45 : next > 15 && next <= 45 && previous > 45;
}

export const LEARNING_GENERATION_RULES = `This is supported educational exploration, not a survival test. Numerical resources are advisory: low values trigger information and support, NEVER automatic expulsion, visa loss, illness or failure.
Keep exactly three option kinds for schema compatibility: normal = practical planning, positive_extreme = proactive support/exploration, negative_extreme = a plausible alternative with uncertainty. These internal names must not make a choice reckless, illegal or absurd. Present three credible choices with different information, effort, support or timing tradeoffs, not one correct answer and two traps.
Every decision must offer at least two routes that can continue learning. Prefer asking for clarification, timely extensions where evidenced, advising, peer support and replanning. A difficult outcome should teach what to do next. Do not force employment, self-sacrifice or implausible behavior to maintain resources.
Reserve explicit failure routes for rare, concrete, sourced and clearly signposted irreversible events; never infer them solely from low scores. No more than 10% of choices may directly lead to them, and uniformly random choices across the whole journey must encounter a severe consequence with probability at most 20%. Prefer nonterminal setbacks on the main path; place severe cases in clearly signposted optional branches. Return-home, deferral and changing goals can be constructive outcomes, not inferior moral judgments. Preserve real policy consequences, but include review and retry as a simulation feature.
Keep all N_study_stage_* nodes and their chronological order. The normal supported route must visit every study stage before graduation; do not omit years of the degree.
Use warning pages to explain the concern, one realistic next action and the relevant source/support contact. Use attainable successes throughout: understanding a requirement, asking a question, finishing a STEM task, finding community. Frame growth as access to information and support rather than a personality score.`;
