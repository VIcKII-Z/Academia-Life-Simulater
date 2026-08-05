import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileLogicGraphToStoryDocument } from "../src/agents/logicGraphCompiler.js";
import { validateLogicGraph } from "../src/agents/logicGraphAgent.js";
import { runArtistAgent } from "../src/agents/artistAgent.js";
import type {
  LogicEnding,
  LogicGraphDocument,
  LogicNode,
  LogicOption,
  LogicOptionKind,
  LogicPage,
  LogicVariantTrigger,
  LogicVariableBand,
  LogicVariableDefinition,
  Provider,
  ResearchReport,
  RuntimeConfig,
  StoryDocument,
} from "../src/types.js";

type JsonObject = Record<string, unknown>;

type ResearchAdaptation = {
  node_adjustments?: Array<{
    node_id: string;
    title?: string;
    stage?: LogicNode["stage"];
    is_special?: boolean;
    why_special?: string;
    variant_triggers?: LogicVariantTrigger[];
    facts_used?: string[];
  }>;
  new_nodes?: Array<{
    id: string;
    title: string;
    insert_after: string;
    stage: LogicNode["stage"];
    is_special?: boolean;
    why_special?: string;
    variables_read?: string[];
    variables_written?: string[];
    variant_triggers?: LogicVariantTrigger[];
    facts_used?: string[];
  }>;
  accepted_supplemental_variables?: LogicVariableDefinition[];
  special_nodes?: Array<{ node_id: string; reason: string; ending_impact: string }>;
  research_adjustments?: LogicGraphDocument["research_adjustments"];
  supervisor_notes?: string[];
};

type NodePlanResponse = {
  node: LogicNode;
  pages: Record<string, LogicPage>;
  endings?: Record<string, LogicEnding>;
  new_branch_nodes?: Array<{
    node: LogicNode;
    pages: Record<string, LogicPage>;
    endings?: Record<string, LogicEnding>;
  }>;
  supervisor_notes?: string[];
};

type ContentPatch = {
  pages?: Record<
    string,
    {
      text?: string;
      insight?: string;
      choices?: string[];
    }
  >;
  endings?: Record<string, { text?: string; insight?: string }>;
  summary?: string;
};

type VariantPatch = {
  variants?: Record<
    string,
    Array<{
      variant_id: string;
      conditions: Partial<Record<string, LogicVariableBand>>;
      scene_text: string;
      insight?: string;
    }>
  >;
  summary?: string;
};

type SimulationResult = {
  ok: boolean;
  ending?: string;
  reason?: string;
  steps: number;
  warnings: string[];
  state: Record<string, number>;
};

type ExhaustiveSimulationResult = {
  terminalPaths: number;
  naturalEndings: number;
  failureEndings: number;
  maxDepth: number;
  badCount: number;
  badExamples: string[];
  endingCounts: Record<string, number>;
};

type ValidationReport = {
  storyId: string;
  counts: {
    nodes: number;
    endings: number;
    playableNodes: number;
    resultPages: number;
    warningPages: number;
    variables: number;
    variantPages: number;
    variants: number;
    comboVariants: number;
  };
  requirements: {
    allPlayableNodesHaveThreeOptions: boolean;
    allChoicesHaveExplicitIds: boolean;
    variableWarningsAndFailuresPresent: boolean;
    allEnumeratedPathsTerminate: boolean;
    normalStrategyReachesNaturalEnding: boolean;
  };
  issues: string[];
  balanceNotes: string[];
  sampleSimulation: Record<"normal" | "positive" | "negative" | "mixed", SimulationResult>;
  exhaustiveSimulation: ExhaustiveSimulationResult;
};

const __filename = fileURLToPath(import.meta.url);
const BACKEND_DIR = path.resolve(path.dirname(__filename), "..");
const ROOT_DIR = path.resolve(BACKEND_DIR, "..");
const RUNS_DIR = path.join(ROOT_DIR, "data", "runs");
const STORIES_DIR = path.join(ROOT_DIR, "data", "stories");

const TEXT_API_KEY = process.env.TEXT_API_KEY || process.env.GCLI_API_KEY || process.env.OPENAI_API_KEY;
const TEXT_API_BASE_URL = normalizeApiBaseURL(process.env.TEXT_BASE_URL || process.env.GCLI_BASE_URL || process.env.OPENAI_BASE_URL || "https://gcli.ggchan.dev/v1");
const TEXT_MODEL = process.env.TEXT_MODEL || process.env.GCLI_MODEL || "gemini-3-flash-preview";
const RESEARCH_API_KEY = process.env.RESEARCH_API_KEY || process.env.OPENAI_API_KEY;
const RESEARCH_API_BASE_URL = normalizeApiBaseURL(process.env.RESEARCH_BASE_URL || "https://api.openai.com/v1");
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "gpt-4o";
const IMAGE_API_KEY = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
const IMAGE_API_BASE_URL = normalizeApiBaseURL(process.env.IMAGE_BASE_URL || "https://api.openai.com/v1");
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const ENABLE_LIVE_RESEARCH = process.env.FULL_ENABLE_LIVE_RESEARCH !== "false";
const ENABLE_IMAGE_GENERATION = process.env.FULL_ENABLE_IMAGE_GENERATION === "true";
const FULL_MAX_IMAGES = Math.max(0, Number(process.env.FULL_MAX_IMAGES ?? 999));
const OUTPUT_LANGUAGE: "en" | "zh" = process.env.FULL_OUTPUT_LANGUAGE === "en" ? "en" : "zh";
const STORY_ID = process.env.FULL_DEMO_STORY_ID || `utokyo_cs_full_${Date.now()}`;
const RUN_DIR = path.join(RUNS_DIR, STORY_ID);

const OPTION_KINDS: LogicOptionKind[] = ["normal", "positive_extreme", "negative_extreme"];
const BASE_VARIABLES: LogicVariableDefinition[] = [
  {
    id: "money",
    label: "Money",
    initial: 66,
    is_base: true,
    rationale: "Cash buffer controls deposits, rent, commuting, tuition timing, and emergency room to stay enrolled.",
    affects_nodes: ["N02_deposit_tuition", "N04_housing_commute", "N07_part_time_work", "N11_graduation_status", "N12_final_choice"],
    warning_page_id: "W_money_bad",
    failure_page_id: "E_money_critical",
  },
  {
    id: "time",
    label: "Time",
    initial: 72,
    is_base: true,
    rationale: "Deadline buffer controls admission paperwork, visa timing, course registration, research milestones, and job status change.",
    affects_nodes: ["N02_deposit_tuition", "N03_coe_visa", "N05_arrival_registration", "N09_typhoon_deadline", "N11_graduation_status"],
    warning_page_id: "W_time_bad",
    failure_page_id: "E_time_critical",
  },
  {
    id: "visa",
    label: "Visa",
    initial: 74,
    is_base: true,
    rationale: "Immigration readiness decides whether the student can enter, work part-time, remain enrolled, and change status after graduation.",
    affects_nodes: ["N03_coe_visa", "N05_arrival_registration", "N07_part_time_work", "N11_graduation_status", "N12_final_choice"],
    warning_page_id: "W_visa_bad",
    failure_page_id: "E_visa_critical",
  },
  {
    id: "housing",
    label: "Housing",
    initial: 58,
    is_base: true,
    rationale: "Housing security controls commute fatigue, upfront cost, address registration, and whether the player can sustain the first semester.",
    affects_nodes: ["N04_housing_commute", "N05_arrival_registration", "N06_lab_courses", "N09_typhoon_deadline"],
    warning_page_id: "W_housing_bad",
    failure_page_id: "E_housing_critical",
  },
  {
    id: "school",
    label: "School",
    initial: 72,
    is_base: true,
    rationale: "Academic standing determines whether coursework, lab progress, graduation, and post-study opportunities remain viable.",
    affects_nodes: ["N06_lab_courses", "N08_language_support", "N09_typhoon_deadline", "N10_career_internship", "N12_final_choice"],
    warning_page_id: "W_school_bad",
    failure_page_id: "E_school_critical",
  },
  {
    id: "wellbeing",
    label: "Wellbeing",
    initial: 70,
    is_base: true,
    rationale: "Physical and emotional resilience decides whether pressure turns into a recoverable warning or a forced pause.",
    affects_nodes: ["N04_housing_commute", "N06_lab_courses", "N08_language_support", "N09_typhoon_deadline", "N12_final_choice"],
    warning_page_id: "W_wellbeing_bad",
    failure_page_id: "E_wellbeing_critical",
  },
];

const SUPPLEMENTAL_VARIABLES: LogicVariableDefinition[] = [
  {
    id: "japanese",
    label: "Japanese",
    initial: 48,
    is_base: false,
    rationale: "Japanese ability changes housing paperwork, ward office tasks, part-time work options, and local job interviews.",
    affects_nodes: ["N05_arrival_registration", "N07_part_time_work", "N08_language_support", "N10_career_internship"],
    warning_page_id: "W_japanese_bad",
    failure_page_id: "E_japanese_critical",
  },
  {
    id: "career",
    label: "Career",
    initial: 55,
    is_base: false,
    rationale: "Career readiness changes internship access, local job conversion, and whether a post-study plan is realistic.",
    affects_nodes: ["N10_career_internship", "N11_graduation_status", "N12_final_choice"],
    warning_page_id: "W_career_bad",
    failure_page_id: "E_career_critical",
  },
  {
    id: "lab_reputation",
    label: "Lab Reputation",
    initial: 55,
    is_base: false,
    rationale: "Advisor and lab reputation affects references, research opportunities, and resilience during milestone pressure.",
    affects_nodes: ["N06_lab_courses", "N09_typhoon_deadline", "N10_career_internship", "N12_final_choice"],
    warning_page_id: "W_lab_reputation_bad",
    failure_page_id: "E_lab_reputation_critical",
  },
];

const NODE_OUTLINES: Array<{
  id: string;
  title: string;
  stage: LogicNode["stage"];
  is_special: boolean;
  why_special?: string;
  facts_used: string[];
  variant_triggers: LogicVariantTrigger[];
}> = [
  {
    id: "N01_offer_acceptance",
    title: "Offer acceptance and first commitment",
    stage: "offer_prearrival",
    is_special: false,
    facts_used: ["The game begins after an offer, so the first decision is commitment rather than application strategy."],
    variant_triggers: [{ variables: ["money", "time"], reason: "Deposit urgency reads differently when money or deadline buffer is weak." }],
  },
  {
    id: "N02_deposit_tuition",
    title: "Deposit, tuition, and proof-of-funds buffer",
    stage: "offer_prearrival",
    is_special: true,
    why_special: "Bad funding choices can make the offer impossible before arrival.",
    facts_used: ["Tokyo living costs and university fees make initial cash planning a high-impact node."],
    variant_triggers: [{ variables: ["money"], reason: "The same tuition deadline feels different when cash is good, mid, or bad." }],
  },
  {
    id: "N03_coe_visa",
    title: "COE and student visa timing",
    stage: "offer_prearrival",
    is_special: true,
    why_special: "Visa timing can hard-stop entry or force deferral.",
    facts_used: ["Japan student visas require a Certificate of Eligibility and careful timing."],
    variant_triggers: [{ variables: ["visa", "time"], reason: "Visa text changes when both paperwork readiness and time are under pressure." }],
  },
  {
    id: "N04_housing_commute",
    title: "Housing, address, and commute",
    stage: "offer_prearrival",
    is_special: true,
    why_special: "Housing changes money, commute time, address registration, and wellbeing at once.",
    facts_used: ["Tokyo rent and commute tradeoffs are major student-life constraints."],
    variant_triggers: [{ variables: ["money", "housing"], reason: "Housing options split strongly by money and housing security." }],
  },
  {
    id: "N05_arrival_registration",
    title: "Arrival week and ward-office registration",
    stage: "study",
    is_special: false,
    facts_used: ["International students must handle arrival logistics, address registration, banking, and orientation."],
    variant_triggers: [{ variables: ["japanese", "time"], reason: "Bureaucracy feels different with low Japanese and little time." }],
  },
  {
    id: "N06_lab_courses",
    title: "Lab culture and course registration",
    stage: "study",
    is_special: true,
    why_special: "Advisor relationship and course choices can change graduation and career endings.",
    facts_used: ["Computer science graduate study depends heavily on lab culture, research progress, and workload."],
    variant_triggers: [{ variables: ["school", "wellbeing", "lab_reputation"], reason: "Academic pressure is a combined school, wellbeing, and lab-reputation problem." }],
  },
  {
    id: "N07_part_time_work",
    title: "Part-time work permission and income",
    stage: "study",
    is_special: true,
    why_special: "Working too much can rescue money while damaging visa, school, and health.",
    facts_used: ["Student status part-time work is limited and requires permission."],
    variant_triggers: [{ variables: ["money", "visa"], reason: "The work decision changes if money is bad but visa is also fragile." }],
  },
  {
    id: "N08_language_support",
    title: "Language, support office, and isolation",
    stage: "study",
    is_special: false,
    facts_used: ["Tokyo has international-student support, but daily life still creates language and isolation pressure."],
    variant_triggers: [{ variables: ["japanese", "wellbeing"], reason: "Social support text depends on language ability and emotional resilience." }],
  },
  {
    id: "N09_typhoon_deadline",
    title: "Typhoon week and research milestone",
    stage: "study",
    is_special: true,
    why_special: "A compressed academic milestone can trigger school or wellbeing collapse.",
    facts_used: ["Humid summers and typhoon season can disrupt routines while deadlines continue."],
    variant_triggers: [{ variables: ["school", "wellbeing", "time"], reason: "The same deadline can be a manageable crunch or a collapse depending on three variables." }],
  },
  {
    id: "N10_career_internship",
    title: "Internship, networking, and local job search",
    stage: "post_graduation",
    is_special: true,
    why_special: "Career choices decide local employment, return-home, or third-country endings.",
    facts_used: ["CS career prospects are strong, but Japanese language and local networking can matter."],
    variant_triggers: [{ variables: ["career", "japanese", "lab_reputation"], reason: "Job-search text changes with career readiness, Japanese, and references." }],
  },
  {
    id: "N11_graduation_status",
    title: "Graduation and status-change window",
    stage: "post_graduation",
    is_special: true,
    why_special: "Status timing after graduation can decide whether the player can remain in Japan.",
    facts_used: ["Post-graduation status change requires time, employer readiness, and immigration paperwork."],
    variant_triggers: [{ variables: ["visa", "time", "career"], reason: "Status-change urgency is a three-variable combination." }],
  },
  {
    id: "N12_final_choice",
    title: "Final life direction",
    stage: "post_graduation",
    is_special: true,
    why_special: "This node selects the final non-failure ending from accumulated state.",
    facts_used: ["The final page should resolve whether Tokyo becomes home, a launchpad, or a difficult but useful chapter."],
    variant_triggers: [{ variables: ["money", "school", "wellbeing", "career"], reason: "Final tone depends on the combined state rather than one variable." }],
  },
];

const MANUAL_RESEARCH: ResearchReport & { research_batches?: JsonObject[] } = {
  mode: "live_search",
  location: { country: "Japan", city: "Tokyo" },
  major: "Computer Science",
  grade: "Taught Master",
  profile: {
    country: "Japan",
    city: "Tokyo",
    school: "The University of Tokyo",
    department: "Graduate School of Information Science and Technology",
    program: "Computer Science master's track",
    major: "Computer Science",
    grade: "Taught Master",
  },
  report: {
    cost_of_living:
      "Tokyo is a high-cost student city. Rent and initial move-in costs dominate the first months, and cheaper housing often means long commutes.",
    academic:
      "Computer science graduate study is shaped by research groups, course registration, advisor expectations, project milestones, and lab reputation.",
    visa:
      "Japan student status depends on timely Certificate of Eligibility and visa paperwork. Part-time work requires permission and is bounded by hourly limits.",
    culture_shock:
      "Daily life bureaucracy, housing contracts, ward-office tasks, and social cues can remain difficult even when academic work is in English.",
    community:
      "The university has international-student support and peer networks, but the player must actively use them to avoid isolation.",
    career:
      "Tokyo has strong tech employment possibilities, but local job conversion depends on timing, Japanese ability, references, and immigration status.",
    safety:
      "Tokyo is generally safe, which helps late commutes and campus life, but safety does not remove money, deadline, or bureaucracy pressure.",
    climate:
      "Humid summers and typhoon season can disrupt commuting, sleep, and deadline routines.",
    part_time_work:
      "Part-time work can stabilize money, but overwork can harm visa status, school progress, and wellbeing.",
  },
  gameplay_signals: {
    health: [
      "Long commutes and humid weather can reduce sleep and energy.",
      "Lab crunch and part-time work can compound fatigue.",
      "Support use and stable housing can protect wellbeing.",
    ],
    mood: [
      "Language barriers and bureaucracy can create isolation.",
      "Peer support and club/community contact can recover belonging.",
      "Advisor trust can reduce or intensify academic anxiety.",
    ],
    money: [
      "Move-in cost, deposits, rent, and tuition timing are early high-impact pressures.",
      "Part-time work improves cash but can create visa and study risk.",
      "Career preparation can recover money late if the route survives.",
    ],
    city_major_specific_challenges: [
      "Pay the deposit and prove funds without draining the entire first-semester buffer.",
      "Keep visa and COE timing clean while booking flights and housing.",
      "Choose between a costly close apartment and a cheaper long commute.",
      "Balance lab expectations, course registration, and side income.",
      "Handle typhoon-week disruption during a research milestone.",
      "Turn CS skills into a local job before status-change timing runs out.",
    ],
  },
  source_coverage: {
    program_official: true,
    department_official: true,
    international_office: true,
    tuition: true,
    housing: true,
    career: true,
    student_forum: false,
  },
  program_profile: {
    official_name: "Graduate School of Information Science and Technology",
    degree_type: "Master's program",
    department: "Computer Science",
    duration: "Usually two years for a master's program",
    delivery_mode: "Campus-based graduate study with courses, research groups, and thesis/research milestones",
    visa_eligible_notes: "International students need valid residence status for study and must maintain paperwork deadlines.",
    curriculum: ["Computer science graduate courses", "Research seminars", "Lab-based supervision", "Master's research project"],
    milestones: ["Offer acceptance", "COE and visa", "Arrival registration", "Course registration", "Research milestone", "Graduation/status change"],
    funding: ["Tuition/fees", "Rent and move-in cost", "Scholarships or part-time work as pressure release"],
  },
  student_life_profile: {
    housing: "Tokyo housing requires tradeoffs among rent, commute, guarantor/contract friction, and address registration.",
    commute: "Rail commuting is reliable but can be exhausting when housing is far from campus.",
    campus_support: "International office and student support reduce risk when used early.",
    community: "International-student networks can soften isolation, but local integration takes deliberate effort.",
    safety: "Low crime helps daily life, but bureaucracy and money pressure remain important.",
    climate: "Summer humidity and typhoon disruptions can turn a normal deadline into a crisis.",
  },
  career_profile: {
    local_industry: "Tokyo has a broad tech employment market for computer science graduates.",
    internship: "Internship and networking choices affect career readiness before graduation.",
    work_authorization: "Working during study and changing status after graduation require attention to immigration rules.",
    language_or_networking_requirements: "Japanese ability and local references can make local job conversion much easier.",
  },
  sources: [
    {
      title: "Graduate School of Information Science and Technology, The University of Tokyo",
      url: "https://www.i.u-tokyo.ac.jp/edu/course/cs/index_e.shtml",
      source_type: "department",
      confidence: "high",
      used_for: ["academic", "program"],
    },
    {
      title: "The University of Tokyo - International Student Support",
      url: "https://www.u-tokyo.ac.jp/adm/inbound/en/life.html",
      source_type: "international_office",
      confidence: "high",
      used_for: ["visa", "housing", "support"],
    },
    {
      title: "Study in Japan - Life in Japan",
      url: "https://www.studyinjapan.go.jp/en/life/",
      source_type: "reference",
      confidence: "medium",
      used_for: ["cost_of_living", "part_time_work"],
    },
    {
      title: "Immigration Services Agency of Japan - Status of Residence",
      url: "https://www.moj.go.jp/isa/applications/status/student.html",
      source_type: "official_registry",
      confidence: "official_registry",
      used_for: ["visa", "work_authorization"],
    },
    {
      title: "JASSO - Student Guide to Japan",
      url: "https://www.jasso.go.jp/en/ryugaku/after_study_j/index.html",
      source_type: "reference",
      confidence: "medium",
      used_for: ["career", "life"],
    },
  ],
  gaps: [
    "This full demo uses a manually prepared research packet for Tokyo CS rather than live web-search agent output.",
    "The product direction says taught/coursework master; this demo treats the master's route as a course-and-research graduate track for gameplay purposes.",
  ],
  research_batches: [
    {
      id: "batch_program",
      facts: [
        "Graduate CS life should be modeled around course registration, lab expectations, research milestones, and thesis progress.",
        "Special nodes should include lab/course choices, research milestone pressure, and career/status conversion.",
      ],
      node_adaptations: ["Add lab_reputation as a supplemental variable.", "Mark N06 and N09 as special."],
    },
    {
      id: "batch_admin_visa",
      facts: [
        "Post-offer reality starts with deposit/fees, COE, student visa, address registration, and status maintenance.",
        "Part-time work is useful but can create visa risk if treated recklessly.",
      ],
      node_adaptations: ["Mark N03 and N07 as special.", "Use visa+time combination variants."],
    },
    {
      id: "batch_city_life",
      facts: [
        "Tokyo housing creates a money versus commute tradeoff.",
        "Humidity and typhoon disruptions can turn deadlines into crisis pages.",
      ],
      node_adaptations: ["Mark N04 and N09 as special.", "Use money+housing and school+wellbeing+time variants."],
    },
    {
      id: "batch_career",
      facts: [
        "Local career conversion depends on Japanese, networking, references, and status-change timing.",
        "Final endings should separate staying in Tokyo, returning home with value, third-country launch, deferral, and failures.",
      ],
      node_adaptations: ["Add career and japanese variables.", "Mark N10, N11, and N12 as special."],
    },
  ],
};

let ACTIVE_RESEARCH: ResearchReport & { research_batches?: JsonObject[] } = MANUAL_RESEARCH;

function normalizeApiBaseURL(raw: string): string {
  const url = new URL(raw);
  if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function compact(value: unknown, max = 18_000): string {
  const raw = JSON.stringify(value, null, 2);
  return raw.length > max ? `${raw.slice(0, max)}\n...<truncated ${raw.length - max} chars>` : raw;
}

function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (match ? match[1] : text).trim();
}

function extractJsonObject(text: string): JsonObject {
  const stripped = stripFences(text);
  const start = stripped.indexOf("{");
  if (start === -1) throw new Error("Model response did not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const char = stripped[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return parseJsonObject(stripped.slice(start, i + 1));
    }
  }
  throw new Error("Model response JSON object was incomplete");
}

function parseJsonObject(jsonText: string): JsonObject {
  try {
    return JSON.parse(jsonText) as JsonObject;
  } catch (error) {
    const withoutUnaryPlus = jsonText.replace(/(:\s*)\+(\d)/g, "$1$2").replace(/(\[\s*)\+(\d)/g, "$1$2").replace(/(,\s*)\+(\d)/g, "$1$2");
    if (withoutUnaryPlus !== jsonText) return JSON.parse(withoutUnaryPlus) as JsonObject;
    throw error;
  }
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(RUN_DIR, { recursive: true });
  await fs.mkdir(STORIES_DIR, { recursive: true });
}

async function appendLog(line: string): Promise<void> {
  await fs.appendFile(path.join(RUN_DIR, "full_generator.log"), `${new Date().toISOString()} ${line}\n`);
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await fs.writeFile(path.join(RUN_DIR, name), JSON.stringify(value, null, 2), "utf8");
}

const MAX_CHAT_JSON_ATTEMPTS = 3;
const TRANSIENT_API_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chatJson<T extends JsonObject>(stage: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<T> {
  if (!TEXT_API_KEY) throw new Error("Set TEXT_API_KEY, GCLI_API_KEY, or OPENAI_API_KEY before running this script.");
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CHAT_JSON_ATTEMPTS; attempt += 1) {
    const attemptStarted = Date.now();
    await appendLog(`[api:${stage}] started${attempt > 1 ? ` retry=${attempt}` : ""}`);
    try {
      const response = await fetch(`${TEXT_API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEXT_API_KEY}`,
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.45,
        }),
      });
      const raw = await response.text();
      await writeJson(`api_${stage}_response.json`, {
        status: response.status,
        ok: response.ok,
        attempt,
        duration_ms: Date.now() - attemptStarted,
        total_duration_ms: Date.now() - started,
        raw_content: response.ok ? undefined : raw,
      });
      if (!response.ok) {
        const error = new Error(`API ${stage} failed with status ${response.status}: ${raw.slice(0, 1000)}`);
        lastError = error;
        await appendLog(`[api:${stage}] failed status=${response.status} attempt=${attempt}`);
        if (TRANSIENT_API_STATUSES.has(response.status) && attempt < MAX_CHAT_JSON_ATTEMPTS) {
          await wait(3500 * attempt);
          continue;
        }
        throw error;
      }
      const payload = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content ?? "";
      await fs.writeFile(path.join(RUN_DIR, `api_${stage}_content.txt`), content, "utf8");
      const parsed = extractJsonObject(content) as T;
      await writeJson(`api_${stage}_parsed.json`, parsed);
      await appendLog(`[api:${stage}] completed in ${Date.now() - started}ms`);
      return parsed;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(`[api:${stage}] error attempt=${attempt}: ${message.slice(0, 220)}`);
      if (attempt < MAX_CHAT_JSON_ATTEMPTS) {
        await wait(3500 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function responseOutputText(payload: JsonObject): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = item as { text?: unknown; type?: unknown };
      return typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function researchBatchesFromReport(report: ResearchReport): JsonObject[] {
  const batches: JsonObject[] = [
    {
      batch: "live_search_summary",
      facts: Object.entries(report.report ?? {}).map(([key, value]) => `${key}: ${value}`),
      node_adaptations: [
        "Use live research to adapt special nodes, option consequences, warning pages, and endings.",
        "Add missing nodes or variables only when facts materially change the route.",
      ],
    },
  ];
  if (report.program_profile) batches.push({ batch: "program_profile", ...report.program_profile });
  if (report.student_life_profile) batches.push({ batch: "student_life_profile", ...report.student_life_profile });
  if (report.career_profile) batches.push({ batch: "career_profile", ...report.career_profile });
  if (report.campus_life_profile) batches.push({ batch: "campus_life_profile", ...report.campus_life_profile });
  return batches;
}

function normalizeResearchReport(report: Partial<ResearchReport>): ResearchReport & { research_batches?: JsonObject[] } {
  const merged = {
    ...MANUAL_RESEARCH,
    ...report,
    location: {
      ...MANUAL_RESEARCH.location,
      ...(report.location ?? {}),
    },
    profile: {
      ...MANUAL_RESEARCH.profile,
      ...(report.profile ?? {}),
    },
    report: {
      ...MANUAL_RESEARCH.report,
      ...(report.report ?? {}),
    },
    gameplay_signals: {
      ...MANUAL_RESEARCH.gameplay_signals,
      ...(report.gameplay_signals ?? {}),
    },
    research_batches: (report as { research_batches?: JsonObject[] }).research_batches,
  } as ResearchReport & { research_batches?: JsonObject[] };
  merged.research_batches = merged.research_batches?.length ? merged.research_batches : researchBatchesFromReport(merged);
  return merged;
}

async function retrieveResearch(): Promise<ResearchReport & { research_batches?: JsonObject[] }> {
  if (!ENABLE_LIVE_RESEARCH) {
    await appendLog("[research] live retrieval disabled; using bundled manual research packet");
    await writeJson("00_research_report.json", MANUAL_RESEARCH);
    return MANUAL_RESEARCH;
  }
  if (!RESEARCH_API_KEY) {
    await appendLog("[research] no research API key; using bundled manual research packet");
    await writeJson("00_research_report.json", MANUAL_RESEARCH);
    return MANUAL_RESEARCH;
  }

  const started = Date.now();
  await appendLog(`[api:00_live_research] started model=${RESEARCH_MODEL} baseURL=${RESEARCH_API_BASE_URL}`);
  const prompt = `Research the current demo profile and return one strict JSON ResearchReport object.

Profile:
- country: Japan
- city: Tokyo
- school: The University of Tokyo
- department: Graduate School of Information Science and Technology
- major: Computer Science
- grade: Taught Master

Need:
- Use web search for official or high-confidence sources.
- Focus on post-offer student life: COE/student visa, tuition/proof of funds, housing/commute, ward-office registration, lab/course culture, Japanese language, part-time work, typhoon/deadline disruption, career/internship/status change.
- Include source URLs where available.
- Keep the JSON concise enough to parse.

Return shape compatible with the existing ResearchReport TypeScript interface:
{
  "mode": "live_search",
  "location": {"country":"Japan","city":"Tokyo"},
  "major": "Computer Science",
  "grade": "Taught Master",
  "profile": {"country":"Japan","city":"Tokyo","school":"The University of Tokyo","department":"Graduate School of Information Science and Technology","major":"Computer Science","grade":"Taught Master"},
  "report": {"cost_of_living":"...","academic":"...","visa":"...","culture_shock":"...","community":"...","career":"...","safety":"...","climate":"...","part_time_work":"..."},
  "gameplay_signals": {"health":[],"mood":[],"money":[],"city_major_specific_challenges":[]},
  "program_profile": {},
  "student_life_profile": {},
  "career_profile": {},
  "campus_life_profile": {},
  "sources": [{"title":"...","url":"...","source_type":"program_official","confidence":"high","used_for":["..."]}],
  "gaps": []
}`;

  const response = await fetch(`${RESEARCH_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEARCH_API_KEY}`,
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      tools: [{ type: "web_search_preview" }],
      max_output_tokens: 10000,
      input: prompt,
    }),
  });
  const raw = await response.text();
  await writeJson("api_00_live_research_response.json", {
    status: response.status,
    ok: response.ok,
    duration_ms: Date.now() - started,
    raw_content: response.ok ? undefined : raw.slice(0, 2000),
  });
  if (!response.ok) {
    await appendLog(`[api:00_live_research] failed status=${response.status}; using bundled manual research packet`);
    await writeJson("00_research_report.json", MANUAL_RESEARCH);
    return MANUAL_RESEARCH;
  }

  try {
    const payload = JSON.parse(raw) as JsonObject;
    const content = responseOutputText(payload);
    await fs.writeFile(path.join(RUN_DIR, "api_00_live_research_content.txt"), content, "utf8");
    const parsed = extractJsonObject(content) as Partial<ResearchReport>;
    const report = normalizeResearchReport(parsed);
    await writeJson("api_00_live_research_parsed.json", report);
    await writeJson("00_research_report.json", report);
    await appendLog(`[api:00_live_research] completed in ${Date.now() - started}ms`);
    return report;
  } catch (error) {
    await appendLog(`[api:00_live_research] parse failed; using bundled manual research packet: ${error instanceof Error ? error.message : String(error)}`);
    await writeJson("00_research_report.json", MANUAL_RESEARCH);
    return MANUAL_RESEARCH;
  }
}

function allVariables(graph: LogicGraphDocument): LogicVariableDefinition[] {
  return [...graph.base_variables, ...(graph.accepted_supplemental_variables ?? [])];
}

function variableIds(graph: LogicGraphDocument): string[] {
  return allVariables(graph).map((variable) => variable.id);
}

function labelFromId(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeGeneratorVariable(variable: LogicVariableDefinition, isBase: boolean): LogicVariableDefinition {
  const raw = variable as LogicVariableDefinition & { description?: string };
  const id = raw.id.trim();
  const fallback = BASE_VARIABLES.find((item) => item.id === id) ?? SUPPLEMENTAL_VARIABLES.find((item) => item.id === id);
  return {
    ...fallback,
    ...raw,
    id,
    label: raw.label?.trim() || fallback?.label || labelFromId(id),
    initial: Number.isFinite(raw.initial) ? Math.max(0, Math.min(100, Math.round(raw.initial))) : (fallback?.initial ?? 70),
    is_base: isBase,
    rationale: raw.rationale?.trim() || raw.description?.trim() || fallback?.rationale || "Variable affects post-offer route feasibility.",
    affects_nodes: Array.isArray(raw.affects_nodes) ? raw.affects_nodes : (fallback?.affects_nodes ?? []),
    warning_page_id: raw.warning_page_id?.trim() || fallback?.warning_page_id || `W_${id}_bad`,
    failure_page_id: raw.failure_page_id?.trim() || fallback?.failure_page_id || `E_${id}_critical`,
  };
}

function normalizeBaseVariables(variables: LogicVariableDefinition[] | undefined): LogicVariableDefinition[] {
  const byId = new Map(BASE_VARIABLES.map((variable) => [variable.id, variable]));
  for (const variable of variables ?? []) {
    if (!variable?.id?.trim()) continue;
    byId.set(variable.id.trim(), normalizeGeneratorVariable(variable, true));
  }
  return BASE_VARIABLES.map((variable) => normalizeGeneratorVariable(byId.get(variable.id) ?? variable, true));
}

function normalizeSupplementalVariables(variables: LogicVariableDefinition[] | undefined): LogicVariableDefinition[] {
  const byId = new Map<string, LogicVariableDefinition>();
  for (const variable of variables ?? []) {
    if (!variable?.id?.trim()) continue;
    const id = variable.id.trim();
    if (BASE_VARIABLES.some((base) => base.id === id)) continue;
    byId.set(id, normalizeGeneratorVariable(variable, false));
  }
  return [...byId.values()];
}

function makeWarningPage(variable: LogicVariableDefinition): LogicPage {
  return {
    id: variable.warning_page_id,
    role: "warning",
    owner_node_id: "system",
    title: `${variable.label} warning`,
    placeholder: `${variable.label} has entered the bad band. Warn once, then return to the interrupted option result page.`,
    variant_triggers: [{ variables: [variable.id], reason: `${variable.label} is bad but still recoverable.` }],
  };
}

function makeFailureEnding(variable: LogicVariableDefinition): LogicEnding {
  return {
    id: variable.failure_page_id,
    title: `${variable.label} collapse`,
    tone: "challenging",
    condition_summary: `${variable.label} reached the critical band and killed the current planning chain.`,
  };
}

function createEmptyNode(outline: (typeof NODE_OUTLINES)[number]): LogicNode {
  return {
    id: outline.id,
    type: outline.is_special ? "special_node" : "base_node",
    title: outline.title,
    stage: outline.stage,
    is_special: outline.is_special,
    why_special: outline.why_special,
    variables_read: variableNamesFromTriggers(outline.variant_triggers),
    variables_written: variableNamesFromTriggers(outline.variant_triggers),
    facts_used: outline.facts_used,
    variant_triggers: outline.variant_triggers,
    options: [],
  };
}

function variableNamesFromTriggers(triggers: LogicVariantTrigger[] | undefined): string[] {
  return [...new Set((triggers ?? []).flatMap((trigger) => trigger.variables))];
}

function createInitialGraph(): LogicGraphDocument {
  const graph: LogicGraphDocument = {
    flow_version: "post_offer_v1",
    story_id: STORY_ID,
    degree_track: "master_taught",
    base_variables: BASE_VARIABLES,
    suggested_variables: SUPPLEMENTAL_VARIABLES,
    accepted_supplemental_variables: SUPPLEMENTAL_VARIABLES,
    main_node_order: NODE_OUTLINES.map((node) => node.id),
    special_nodes: NODE_OUTLINES.filter((node) => node.is_special).map((node) => ({
      node_id: node.id,
      reason: node.why_special ?? `${node.title} can change the final route.`,
      ending_impact: "Can materially change graduation, status, local-work, return-home, or failure endings.",
    })),
    research_adjustments: [],
    nodes: {},
    pages: {},
    endings: {
      E_tokyo_local_job: {
        id: "E_tokyo_local_job",
        title: "Tokyo becomes home",
        tone: "hopeful",
        condition_summary: "The player graduates with enough career, visa, and wellbeing stability to start local work.",
      },
      E_return_home_stronger: {
        id: "E_return_home_stronger",
        title: "Return home stronger",
        tone: "bittersweet",
        condition_summary: "The player completes enough of the route to return home with skills and clarity.",
      },
      E_third_country_launch: {
        id: "E_third_country_launch",
        title: "Third-country launch",
        tone: "hopeful",
        condition_summary: "The player uses the Tokyo degree and network to launch outside Japan.",
      },
      E_defer_or_pause: {
        id: "E_defer_or_pause",
        title: "Defer or pause",
        tone: "bittersweet",
        condition_summary: "The player avoids total failure, but must pause the immediate plan.",
      },
      E_burnout_graduation: {
        id: "E_burnout_graduation",
        title: "Graduated, but burned out",
        tone: "challenging",
        condition_summary: "The degree is finished, but wellbeing and relationships are badly damaged.",
      },
    },
    gaps: [],
  };
  for (const outline of NODE_OUTLINES) {
    graph.nodes[outline.id] = createEmptyNode(outline);
    graph.pages[outline.id] = {
      id: outline.id,
      role: "node",
      owner_node_id: outline.id,
      title: outline.title,
      placeholder: `Decision page for ${outline.title}.`,
      variant_triggers: outline.variant_triggers,
    };
  }
  ensureSystemPages(graph);
  return graph;
}

function ensureSystemPages(graph: LogicGraphDocument): void {
  graph.pages ??= {};
  graph.endings ??= {};
  delete graph.pages.undefined;
  delete graph.endings.undefined;
  graph.base_variables = normalizeBaseVariables(graph.base_variables);
  graph.accepted_supplemental_variables = normalizeSupplementalVariables(graph.accepted_supplemental_variables);
  graph.suggested_variables = normalizeSupplementalVariables(graph.suggested_variables);
  for (const variable of allVariables(graph)) {
    graph.pages[variable.warning_page_id] ??= makeWarningPage(variable);
    graph.endings[variable.failure_page_id] ??= makeFailureEnding(variable);
  }
}

function insertAfter(order: string[], afterId: string, newId: string): string[] {
  if (order.includes(newId)) return order;
  const index = order.indexOf(afterId);
  if (index === -1) return [...order, newId];
  return [...order.slice(0, index + 1), newId, ...order.slice(index + 1)];
}

async function adaptResearch(graph: LogicGraphDocument): Promise<void> {
  const response = await chatJson<ResearchAdaptation>("01_research_adaptation", [
    {
      role: "system",
      content:
        "You adapt a post-offer study-abroad node plan after reading manual research. Return strict JSON only. Do not write story prose.",
    },
    {
      role: "user",
      content: `Manual research batches and starting nodes are below. Decide semantic node tweaks, new special nodes, and supplemental variables.

Rules:
- Keep the game after the offer.
- Use only undergraduate or taught/coursework master framing.
- Mark nodes that can change endings as special.
- You may add nodes only if the research makes a missing decision necessary.
- You may add variables only when they materially affect options, warning pages, or endings.

Existing variable ids: ${variableIds(graph).join(", ")}
Existing node order: ${graph.main_node_order.join(" -> ")}

Research:
${compact(ACTIVE_RESEARCH)}

Current nodes:
${compact(Object.values(graph.nodes).map(({ id, title, stage, is_special, why_special, variant_triggers }) => ({ id, title, stage, is_special, why_special, variant_triggers })))}

Output JSON shape:
{
  "node_adjustments": [{"node_id":"N03_coe_visa","title":"...","is_special":true,"why_special":"...","variant_triggers":[{"variables":["visa","time"],"reason":"..."}],"facts_used":["..."]}],
  "new_nodes": [{"id":"NXX_name","title":"...","insert_after":"N05_arrival_registration","stage":"study","is_special":true,"why_special":"...","variables_read":["money"],"variables_written":["money"],"variant_triggers":[{"variables":["money"],"reason":"..."}],"facts_used":["..."]}],
  "accepted_supplemental_variables": [],
  "special_nodes": [{"node_id":"N03_coe_visa","reason":"...","ending_impact":"..."}],
  "research_adjustments": [{"node_id":"N03_coe_visa","adjustment":"...","facts_used":["..."]}],
  "supervisor_notes": ["..."]
}`,
    },
  ]);

  for (const variable of response.accepted_supplemental_variables ?? []) {
    if (!variable.id || allVariables(graph).some((existing) => existing.id === variable.id)) continue;
    graph.accepted_supplemental_variables ??= [];
    graph.accepted_supplemental_variables.push(variable);
  }
  ensureSystemPages(graph);

  for (const adjustment of response.node_adjustments ?? []) {
    const node = graph.nodes[adjustment.node_id];
    if (!node) continue;
    if (adjustment.title) {
      node.title = adjustment.title;
      graph.pages[node.id].title = adjustment.title;
    }
    if (adjustment.stage) node.stage = adjustment.stage;
    if (typeof adjustment.is_special === "boolean") {
      node.is_special = adjustment.is_special;
      node.type = adjustment.is_special ? "special_node" : node.type === "branch_node" ? "branch_node" : "base_node";
    }
    if (adjustment.why_special) node.why_special = adjustment.why_special;
    if (adjustment.variant_triggers) {
      node.variant_triggers = adjustment.variant_triggers;
      graph.pages[node.id].variant_triggers = adjustment.variant_triggers;
    }
    if (adjustment.facts_used) node.facts_used = adjustment.facts_used;
  }

  for (const newNode of response.new_nodes ?? []) {
    if (!newNode.id || graph.nodes[newNode.id]) continue;
    graph.main_node_order = insertAfter(graph.main_node_order, newNode.insert_after, newNode.id);
    graph.nodes[newNode.id] = {
      id: newNode.id,
      type: newNode.is_special ? "special_node" : "base_node",
      title: newNode.title,
      stage: newNode.stage,
      is_special: Boolean(newNode.is_special),
      why_special: newNode.why_special,
      variables_read: newNode.variables_read ?? variableNamesFromTriggers(newNode.variant_triggers),
      variables_written: newNode.variables_written ?? variableNamesFromTriggers(newNode.variant_triggers),
      facts_used: newNode.facts_used,
      variant_triggers: newNode.variant_triggers,
      options: [],
    };
    graph.pages[newNode.id] = {
      id: newNode.id,
      role: "node",
      owner_node_id: newNode.id,
      title: newNode.title,
      placeholder: `Decision page for ${newNode.title}.`,
      variant_triggers: newNode.variant_triggers,
    };
  }
  if (response.special_nodes?.length) graph.special_nodes = response.special_nodes;
  if (response.research_adjustments?.length) graph.research_adjustments = response.research_adjustments;
  await writeJson("01_manual_research_report.json", ACTIVE_RESEARCH);
  await writeJson("02_research_adapted_graph.json", graph);
}

function nextMainNodeId(graph: LogicGraphDocument, nodeId: string): string {
  const index = graph.main_node_order.indexOf(nodeId);
  if (index === -1) return "E_defer_or_pause";
  return graph.main_node_order[index + 1] ?? "N12_final_choice";
}

function graphSummary(graph: LogicGraphDocument): JsonObject {
  return {
    story_id: graph.story_id,
    variables: allVariables(graph).map(({ id, initial, warning_page_id, failure_page_id }) => ({ id, initial, warning_page_id, failure_page_id })),
    main_node_order: graph.main_node_order,
    special_nodes: graph.special_nodes,
    endings: Object.values(graph.endings).map(({ id, title, condition_summary }) => ({ id, title, condition_summary })),
    planned_nodes: Object.values(graph.nodes).map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      stage: node.stage,
      is_special: node.is_special,
      option_count: node.options.length,
    })),
  };
}

function sanitizeDelta(delta: Record<string, number> | undefined, graph: LogicGraphDocument): Record<string, number> {
  const allowed = new Set(variableIds(graph));
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (!allowed.has(key)) continue;
    const numeric = Number(value);
    clean[key] = Number.isFinite(numeric) ? Math.max(-60, Math.min(60, Math.round(numeric))) : 0;
  }
  return clean;
}

function normalizeOption(option: Partial<LogicOption>, nodeId: string, index: number, graph: LogicGraphDocument, defaultNextId: string): LogicOption {
  const kind = OPTION_KINDS[index];
  const suffix = `O${index + 1}`;
  const id = option.id?.trim() || `${nodeId}_${suffix}`;
  const resultPageId = option.result_page_id?.trim() || `R_${id}`;
  const plannedNextId = option.planned_next_id?.trim() || defaultNextId;
  const isEnding = Boolean(graph.endings[plannedNextId]);
  const isBranch = Boolean(graph.nodes[plannedNextId]?.type === "branch_node");
  return {
    id,
    kind: option.kind && OPTION_KINDS.includes(option.kind) ? option.kind : kind,
    label: option.label?.trim() || `${kind} action`,
    result_page_id: resultPageId,
    planned_next_id: plannedNextId,
    route_decision: option.route_decision ?? (isEnding ? "enter_ending" : isBranch ? "enter_parallel_branch_node" : "return_to_next_main_node"),
    delta: sanitizeDelta(option.delta, graph),
    state_set: option.state_set,
    rationale: option.rationale?.trim() || `${kind} option for ${nodeId}.`,
    facts_used: option.facts_used,
  };
}

function normalizeNodePlan(node: LogicNode, pages: Record<string, LogicPage>, graph: LogicGraphDocument, defaultNextId: string): void {
  node.id = node.id?.trim();
  node.type = node.type === "branch_node" ? "branch_node" : node.is_special || node.type === "special_node" ? "special_node" : "base_node";
  node.stage = ["offer_prearrival", "study", "post_graduation"].includes(node.stage) ? node.stage : "study";
  node.options = OPTION_KINDS.map((kind, index) => {
    const found = node.options.find((option) => option.kind === kind) ?? node.options[index] ?? ({} as LogicOption);
    return normalizeOption(found, node.id, index, graph, defaultNextId);
  });
  node.variables_read = [...new Set([...(node.variables_read ?? []), ...variableNamesFromTriggers(node.variant_triggers)])].filter((id) =>
    variableIds(graph).includes(id),
  );
  node.variables_written = [
    ...new Set([...(node.variables_written ?? []), ...node.options.flatMap((option) => Object.keys(option.delta))]),
  ].filter((id) => variableIds(graph).includes(id));

  graph.nodes[node.id] = node;
  graph.pages[node.id] = {
    id: node.id,
    role: "node",
    owner_node_id: node.id,
    title: pages[node.id]?.title || node.title,
    placeholder: pages[node.id]?.placeholder || `Decision page for ${node.title}.`,
    text: pages[node.id]?.text,
    insight: pages[node.id]?.insight,
    variant_triggers: pages[node.id]?.variant_triggers || node.variant_triggers,
  };
  for (const option of node.options) {
    graph.pages[option.result_page_id] = {
      id: option.result_page_id,
      role: "result",
      owner_node_id: node.id,
      title: pages[option.result_page_id]?.title || `${node.title}: ${option.kind}`,
      placeholder: pages[option.result_page_id]?.placeholder || `Option-after page for ${option.id}.`,
      text: pages[option.result_page_id]?.text,
      insight: pages[option.result_page_id]?.insight,
      variant_triggers:
        pages[option.result_page_id]?.variant_triggers ??
        [{ variables: Object.keys(option.delta).filter((key) => option.delta[key] !== 0), reason: "Result text should reflect changed variables." }],
    };
  }
}

async function planNodeOptions(graph: LogicGraphDocument, nodeId: string): Promise<void> {
  const node = graph.nodes[nodeId];
  const defaultNextId = node.type === "branch_node" ? graph.main_node_order.find((id) => graph.main_node_order.indexOf(id) > -1) ?? "E_defer_or_pause" : nextMainNodeId(graph, nodeId);
  const response = await chatJson<NodePlanResponse>(`03_node_${nodeId}`, [
    {
      role: "system",
      content:
        "You plan one node of a deterministic variable-gated interactive story. Return strict JSON only. You may introduce complete branch nodes only when semantic consequences require them.",
    },
    {
      role: "user",
      content: `Plan options for this node. Do not write final prose.

Hard rules:
- The node must have exactly three options: normal, positive_extreme, negative_extreme.
- Each option must have id, label, result_page_id, planned_next_id, route_decision, delta, rationale.
- The label should be concise and concrete. It will later be prefixed by id in the compiler.
- Every option goes to its result_page_id first; result page then returns to planned_next_id unless variable warning/failure interrupts.
- Use only these variable ids in delta: ${variableIds(graph).join(", ")}
- Deltas should be meaningful but not random. Bad options may push a variable into bad or critical if semantically justified.
- Decide by real-world semantics whether to return to next main node, enter a branch node, or enter an ending.
- If you use a branch planned_next_id, include the full branch node under new_branch_nodes with its own 3 options and result pages.
- Every introduced branch must be able to reach a known next main node or ending.
- Do not use vector routing or semantic page matching. Only explicit ids.

Current node:
${compact(node)}

Default next main node if the option simply continues:
${defaultNextId}

Graph summary:
${compact(graphSummary(graph))}

Research batches:
${compact(ACTIVE_RESEARCH.research_batches)}

Output JSON:
{
  "node": { "...complete LogicNode...": true },
  "pages": {
    "<node_id>": {"id":"<node_id>","role":"node","owner_node_id":"<node_id>","title":"...","placeholder":"...","variant_triggers":[{"variables":["money"],"reason":"..."}]},
    "<result_page_id>": {"id":"...","role":"result","owner_node_id":"<node_id>","title":"...","placeholder":"option-after page placeholder"}
  },
  "endings": {},
  "new_branch_nodes": [{"node": {"...complete branch LogicNode...": true}, "pages": {"...": {}}, "endings": {}}],
  "supervisor_notes": ["..."]
}`,
    },
  ]);
  normalizeNodePlan(response.node, response.pages ?? {}, graph, defaultNextId);
  for (const [endingId, ending] of Object.entries(response.endings ?? {})) graph.endings[endingId] = ending;
  for (const branch of response.new_branch_nodes ?? []) {
    for (const [endingId, ending] of Object.entries(branch.endings ?? {})) graph.endings[endingId] = ending;
    const branchDefaultNext = defaultNextId;
    normalizeNodePlan(branch.node, branch.pages ?? {}, graph, branchDefaultNext);
  }
  ensureSystemPages(graph);
  await writeJson(`04_after_${nodeId}.json`, graph);
}

function collectGraphErrors(graph: LogicGraphDocument): string[] {
  const errors: string[] = [];
  try {
    validateLogicGraph(graph);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const validVariableIds = new Set(variableIds(graph));
  for (const node of Object.values(graph.nodes)) {
    if (node.options.length !== 3) errors.push(`${node.id} has ${node.options.length} options`);
    for (const kind of OPTION_KINDS) {
      if (!node.options.some((option) => option.kind === kind)) errors.push(`${node.id} missing ${kind}`);
    }
    for (const option of node.options) {
      for (const key of Object.keys(option.delta)) {
        if (!validVariableIds.has(key)) errors.push(`${option.id} uses unknown delta variable ${key}`);
      }
      if (!graph.pages[option.result_page_id]) errors.push(`${option.id} missing result page ${option.result_page_id}`);
      if (!graph.nodes[option.planned_next_id] && !graph.endings[option.planned_next_id]) {
        errors.push(`${option.id} planned_next_id missing ${option.planned_next_id}`);
      }
    }
  }
  return errors;
}

async function superviseGraph(graph: LogicGraphDocument): Promise<LogicGraphDocument> {
  let current = graph;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const errors = collectGraphErrors(current);
    await writeJson(`05_supervisor_errors_attempt_${attempt}.json`, { errors });
    if (errors.length === 0) {
      await appendLog(`[supervisor] graph valid on attempt ${attempt}`);
      return current;
    }
    const repaired = await chatJson<LogicGraphDocument>(`05_supervisor_repair_${attempt}`, [
      {
        role: "system",
        content:
          "You are a strict supervisor/repair pass for a deterministic if/else logic graph. Return one complete corrected JSON graph, not a diff.",
      },
      {
        role: "user",
        content: `Repair this graph.

Hard requirements:
- Keep flow_version post_offer_v1 and story_id ${STORY_ID}.
- Keep base variables money/time/visa/housing/school/wellbeing.
- Keep or repair supplemental variables when deltas use them.
- Every playable node exactly 3 options: normal, positive_extreme, negative_extreme.
- Every option has result_page_id, planned_next_id, route_decision, delta.
- Every option chain reaches an ending.
- Add warning pages for all variables and failure endings for critical variables.
- Runtime must be explicit ids and variable values only.
- Preserve good existing node ids and option ids where possible.

Errors:
${compact(errors)}

Graph:
${compact(current, 80_000)}`,
      },
    ]);
    current = {
      ...current,
      ...repaired,
      nodes: repaired.nodes ?? current.nodes,
      pages: repaired.pages ?? current.pages,
      endings: repaired.endings ?? current.endings,
      base_variables: repaired.base_variables ?? current.base_variables,
      accepted_supplemental_variables: repaired.accepted_supplemental_variables ?? current.accepted_supplemental_variables,
      main_node_order: repaired.main_node_order ?? current.main_node_order,
    };
    ensureSystemPages(current);
  }
  const finalErrors = collectGraphErrors(current);
  if (finalErrors.length > 0) throw new Error(`Supervisor could not repair graph: ${finalErrors.join("; ")}`);
  return current;
}

function pageIdsForNode(graph: LogicGraphDocument, node: LogicNode): string[] {
  return [node.id, ...node.options.map((option) => option.result_page_id)];
}

function proseLanguageName(): string {
  return OUTPUT_LANGUAGE === "zh" ? "Simplified Chinese" : "English";
}

function nodeContentRules(nodeId: string): string {
  return OUTPUT_LANGUAGE === "zh"
    ? `- Simplified Chinese only, second person.
- Node page: 80-150 Chinese characters.
- Result pages: 45-100 Chinese characters.
- Keep option ids exactly, but rewrite labels to be human-readable Simplified Chinese.
- Each choice label must still start with its id and a Chinese colon, e.g. ${nodeId}_O1：...`
    : `- English only, second person.
- Node page: 80-150 English words.
- Result pages: 45-100 English words.
- Keep option ids exactly, but rewrite labels to be human-readable English.
- Each choice label must still start with its id and a colon, e.g. ${nodeId}_O1: ...`;
}

function systemContentRules(): string {
  return OUTPUT_LANGUAGE === "zh"
    ? `- Simplified Chinese only, second person, grounded in the Tokyo CS research.
- Warning pages: 45-90 Chinese characters.
- Endings: 90-160 Chinese characters.`
    : `- English only, second person, grounded in the Tokyo CS research.
- Warning pages: 45-90 English words.
- Endings: 90-160 English words.`;
}

function variantLanguageRule(): string {
  return OUTPUT_LANGUAGE === "zh" ? "- Simplified Chinese only." : "- English only.";
}

function choiceOutputExample(): string {
  return OUTPUT_LANGUAGE === "zh" ? "\"choices\": [\"<id>：...\", \"<id>：...\", \"<id>：...\"]" : "\"choices\": [\"<id>: ...\", \"<id>: ...\", \"<id>: ...\"]";
}

async function fillNodeContent(graph: LogicGraphDocument, node: LogicNode, priorSummaries: string[]): Promise<string> {
  const ids = pageIdsForNode(graph, node);
  const pages = Object.fromEntries(ids.map((id) => [id, graph.pages[id]]));
  const response = await chatJson<ContentPatch>(`06_content_${node.id}`, [
    {
      role: "system",
      content:
        `You write ${proseLanguageName()} second-person interactive fiction pages for a study-abroad simulator. Return strict JSON only. Do not change routing ids.`,
    },
    {
      role: "user",
      content: `Fill this node and its option-result pages.

Rules:
${nodeContentRules(node.id)}
- Make the writing concrete, playable, and grounded in research.
- Do not mention implementation, variables, JSON, branches, or page ids in the prose.
- Do not change next_node, planned_next_id, delta, or ids.
- Later content already written is summarized below; avoid repeating the same scene beats.

Previously filled summaries:
${compact(priorSummaries)}

Research:
${compact(ACTIVE_RESEARCH)}

Node:
${compact(node)}

Pages:
${compact(pages)}

Output:
{
      "pages": {
    "<page_id>": {
      "text": "...",
      "insight": "...",
      ${choiceOutputExample()}
    }
  },
  "summary": "one sentence summary of what was filled"
}`,
    },
  ]);
  applyContentPatch(graph, response);
  return response.summary || `${node.id} filled`;
}

async function fillSystemContent(graph: LogicGraphDocument, priorSummaries: string[]): Promise<string> {
  const warningPages = Object.fromEntries(Object.entries(graph.pages).filter(([, page]) => page.role === "warning"));
  const response = await chatJson<ContentPatch>("06_content_system_pages", [
    {
      role: "system",
      content:
        `You write ${proseLanguageName()} warning and ending pages for a deterministic variable-gated study-abroad simulator. Return strict JSON only.`,
    },
    {
      role: "user",
      content: `Fill all warning pages and endings.

Rules:
- Warning pages mean a variable has entered the bad band once; write a warning, not a final failure.
- Failure endings mean a variable reached critical and killed the chain.
- Non-failure endings resolve the study-abroad route.
${systemContentRules()}
- Do not mention variable bands or implementation terms in prose.

Prior summaries:
${compact(priorSummaries)}

Warning pages:
${compact(warningPages)}

Endings:
${compact(graph.endings)}

Output:
{
  "pages": {"<warning_page_id>": {"text":"...","insight":"..."}},
  "endings": {"<ending_id>": {"text":"...","insight":"..."}},
  "summary": "..."
}`,
    },
  ]);
  applyContentPatch(graph, response);
  return response.summary || "system pages filled";
}

function applyContentPatch(graph: LogicGraphDocument, patch: ContentPatch): void {
  for (const [pageId, pagePatch] of Object.entries(patch.pages ?? {})) {
    const page = graph.pages[pageId];
    if (!page) continue;
    if (pagePatch.text?.trim()) page.text = pagePatch.text.trim();
    if (pagePatch.insight?.trim()) page.insight = pagePatch.insight.trim();
    const node = graph.nodes[pageId];
    if (node && pagePatch.choices?.length) {
      for (let i = 0; i < Math.min(node.options.length, pagePatch.choices.length); i++) {
        const rewritten = pagePatch.choices[i]?.trim();
        if (!rewritten) continue;
        node.options[i].label = rewritten.replace(new RegExp(`^${node.options[i].id}\\s*[:：]\\s*`), "");
      }
    }
  }
  for (const [endingId, endingPatch] of Object.entries(patch.endings ?? {})) {
    const ending = graph.endings[endingId];
    if (!ending) continue;
    if (endingPatch.text?.trim()) ending.condition_summary = endingPatch.text.trim();
  }
}

function variantTargets(graph: LogicGraphDocument): Array<{ page: LogicPage; triggers: LogicVariantTrigger[] }> {
  return Object.values(graph.pages)
    .filter((page) => page.variant_triggers?.length && page.role !== "warning")
    .map((page) => ({ page, triggers: page.variant_triggers ?? [] }));
}

async function generateVariants(graph: LogicGraphDocument): Promise<Record<string, VariantPatch["variants"][string]>> {
  const output: Record<string, VariantPatch["variants"][string]> = {};
  const targets = variantTargets(graph);
  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const response = await chatJson<VariantPatch>(`07_variants_${Math.floor(i / 4) + 1}`, [
    {
      role: "system",
      content:
          `You split ${proseLanguageName()} page prose into explicit variable-band variants. Return strict JSON only. This is not semantic routing.`,
      },
      {
        role: "user",
        content: `Create explicit text variants for these pages.

Rules:
- Conditions must use only variable ids and one of: good, mid, bad, critical.
- Produce only meaningful variants, not every cartesian product.
- For each page, include 2-4 variants.
- The base page already exists; variants should be visibly different when the condition matters.
${variantLanguageRule()}
- Do not mention implementation terms.

Variable bands:
good 76-100, mid 46-75, bad 16-45, critical 0-15

Variables:
${compact(allVariables(graph).map(({ id, label, rationale }) => ({ id, label, rationale })))}

Pages:
${compact(batch.map(({ page, triggers }) => ({ id: page.id, role: page.role, text: page.text || page.placeholder, insight: page.insight, triggers })))}

Output:
{
  "variants": {
    "<page_id>": [
      {"variant_id":"<page_id>__money_bad","conditions":{"money":"bad"},"scene_text":"...","insight":"..."}
    ]
  },
  "summary": "..."
}`,
      },
    ]);
    for (const [pageId, variants] of Object.entries(response.variants ?? {})) {
      output[pageId] = variants;
    }
  }
  await writeJson("07_variable_variants.json", output);
  return output;
}

function compileWithVariants(
  graph: LogicGraphDocument,
  variants: Record<string, VariantPatch["variants"][string]>,
): StoryDocument & { logic_content_variants?: typeof variants; full_generation?: JsonObject } {
  const doc = compileLogicGraphToStoryDocument(graph, ACTIVE_RESEARCH, STORY_ID, OUTPUT_LANGUAGE) as StoryDocument & {
    logic_content_variants?: typeof variants;
    full_generation?: JsonObject;
  };
  doc.logic_content_variants = variants;
  doc.full_generation = {
    text_model: TEXT_MODEL,
    research_model: RESEARCH_MODEL,
    image_model: IMAGE_MODEL,
    output_language: OUTPUT_LANGUAGE,
    generated_at: new Date().toISOString(),
    stages: [
      ENABLE_LIVE_RESEARCH ? "live_or_fallback_research" : "manual_research",
      "research_adaptation",
      "node_by_node_option_planning",
      "supervisor_repair",
      "normal_delta_balance",
      "chain_by_chain_content",
      "variable_variant_split",
      "optional_image_generation",
      "programmatic_simulation",
      "exhaustive_validation",
    ],
  };
  return doc;
}

function inferProviderFromBaseURL(baseURL: string): Provider {
  return baseURL.includes("api.openai.com") ? "openai" : "relay";
}

function imageRuntimeConfig(): RuntimeConfig {
  const provider = inferProviderFromBaseURL(IMAGE_API_BASE_URL);
  return {
    provider,
    apiKey: IMAGE_API_KEY,
    baseURL: provider === "relay" ? IMAGE_API_BASE_URL : undefined,
    models: {
      search: RESEARCH_MODEL,
      design: TEXT_MODEL,
      image: IMAGE_MODEL,
    },
    services: {
      image: {
        provider,
        apiKey: IMAGE_API_KEY,
        baseURL: provider === "relay" ? IMAGE_API_BASE_URL : undefined,
        model: IMAGE_MODEL,
      },
    },
    features: {
      enableLiveSearch: ENABLE_LIVE_RESEARCH,
      enableImageGeneration: ENABLE_IMAGE_GENERATION,
      maxImagesPerStory: FULL_MAX_IMAGES,
    },
  };
}

function imagePromptFromScene(id: string, sceneText: string): string {
  const snippet = sceneText.replace(/\s+/g, " ").slice(0, 260);
  return `Tokyo international computer science master's student decision scene, page ${id}, inspired by this story moment: ${snippet}`;
}

function markImageAnchors(doc: StoryDocument): void {
  const nodeEntries = Object.entries(doc.nodes).filter(([, node]) => node.logic_page_role === "node");
  for (const [id, node] of nodeEntries) {
    node.has_image = true;
    node.image_prompt = imagePromptFromScene(id, node.scene_text);
  }
  for (const [id, ending] of Object.entries(doc.endings)) {
    if (id.includes("_critical")) continue;
    ending.has_image = true;
    ending.image_prompt = imagePromptFromScene(id, ending.scene_text);
  }
}

async function maybeGenerateImages<T extends StoryDocument>(doc: T): Promise<T> {
  if (!ENABLE_IMAGE_GENERATION) {
    await appendLog("[images] generation disabled");
    return doc;
  }
  if (!IMAGE_API_KEY) {
    await appendLog("[images] no image API key; skipping image generation");
    return doc;
  }

  markImageAnchors(doc);
  await appendLog(`[api:08_images] started model=${IMAGE_MODEL} max=${FULL_MAX_IMAGES}`);
  try {
    const withImages = (await runArtistAgent(doc, imageRuntimeConfig())) as T;
    const generatedCount = [
      ...Object.values(withImages.nodes),
      ...Object.values(withImages.endings),
    ].filter((node) => typeof node.image_url === "string" && node.image_url.trim()).length;
    await writeJson("08_images_story.json", withImages);
    await appendLog(`[api:08_images] completed image_url_count=${generatedCount}`);
    return withImages;
  } catch (error) {
    await writeJson("08_images_error.json", { error: error instanceof Error ? error.message : String(error) });
    await appendLog(`[api:08_images] failed: ${error instanceof Error ? error.message : String(error)}`);
    return doc;
  }
}

function logicBand(value: number): LogicVariableBand {
  if (value <= 15) return "critical";
  if (value <= 45) return "bad";
  if (value <= 75) return "mid";
  return "good";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function simulate(doc: StoryDocument, strategy: "normal" | "positive" | "negative" | "mixed"): SimulationResult {
  const variables = doc.logic?.variables ?? [];
  const state: Record<string, number> = Object.fromEntries(variables.map((variable) => [variable.id, variable.initial]));
  const warningsSeen: Record<string, boolean> = {};
  const warnings: string[] = [];
  let current = doc.logic?.start_node_id ?? Object.keys(doc.nodes)[0];
  let resultReturn: string | null = null;
  let warningReturn: string | null = null;

  for (let step = 0; step < 120; step++) {
    if (doc.endings[current]) return { ok: true, ending: current, steps: step, warnings, state };
    const node = doc.nodes[current];
    if (!node) return { ok: false, reason: `missing ${current}`, steps: step, warnings, state };
    if (doc.logic && node.choices[0]?.next_node === doc.logic.result_return_sentinel) {
      current = resultReturn ?? doc.logic.start_node_id;
      resultReturn = null;
      continue;
    }
    if (doc.logic && node.choices[0]?.next_node === doc.logic.warning_return_sentinel) {
      current = warningReturn ?? doc.logic.start_node_id;
      warningReturn = null;
      continue;
    }
    const index = strategy === "positive" ? 1 : strategy === "negative" ? 2 : strategy === "mixed" ? step % 3 : 0;
    const choice = node.choices[index] ?? node.choices[0];
    if (!choice) return { ok: false, reason: `no choice at ${current}`, steps: step, warnings, state };
    const previous = { ...state };
    for (const [key, delta] of Object.entries(choice.logic_delta ?? {})) state[key] = clamp((state[key] ?? 70) + delta);
    if (choice.logic_planned_next_node) resultReturn = choice.logic_planned_next_node;
    const critical = variables.find((variable) => logicBand(state[variable.id] ?? variable.initial) === "critical");
    if (critical) {
      current = critical.failure_page_id;
      continue;
    }
    const bad = variables.find((variable) => {
      if (warningsSeen[variable.id]) return false;
      return logicBand(state[variable.id] ?? variable.initial) === "bad" && logicBand(previous[variable.id] ?? variable.initial) !== "critical";
    });
    if (bad) {
      warningsSeen[bad.id] = true;
      warnings.push(bad.id);
      warningReturn = choice.next_node;
      current = bad.warning_page_id;
      continue;
    }
    current = choice.next_node;
  }
  return { ok: false, reason: "step limit", steps: 120, warnings, state };
}

function rebalanceNormalChoiceDeltas(graph: LogicGraphDocument): string[] {
  const notes: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    const normal = node.options.find((option) => option.kind === "normal");
    if (!normal) continue;
    for (const [variableId, value] of Object.entries(normal.delta)) {
      const floor = variableId === "money" ? -15 : -3;
      if (value < floor) {
        normal.delta[variableId] = floor;
        notes.push(`${normal.id}.${variableId}: ${value} -> ${floor}`);
      }
    }
  }
  return notes;
}

function simulateAllPaths(doc: StoryDocument): ExhaustiveSimulationResult {
  const logic = doc.logic;
  const result: ExhaustiveSimulationResult = {
    terminalPaths: 0,
    naturalEndings: 0,
    failureEndings: 0,
    maxDepth: 0,
    badCount: 0,
    badExamples: [],
    endingCounts: {},
  };
  if (!logic) {
    result.badCount = 1;
    result.badExamples.push("Story has no post-offer logic runtime.");
    return result;
  }

  const variables = logic.variables;
  const initialValues: Record<string, number> = Object.fromEntries(variables.map((variable) => [variable.id, variable.initial]));

  function addBad(message: string): void {
    result.badCount += 1;
    if (result.badExamples.length < 20) result.badExamples.push(message);
  }

  function applyDelta(values: Record<string, number>, delta?: Record<string, number>): Record<string, number> {
    const next = { ...values };
    for (const [key, change] of Object.entries(delta ?? {})) {
      next[key] = clamp((next[key] ?? 70) + change);
    }
    return next;
  }

  function walk(state: {
    current: string;
    values: Record<string, number>;
    warningsSeen: Record<string, boolean>;
    resultReturn: string | null;
    warningReturn: string | null;
  }, depth: number): void {
    result.maxDepth = Math.max(result.maxDepth, depth);
    if (depth > 140) {
      addBad(`Depth limit exceeded at ${state.current}`);
      return;
    }

    const ending = doc.endings[state.current];
    if (ending) {
      result.terminalPaths += 1;
      result.endingCounts[state.current] = (result.endingCounts[state.current] ?? 0) + 1;
      if (ending.logic_page_role === "failure") result.failureEndings += 1;
      else result.naturalEndings += 1;
      return;
    }

    const node = doc.nodes[state.current];
    if (!node) {
      addBad(`Missing page ${state.current}`);
      return;
    }

    if (node.logic_page_role === "warning") {
      if (!state.warningReturn) addBad(`Warning page ${state.current} had no stored return page.`);
      walk({ ...state, current: state.warningReturn ?? logic.start_node_id, warningReturn: null }, depth + 1);
      return;
    }

    if (node.logic_page_role === "result") {
      if (!state.resultReturn) addBad(`Result page ${state.current} had no stored planned return.`);
      walk({ ...state, current: state.resultReturn ?? logic.start_node_id, resultReturn: null }, depth + 1);
      return;
    }

    if (node.logic_page_role === "node" && node.choices.length !== 3) {
      addBad(`Playable node ${state.current} has ${node.choices.length} choices.`);
      return;
    }

    for (const choice of node.choices) {
      const nextValues = applyDelta(state.values, choice.logic_delta);
      const resultReturn = choice.logic_planned_next_node ?? state.resultReturn;
      const critical = variables.find((variable) => logicBand(nextValues[variable.id] ?? variable.initial) === "critical");
      if (critical) {
        walk({ ...state, values: nextValues, resultReturn, warningReturn: null, current: critical.failure_page_id }, depth + 1);
        continue;
      }

      const badVariable = variables.find((variable) => {
        if (state.warningsSeen[variable.id]) return false;
        return logicBand(nextValues[variable.id] ?? variable.initial) === "bad";
      });
      if (badVariable) {
        walk(
          {
            ...state,
            values: nextValues,
            warningsSeen: { ...state.warningsSeen, [badVariable.id]: true },
            resultReturn,
            warningReturn: choice.next_node,
            current: badVariable.warning_page_id,
          },
          depth + 1,
        );
        continue;
      }

      walk({ ...state, values: nextValues, resultReturn, warningReturn: null, current: choice.next_node }, depth + 1);
    }
  }

  walk({ current: logic.start_node_id, values: initialValues, warningsSeen: {}, resultReturn: null, warningReturn: null }, 0);
  return result;
}

function validateCompiledStory(
  doc: StoryDocument & { logic_content_variants?: Record<string, VariantPatch["variants"][string]> },
  sampleSimulation: Record<"normal" | "positive" | "negative" | "mixed", SimulationResult>,
  exhaustiveSimulation: ExhaustiveSimulationResult,
  balanceNotes: string[],
): ValidationReport {
  const issues: string[] = [];
  const logic = doc.logic;
  const allIds = new Set([
    ...Object.keys(doc.nodes),
    ...Object.keys(doc.endings),
    logic?.warning_return_sentinel,
    logic?.result_return_sentinel,
  ].filter(Boolean) as string[]);
  let playableNodes = 0;
  let resultPages = 0;
  let warningPages = 0;
  let allPlayableNodesHaveThreeOptions = true;
  let allChoicesHaveExplicitIds = true;

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.logic_page_role === "node") {
      playableNodes += 1;
      if (node.choices.length !== 3) {
        allPlayableNodesHaveThreeOptions = false;
        issues.push(`${nodeId} has ${node.choices.length} choices.`);
      }
    }
    if (node.logic_page_role === "result") resultPages += 1;
    if (node.logic_page_role === "warning") warningPages += 1;
    for (const [index, choice] of node.choices.entries()) {
      if (!choice.logic_choice_id?.trim()) {
        allChoicesHaveExplicitIds = false;
        issues.push(`${nodeId} choice ${index + 1} is missing logic_choice_id.`);
      }
      if (!allIds.has(choice.next_node)) issues.push(`${nodeId} choice ${choice.logic_choice_id ?? index + 1} points to missing ${choice.next_node}.`);
      if (choice.logic_planned_next_node && !allIds.has(choice.logic_planned_next_node)) {
        issues.push(`${nodeId} choice ${choice.logic_choice_id ?? index + 1} plans missing ${choice.logic_planned_next_node}.`);
      }
    }
  }

  let variableWarningsAndFailuresPresent = true;
  for (const variable of logic?.variables ?? []) {
    if (!doc.nodes[variable.warning_page_id]) {
      variableWarningsAndFailuresPresent = false;
      issues.push(`${variable.id} is missing warning page ${variable.warning_page_id}.`);
    }
    if (!doc.endings[variable.failure_page_id]) {
      variableWarningsAndFailuresPresent = false;
      issues.push(`${variable.id} is missing failure ending ${variable.failure_page_id}.`);
    }
  }

  const variantPages = Object.keys(doc.logic_content_variants ?? {}).length;
  let variants = 0;
  let comboVariants = 0;
  for (const pageVariants of Object.values(doc.logic_content_variants ?? {})) {
    variants += pageVariants.length;
    comboVariants += pageVariants.filter((variant) => Object.keys(variant.conditions ?? {}).length > 1).length;
  }

  const normalEnding = sampleSimulation.normal.ending ? doc.endings[sampleSimulation.normal.ending] : undefined;
  const normalStrategyReachesNaturalEnding = Boolean(sampleSimulation.normal.ok && normalEnding && normalEnding.logic_page_role !== "failure");
  if (!normalStrategyReachesNaturalEnding) {
    issues.push(`Normal strategy ended at ${sampleSimulation.normal.ending ?? sampleSimulation.normal.reason ?? "unknown"}.`);
  }
  if (exhaustiveSimulation.badCount > 0) {
    issues.push(`Exhaustive simulation found ${exhaustiveSimulation.badCount} routing issue(s).`);
  }

  return {
    storyId: doc.story_id,
    counts: {
      nodes: Object.keys(doc.nodes).length,
      endings: Object.keys(doc.endings).length,
      playableNodes,
      resultPages,
      warningPages,
      variables: logic?.variables.length ?? 0,
      variantPages,
      variants,
      comboVariants,
    },
    requirements: {
      allPlayableNodesHaveThreeOptions,
      allChoicesHaveExplicitIds,
      variableWarningsAndFailuresPresent,
      allEnumeratedPathsTerminate: exhaustiveSimulation.badCount === 0 && exhaustiveSimulation.terminalPaths > 0,
      normalStrategyReachesNaturalEnding,
    },
    issues,
    balanceNotes,
    sampleSimulation,
    exhaustiveSimulation,
  };
}

async function main(): Promise<void> {
  await ensureDirs();
  await appendLog(`[start] story_id=${STORY_ID} output_language=${OUTPUT_LANGUAGE} text_model=${TEXT_MODEL} text_baseURL=${TEXT_API_BASE_URL}`);
  await writeJson("00_meta.json", {
    storyId: STORY_ID,
    textModel: TEXT_MODEL,
    textBaseURL: TEXT_API_BASE_URL,
    researchModel: RESEARCH_MODEL,
    researchBaseURL: RESEARCH_API_BASE_URL,
    imageModel: IMAGE_MODEL,
    imageBaseURL: IMAGE_API_BASE_URL,
    outputLanguage: OUTPUT_LANGUAGE,
    startedAt: new Date().toISOString(),
    textApiKeyProvided: Boolean(TEXT_API_KEY),
    researchApiKeyProvided: Boolean(RESEARCH_API_KEY),
    imageApiKeyProvided: Boolean(IMAGE_API_KEY),
    liveResearchEnabled: ENABLE_LIVE_RESEARCH,
    imageGenerationEnabled: ENABLE_IMAGE_GENERATION,
  });

  ACTIVE_RESEARCH = await retrieveResearch();

  let graph = createInitialGraph();
  await writeJson("01_initial_graph.json", graph);
  await adaptResearch(graph);

  for (const nodeId of [...graph.main_node_order]) {
    await planNodeOptions(graph, nodeId);
  }
  const extraNodeIds = Object.keys(graph.nodes).filter((id) => !graph.main_node_order.includes(id) && graph.nodes[id].options.length === 0);
  for (const nodeId of extraNodeIds) {
    await planNodeOptions(graph, nodeId);
  }
  await writeJson("04_planned_graph_before_supervisor.json", graph);

  graph = await superviseGraph(graph);
  validateLogicGraph(graph);
  const balanceNotes = rebalanceNormalChoiceDeltas(graph);
  await appendLog(`[balance] adjusted ${balanceNotes.length} normal-choice deltas`);
  validateLogicGraph(graph);
  await writeJson("05_supervised_logic_graph.json", graph);
  await writeJson("05_balanced_logic_graph.json", graph);

  const priorSummaries: string[] = [];
  for (const nodeId of [...graph.main_node_order, ...Object.keys(graph.nodes).filter((id) => !graph.main_node_order.includes(id))]) {
    const summary = await fillNodeContent(graph, graph.nodes[nodeId], priorSummaries.slice(-10));
    priorSummaries.push(summary);
    await writeJson(`06_content_after_${nodeId}.json`, graph);
  }
  priorSummaries.push(await fillSystemContent(graph, priorSummaries.slice(-12)));
  await writeJson("06_content_complete_graph.json", graph);

  const variants = await generateVariants(graph);
  const doc = await maybeGenerateImages(compileWithVariants(graph, variants));
  const simulation = {
    normal: simulate(doc, "normal"),
    positive: simulate(doc, "positive"),
    negative: simulate(doc, "negative"),
    mixed: simulate(doc, "mixed"),
  };
  const exhaustiveSimulation = simulateAllPaths(doc);
  const validation = validateCompiledStory(doc, simulation, exhaustiveSimulation, balanceNotes);
  if (doc.full_generation) {
    doc.full_generation.balance_notes = balanceNotes;
    doc.full_generation.validation = validation as unknown as JsonObject;
  }
  await writeJson("08_simulation.json", { sample: simulation, exhaustive: exhaustiveSimulation });
  await writeJson("09_validation_report.json", validation);
  await fs.writeFile(path.join(STORIES_DIR, `${STORY_ID}_final.json`), JSON.stringify(doc, null, 2), "utf8");
  await writeJson("09_final_story.json", doc);
  await appendLog(`[done] story=${path.join(STORIES_DIR, `${STORY_ID}_final.json`)}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        storyId: STORY_ID,
        finalStoryPath: path.join(STORIES_DIR, `${STORY_ID}_final.json`),
        runDir: RUN_DIR,
        nodes: Object.keys(doc.nodes).length,
        playableNodes: Object.values(doc.nodes).filter((node) => node.logic_page_role === "node").length,
        endings: Object.keys(doc.endings).length,
        variants: Object.keys(variants).length,
        validation: validation.requirements,
        simulation,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  await ensureDirs().catch(() => undefined);
  await appendLog(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`).catch(() => undefined);
  console.error(error);
  process.exit(1);
});
