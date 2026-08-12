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
  PageAnnotation,
  Provider,
  ResearchReport,
  RuntimeConfig,
  StoryDocument,
  UserProfile,
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
      annotation?: Partial<PageAnnotation>;
    }
  >;
  endings?: Record<string, { text?: string; insight?: string; annotation?: Partial<PageAnnotation> }>;
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
    annotatedPages: number;
    evidenceReferences: number;
  };
  requirements: {
    allPlayableNodesHaveThreeOptions: boolean;
    allChoicesHaveExplicitIds: boolean;
    variableWarningsAndFailuresPresent: boolean;
    allEnumeratedPathsTerminate: boolean;
    normalStrategyReachesNaturalEnding: boolean;
    everyVisiblePageAnnotated: boolean;
    allEvidenceReferencesValid: boolean;
    allTermsExplainedAndCited: boolean;
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

const DEFAULT_PROFILE: UserProfile = {
  country: "Japan",
  city: "Tokyo",
  school: "The University of Tokyo",
  department: "Graduate School of Information Science and Technology",
  program: "Computer Science master's track",
  major: "Computer Science",
  grade: "Taught Master",
};

function requestedProfileFromEnv(): UserProfile {
  const raw = process.env.FULL_PROFILE_JSON;
  if (!raw) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    const text = (value: unknown, fallback: string): string =>
      typeof value === "string" && value.trim() ? value.trim() : fallback;
    return {
      country: text(parsed.country, DEFAULT_PROFILE.country),
      city: text(parsed.city, DEFAULT_PROFILE.city),
      school: text(parsed.school, ""),
      department: text(parsed.department, ""),
      program: text(parsed.program, ""),
      major: text(parsed.major, DEFAULT_PROFILE.major),
      grade: text(parsed.grade, DEFAULT_PROFILE.grade),
      semesters: typeof parsed.semesters === "number" ? parsed.semesters : undefined,
    };
  } catch {
    throw new Error("FULL_PROFILE_JSON is not valid JSON.");
  }
}

const REQUESTED_PROFILE = requestedProfileFromEnv();

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
const STORY_ID = process.env.FULL_DEMO_STORY_ID || `study_abroad_full_${Date.now()}`;
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
    affects_nodes: ["N02_deposit_tuition", "N03_student_visa", "N05_arrival_registration", "N09_disruption_deadline", "N11_graduation_status"],
    warning_page_id: "W_time_bad",
    failure_page_id: "E_time_critical",
  },
  {
    id: "visa",
    label: "Visa",
    initial: 74,
    is_base: true,
    rationale: "Immigration readiness decides whether the student can enter, work part-time, remain enrolled, and change status after graduation.",
    affects_nodes: ["N03_student_visa", "N05_arrival_registration", "N07_part_time_work", "N11_graduation_status", "N12_final_choice"],
    warning_page_id: "W_visa_bad",
    failure_page_id: "E_visa_critical",
  },
  {
    id: "housing",
    label: "Housing",
    initial: 58,
    is_base: true,
    rationale: "Housing security controls commute fatigue, upfront cost, address registration, and whether the player can sustain the first semester.",
    affects_nodes: ["N04_housing_commute", "N05_arrival_registration", "N06_program_study", "N09_disruption_deadline"],
    warning_page_id: "W_housing_bad",
    failure_page_id: "E_housing_critical",
  },
  {
    id: "school",
    label: "School",
    initial: 72,
    is_base: true,
    rationale: "Academic standing determines whether coursework, lab progress, graduation, and post-study opportunities remain viable.",
    affects_nodes: ["N06_program_study", "N08_language_support", "N09_disruption_deadline", "N10_career_internship", "N12_final_choice"],
    warning_page_id: "W_school_bad",
    failure_page_id: "E_school_critical",
  },
  {
    id: "wellbeing",
    label: "Wellbeing",
    initial: 70,
    is_base: true,
    rationale: "Physical and emotional resilience decides whether pressure turns into a recoverable warning or a forced pause.",
    affects_nodes: ["N04_housing_commute", "N06_program_study", "N08_language_support", "N09_disruption_deadline", "N12_final_choice"],
    warning_page_id: "W_wellbeing_bad",
    failure_page_id: "E_wellbeing_critical",
  },
];

const SUPPLEMENTAL_VARIABLES: LogicVariableDefinition[] = [
  {
    id: "local_language",
    label: "Local language",
    initial: 48,
    is_base: false,
    rationale: "Local-language ability changes housing paperwork, public-service tasks, part-time work options, and local job interviews.",
    affects_nodes: ["N05_arrival_registration", "N07_part_time_work", "N08_language_support", "N10_career_internship"],
    warning_page_id: "W_local_language_bad",
    failure_page_id: "E_local_language_critical",
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
    id: "academic_network",
    label: "Academic network",
    initial: 55,
    is_base: false,
    rationale: "Relationships with instructors, supervisors, and peers affect feedback, references, opportunities, and resilience during milestone pressure.",
    affects_nodes: ["N06_program_study", "N09_disruption_deadline", "N10_career_internship", "N12_final_choice"],
    warning_page_id: "W_academic_network_bad",
    failure_page_id: "E_academic_network_critical",
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
    facts_used: ["University fees, proof-of-funds rules, and destination living costs make initial cash planning a high-impact node."],
    variant_triggers: [{ variables: ["money"], reason: "The same tuition deadline feels different when cash is good, mid, or bad." }],
  },
  {
    id: "N03_student_visa",
    title: "Student visa and entry-document timing",
    stage: "offer_prearrival",
    is_special: true,
    why_special: "Visa timing can hard-stop entry or force deferral.",
    facts_used: ["Student-visa and entry-document requirements vary by destination and require careful deadline planning."],
    variant_triggers: [{ variables: ["visa", "time"], reason: "Visa text changes when both paperwork readiness and time are under pressure." }],
  },
  {
    id: "N04_housing_commute",
    title: "Housing, address, and commute",
    stage: "offer_prearrival",
    is_special: true,
    why_special: "Housing changes money, commute time, address registration, and wellbeing at once.",
    facts_used: ["Rent, deposits, contract rules, and commute time are major student-life constraints."],
    variant_triggers: [{ variables: ["money", "housing"], reason: "Housing options split strongly by money and housing security." }],
  },
  {
    id: "N05_arrival_registration",
    title: "Arrival week and local registration",
    stage: "study",
    is_special: false,
    facts_used: ["International students must handle arrival logistics, address registration, banking, and orientation."],
    variant_triggers: [{ variables: ["local_language", "time"], reason: "Bureaucracy feels different with limited local-language ability and little time." }],
  },
  {
    id: "N06_program_study",
    title: "Program culture and academic progression",
    stage: "study",
    is_special: true,
    why_special: "Advisor relationship and course choices can change graduation and career endings.",
    facts_used: ["Academic life depends on the program's teaching, assessment, supervision, progression, and workload structure."],
    variant_triggers: [{ variables: ["school", "wellbeing", "academic_network"], reason: "Academic pressure combines performance, wellbeing, and access to feedback or support." }],
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
    facts_used: ["International-student support can reduce risk, but daily life may still create language and isolation pressure."],
    variant_triggers: [{ variables: ["local_language", "wellbeing"], reason: "Social support text depends on language ability and emotional resilience." }],
  },
  {
    id: "N09_disruption_deadline",
    title: "Local disruption and academic milestone",
    stage: "study",
    is_special: true,
    why_special: "A compressed academic milestone can trigger school or wellbeing collapse.",
    facts_used: ["Local weather, transport, health, or civic disruptions can interrupt routines while academic deadlines continue."],
    variant_triggers: [{ variables: ["school", "wellbeing", "time"], reason: "The same deadline can be a manageable crunch or a collapse depending on three variables." }],
  },
  {
    id: "N10_career_internship",
    title: "Internship, networking, and local job search",
    stage: "post_graduation",
    is_special: true,
    why_special: "Career choices decide local employment, return-home, or third-country endings.",
    facts_used: ["Career prospects depend on the local market, language expectations, networks, and work authorization."],
    variant_triggers: [{ variables: ["career", "local_language", "academic_network"], reason: "Job-search text changes with career readiness, local language, and references." }],
  },
  {
    id: "N11_graduation_status",
    title: "Graduation and status-change window",
    stage: "post_graduation",
    is_special: true,
    why_special: "Status timing after graduation can decide whether the player can remain in the destination country.",
    facts_used: ["Post-graduation status change requires time, employer readiness, and immigration paperwork."],
    variant_triggers: [{ variables: ["visa", "time", "career"], reason: "Status-change urgency is a three-variable combination." }],
  },
  {
    id: "N12_final_choice",
    title: "Final life direction",
    stage: "post_graduation",
    is_special: true,
    why_special: "This node selects the final non-failure ending from accumulated state.",
    facts_used: ["The final page should resolve whether the destination becomes home, a launchpad, or a difficult but useful chapter."],
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
      node_adaptations: ["Add academic_network as a supplemental variable.", "Mark the study and disruption nodes as special."],
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
      node_adaptations: ["Use career and local_language variables.", "Mark N10, N11, and N12 as special."],
    },
  ],
};

function fallbackResearchForProfile(profile: UserProfile): ResearchReport & { research_batches?: JsonObject[] } {
  const isBundledTokyoProfile =
    profile.country === DEFAULT_PROFILE.country &&
    profile.city === DEFAULT_PROFILE.city &&
    profile.school === DEFAULT_PROFILE.school &&
    profile.major === DEFAULT_PROFILE.major;
  if (isBundledTokyoProfile) return MANUAL_RESEARCH;

  const destination = [profile.school, profile.city, profile.country].filter(Boolean).join(", ");
  return {
    ...MANUAL_RESEARCH,
    location: { country: profile.country, city: profile.city },
    major: profile.major,
    grade: profile.grade,
    profile: { ...profile },
    report: {
      cost_of_living: `Verify tuition, rent, deposits, transport, insurance, and day-to-day costs for ${destination}.`,
      academic: `Verify the official curriculum, progression rules, assessment pattern, and supervision structure for ${profile.program || profile.department || profile.major}.`,
      visa: `Verify the student-visa, entry, enrollment-maintenance, work, and post-study status rules for ${profile.country}.`,
      culture_shock: `Daily administration, housing rules, communication norms, and academic expectations may differ from the student's home context.`,
      community: `Verify the university's international office, accessibility, counseling, student groups, and local support services.`,
      career: `Verify local internships, graduate employment routes, language expectations, recruitment timing, and work authorization.`,
      safety: `Verify official local safety, health, emergency, and discrimination-support guidance.`,
      climate: `Verify seasonal weather, transport reliability, and other local disruptions that can affect study routines.`,
      part_time_work: `Verify whether student work is permitted, its hour limits, tax obligations, and likely effect on study time.`,
    },
    gameplay_signals: {
      health: ["Housing, commute, workload, healthcare access, and climate can affect physical and emotional energy."],
      mood: ["Language, belonging, academic feedback, and access to support can change confidence and isolation."],
      money: ["Tuition timing, move-in costs, rent, insurance, transport, and work permission shape the financial buffer."],
      city_major_specific_challenges: [
        `Confirm the real costs and deadlines for ${destination}.`,
        `Understand the academic milestones for ${profile.major}.`,
        `Plan entry, enrollment, housing, and post-study status before deadlines close.`,
      ],
    },
    source_coverage: {
      program_official: false,
      department_official: false,
      international_office: false,
      tuition: false,
      housing: false,
      career: false,
      student_forum: false,
    },
    program_profile: {
      official_name: profile.program || profile.department || profile.major,
      degree_type: profile.grade,
      department: profile.department || profile.major,
      duration: profile.semesters ? `${profile.semesters} semesters selected by the user` : "Verify on the official program page",
      delivery_mode: "Verify on the official program page",
      visa_eligible_notes: `Verify current student-status eligibility for ${profile.country}.`,
      curriculum: [],
      milestones: ["Offer acceptance", "Entry documents", "Arrival and registration", "Academic progression", "Graduation and post-study decision"],
      funding: ["Tuition and fees", "Housing and move-in cost", "Scholarships, savings, or permitted work"],
    },
    student_life_profile: {
      housing: `Verify housing options, contract requirements, deposits, commute, and registration rules in ${profile.city}.`,
      commute: `Verify the transport network and realistic campus commute for ${profile.school || profile.city}.`,
      campus_support: "Verify the official international-student and wellbeing services.",
      community: "Verify relevant student societies, peer networks, and community support.",
      safety: "Verify official local safety and emergency guidance.",
      climate: "Verify seasonal conditions and disruption risks.",
    },
    career_profile: {
      local_industry: `Verify the local market for ${profile.major} graduates in ${profile.city}.`,
      internship: "Verify internship eligibility, timing, and university career support.",
      work_authorization: `Verify student and post-study work authorization in ${profile.country}.`,
      language_or_networking_requirements: "Verify employer language expectations and common recruitment channels.",
    },
    sources: [],
    gaps: [
      `Live research was unavailable, so no institution-specific claims for ${destination} were treated as verified.`,
    ],
    research_batches: undefined,
  };
}

const RAW_PROFILE_RESEARCH_FALLBACK = fallbackResearchForProfile(REQUESTED_PROFILE);
const PROFILE_RESEARCH_FALLBACK: ResearchReport & { research_batches?: JsonObject[] } = {
  ...RAW_PROFILE_RESEARCH_FALLBACK,
  sources: (RAW_PROFILE_RESEARCH_FALLBACK.sources ?? []).map((source, index) => ({
    ...source,
    evidence_id: `S${String(index + 1).padStart(2, "0")}`,
  })),
};
let ACTIVE_RESEARCH: ResearchReport & { research_batches?: JsonObject[] } = PROFILE_RESEARCH_FALLBACK;

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

async function readRunJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(RUN_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

async function readLatestMatchingRunJson<T>(pattern: RegExp): Promise<{ name: string; value: T } | null> {
  try {
    const candidates = (await fs.readdir(RUN_DIR))
      .filter((name) => pattern.test(name))
      .map(async (name) => ({ name, stat: await fs.stat(path.join(RUN_DIR, name)) }));
    const resolved = await Promise.all(candidates);
    resolved.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const candidate of resolved) {
      const value = await readRunJson<T>(candidate.name);
      if (value) return { name: candidate.name, value };
    }
  } catch {
    // A missing or unreadable checkpoint simply means this run starts from an earlier stage.
  }
  return null;
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

type ResearchSource = NonNullable<ResearchReport["sources"]>[number];

const SOURCE_TYPES = new Set<ResearchSource["source_type"]>([
  "official_registry",
  "program_official",
  "department",
  "catalog",
  "handbook",
  "international_office",
  "tuition",
  "housing",
  "career",
  "forum",
  "third_party",
  "reference",
]);
const SOURCE_CONFIDENCE = new Set<ResearchSource["confidence"]>(["official_registry", "high", "medium", "low"]);

function normalizedInstitutionAliases(name: string): string[] {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const stopWords = new Set([
    "the", "of", "and", "university", "universitat", "universite", "college", "school", "institute",
    "technical", "technische", "technology", "national", "polytechnic",
  ]);
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  const significant = words.filter((word) => word.length >= 3 && !stopWords.has(word));
  const acronym = (name.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !stopWords.has(word.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))
    .map((word) => word[0])
    .join("")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return [...new Set([...significant, ...(acronym.length >= 2 ? [acronym] : [])])];
}

function hostnameMatchesTargetInstitution(hostname: string): boolean {
  const compactHostname = hostname.replace(/[^a-z0-9]/g, "");
  const aliases = normalizedInstitutionAliases(REQUESTED_PROFILE.school || "");
  return aliases.length === 0 || aliases.some((alias) => compactHostname.includes(alias.replace(/[^a-z0-9]/g, "")));
}

function normalizeResearchSources(value: unknown): ResearchSource[] {
  if (!Array.isArray(value)) return [];
  const seenUrls = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<ResearchSource>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!title || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const rawSourceType = typeof candidate.source_type === "string" ? candidate.source_type : "";
    let sourceType = SOURCE_TYPES.has(rawSourceType as ResearchSource["source_type"])
      ? (rawSourceType as ResearchSource["source_type"])
      : "reference";
    let confidence = SOURCE_CONFIDENCE.has(candidate.confidence as ResearchSource["confidence"])
      ? (candidate.confidence as ResearchSource["confidence"])
      : "low";
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const titleLower = title.toLowerCase();
    if (["government", "official_government", "public_authority"].includes(rawSourceType)) {
      sourceType = "official_registry";
      confidence = "official_registry";
    }
    if (hostname.endsWith("wikipedia.org") || titleLower.includes("wikipedia")) {
      sourceType = "reference";
      confidence = confidence === "low" ? "low" : "medium";
    } else if (
      ["shiksha.com", "mastersportal.com", "studyportals.com", "topuniversities.com", "educations.com", "atlasmunich.de"].some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    ) {
      sourceType = "third_party";
      confidence = "low";
    } else if (sourceType === "program_official" && !hostnameMatchesTargetInstitution(hostname)) {
      // A neighboring university or local institution can still be useful for
      // city context, but it is not an official source for the selected program.
      sourceType = "reference";
      confidence = confidence === "low" ? "low" : "medium";
    }
    const targetMajor = REQUESTED_PROFILE.major.toLowerCase();
    const unrelatedDegree = ["civil engineering", "mechanical engineering", "architecture", "medicine"].find(
      (degree) => titleLower.includes(degree) && !targetMajor.includes(degree),
    );
    const otherCityAuthority = /\bstadt\s+[a-zà-ž-]+/i.test(title) && !titleLower.includes(REQUESTED_PROFILE.city.toLowerCase());
    if (unrelatedDegree || otherCityAuthority) continue;
    sources.push({
      evidence_id: `S${String(sources.length + 1).padStart(2, "0")}`,
      title,
      url,
      source_type: sourceType,
      confidence,
      used_for: Array.isArray(candidate.used_for)
        ? candidate.used_for.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
        : [],
    });
  }
  return sources;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function factText(value: unknown, max = 1_500): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "";
  const text = JSON.stringify(value).replace(/[{}\[\]"]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function collectFactStrings(value: unknown, prefix = ""): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = factText(value);
    return text ? [`${prefix ? `${prefix}: ` : ""}${text}`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectFactStrings(item, prefix));
  return Object.entries(objectRecord(value)).flatMap(([key, item]) =>
    collectFactStrings(item, key.replace(/_/g, " ")),
  );
}

function findFactByLabel(value: unknown, label: string): unknown {
  const wanted = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const [key, item] of Object.entries(objectRecord(value))) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized)) return item;
    const nested = findFactByLabel(item, label);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function expandBatchSourceClaims(sources: ResearchReport["sources"], facts: unknown): ResearchReport["sources"] {
  return (sources ?? []).map((source) => ({
    ...source,
    used_for: (source.used_for ?? []).map((claim) => {
      const matched = findFactByLabel(facts, claim);
      const detail = factText(matched, 500);
      return detail ? `${claim}: ${detail}` : claim;
    }),
  }));
}

function standardizeResearchBatch(id: string, parsed: Partial<ResearchReport>): Partial<ResearchReport> {
  const facts = objectRecord(parsed.report);
  const base: Partial<ResearchReport> = {
    sources: expandBatchSourceClaims(parsed.sources, facts),
    source_coverage: parsed.source_coverage,
    gameplay_signals: parsed.gameplay_signals,
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((gap): gap is string => typeof gap === "string" && Boolean(gap.trim())) : [],
  };
  if (id === "program") {
    const curriculum = objectRecord(facts.curriculum_structure);
    return {
      ...base,
      report: { academic: factText(facts, 2_400) } as ResearchReport["report"],
      program_profile: {
        official_name: REQUESTED_PROFILE.program || REQUESTED_PROFILE.major,
        degree_type: REQUESTED_PROFILE.grade,
        department: REQUESTED_PROFILE.department || REQUESTED_PROFILE.major,
        duration: factText(facts.degree_duration),
        delivery_mode: factText(facts.language_of_instruction)
          ? `Language of instruction: ${factText(facts.language_of_instruction)}`
          : undefined,
        curriculum: [...collectFactStrings(curriculum.core_areas), ...collectFactStrings(curriculum.modules)].slice(0, 30),
        milestones: collectFactStrings(facts.compulsory_milestones).slice(0, 20),
        admissions: collectFactStrings(facts.admission_requirements).slice(0, 20),
        deadlines: collectFactStrings(facts.application_periods).slice(0, 12),
        funding: collectFactStrings(facts.tuition_fees).slice(0, 12),
      },
    };
  }
  if (id === "immigration") {
    return {
      ...base,
      report: {
        visa: [
          factText(facts.entry_visa_vs_residence_permit),
          factText(facts.city_registration),
          factText(facts.proof_of_funds_or_insurance_requirements),
          factText(facts.residence_permit_renewal),
        ].filter(Boolean).join(" "),
        part_time_work: factText(facts.student_work_limits),
      } as ResearchReport["report"],
      career_profile: {
        work_authorization: factText(facts.post_graduation_job_search_or_status_change_rules),
      },
    };
  }
  return {
    ...base,
    report: {
      cost_of_living: [factText(facts.cost), factText(facts.housing)].filter(Boolean).join(" "),
      culture_shock: factText(facts.language_support),
      community: factText(facts.student_wellbeing),
      career: [factText(facts.internships), factText(facts.career_services)].filter(Boolean).join(" "),
      safety: factText(facts.safety_disruptions),
      climate: factText(facts.safety_disruptions),
    } as ResearchReport["report"],
    student_life_profile: {
      housing: factText(facts.housing),
      commute: factText(facts.commuting),
      campus_support: factText(facts.student_wellbeing),
      community: factText(facts.language_support),
      safety: factText(facts.safety_disruptions),
      climate: factText(facts.safety_disruptions),
    },
    career_profile: {
      internship: factText(facts.internships),
      local_industry: factText(facts.career_services),
      language_or_networking_requirements: factText(facts.language_support),
    },
  };
}

function mergeResearchValue(target: unknown, source: unknown): unknown {
  if (source === undefined || source === null || source === "") return target;
  if (Array.isArray(source)) {
    const combined = [...(Array.isArray(target) ? target : []), ...source];
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (source && typeof source === "object") {
    const result: Record<string, unknown> = target && typeof target === "object" && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      result[key] = mergeResearchValue(result[key], value);
    }
    return result;
  }
  if (typeof source === "boolean" && typeof target === "boolean") return target || source;
  return source;
}

function mergeResearchReports(parts: Partial<ResearchReport>[]): ResearchReport & { research_batches?: JsonObject[] } {
  let merged: unknown = {};
  for (const part of parts) merged = mergeResearchValue(merged, part);
  const raw = merged as Partial<ResearchReport>;
  raw.mode = "live_search";
  raw.location = { country: REQUESTED_PROFILE.country, city: REQUESTED_PROFILE.city };
  raw.major = REQUESTED_PROFILE.major;
  raw.grade = REQUESTED_PROFILE.grade;
  raw.profile = {
    country: REQUESTED_PROFILE.country,
    city: REQUESTED_PROFILE.city,
    school: REQUESTED_PROFILE.school,
    department: REQUESTED_PROFILE.department,
    program: REQUESTED_PROFILE.program,
    major: REQUESTED_PROFILE.major,
    grade: REQUESTED_PROFILE.grade,
  };
  const report = normalizeResearchReport(raw);
  report.sources = normalizeResearchSources(parts.flatMap((part) => part.sources ?? []));
  report.gaps = [...new Set(parts.flatMap((part) => part.gaps ?? []).filter(Boolean))];
  report.research_batches = researchBatchesFromReport(report);
  return report;
}

function evidenceCatalog(): Array<Pick<ResearchSource, "evidence_id" | "title" | "url" | "source_type" | "confidence" | "used_for">> {
  return (ACTIVE_RESEARCH.sources ?? []).map(({ evidence_id, title, url, source_type, confidence, used_for }) => ({
    evidence_id,
    title,
    url,
    source_type,
    confidence,
    used_for,
  }));
}

function normalizeResearchReport(report: Partial<ResearchReport>): ResearchReport & { research_batches?: JsonObject[] } {
  const merged = {
    ...PROFILE_RESEARCH_FALLBACK,
    ...report,
    location: {
      ...PROFILE_RESEARCH_FALLBACK.location,
      ...(report.location ?? {}),
    },
    profile: {
      ...PROFILE_RESEARCH_FALLBACK.profile,
      ...(report.profile ?? {}),
    },
    report: {
      ...PROFILE_RESEARCH_FALLBACK.report,
      ...(report.report ?? {}),
    },
    gameplay_signals: {
      ...PROFILE_RESEARCH_FALLBACK.gameplay_signals,
      ...(report.gameplay_signals ?? {}),
    },
    sources: normalizeResearchSources(report.sources),
    research_batches: (report as { research_batches?: JsonObject[] }).research_batches,
  } as ResearchReport & { research_batches?: JsonObject[] };
  merged.research_batches = merged.research_batches?.length ? merged.research_batches : researchBatchesFromReport(merged);
  return merged;
}

async function retrieveResearch(): Promise<ResearchReport & { research_batches?: JsonObject[] }> {
  if (!ENABLE_LIVE_RESEARCH) {
    await appendLog("[research] live retrieval disabled; using the profile-aware fallback packet");
    await writeJson("00_research_report.json", PROFILE_RESEARCH_FALLBACK);
    return PROFILE_RESEARCH_FALLBACK;
  }
  if (!RESEARCH_API_KEY) {
    await appendLog("[research] no research API key; using the profile-aware fallback packet");
    await writeJson("00_research_report.json", PROFILE_RESEARCH_FALLBACK);
    return PROFILE_RESEARCH_FALLBACK;
  }

  const sharedRules = `
Profile:
${compact(REQUESTED_PROFILE, 4_000)}

Return one strict JSON partial ResearchReport. Omit fields you did not verify.
- Search the live web and prefer first-party institution, national/local government, and official student-service pages.
- A source may be marked official/high only when its hostname belongs to the institution or public authority that issued the rule.
- Wikipedia, rankings, commercial study portals, consultancies, and aggregators are never official sources. Use them only as low-confidence fallback and label them accurately.
- Every sources[].used_for item must be a short, precise factual claim directly supported by that exact URL, not a topic label.
- Do not copy one source's claims onto another source. Do not invent URLs, amounts, deadlines, course names, rules, or services.
- Record missing evidence in gaps instead of filling it with general knowledge.
- Include only fields relevant to this batch plus sources, source_coverage, gameplay_signals, and gaps.

Partial output shape:
{
  "report": {}, "program_profile": {}, "student_life_profile": {}, "career_profile": {}, "campus_life_profile": {},
  "source_coverage": {}, "gameplay_signals": {},
  "sources": [{"title":"...","url":"https://...","source_type":"program_official","confidence":"high","used_for":["precise supported claim"]}],
  "gaps": []
}`;
  const batches = [
    {
      id: "program",
      focus: `Research the exact university, department, and degree on official university domains only. Verify degree duration/ECTS, language, curriculum or specialization structure, compulsory milestones, examination or progression rules, tuition/semester fees, application or enrolment conditions, and named academic/support services. Prefer the exact program page, academic regulations, module catalog, fee page, and international office.`,
    },
    {
      id: "immigration",
      focus: `Research immigration and work rules from official national government, embassy/consulate, immigration authority, and the selected city's official authority. Verify entry visa versus residence permit, city registration, proof-of-funds or insurance requirements when officially stated, student work limits, residence-permit renewal, and post-graduation job-search or status-change rules.`,
    },
    {
      id: "life_career",
      focus: `Research housing, cost, commuting, student wellbeing, language support, safety/disruptions, internships, and career services. Prefer the university, official student-services organization, municipal/regional authority, and official university career pages. Capture named services and realistic pressure points only when supported.`,
    },
  ];
  const parts: Partial<ResearchReport>[] = [];
  for (const batch of batches) {
    const started = Date.now();
    const stage = `00_live_research_${batch.id}`;
    await appendLog(`[api:${stage}] started model=${RESEARCH_MODEL} baseURL=${RESEARCH_API_BASE_URL}`);
    try {
      const response = await fetch(`${RESEARCH_API_BASE_URL}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEARCH_API_KEY}`,
        },
        body: JSON.stringify({
          model: RESEARCH_MODEL,
          tools: [{ type: "web_search_preview" }],
          max_output_tokens: 8000,
          input: `${batch.focus}\n${sharedRules}`,
        }),
      });
      const raw = await response.text();
      await writeJson(`api_${stage}_response.json`, {
        status: response.status,
        ok: response.ok,
        duration_ms: Date.now() - started,
        raw_content: response.ok ? undefined : raw.slice(0, 2000),
      });
      if (!response.ok) {
        await appendLog(`[api:${stage}] failed status=${response.status}; continuing with other research batches`);
        continue;
      }
      const payload = JSON.parse(raw) as JsonObject;
      const content = responseOutputText(payload);
      await fs.writeFile(path.join(RUN_DIR, `api_${stage}_content.txt`), content, "utf8");
      const parsed = extractJsonObject(content) as Partial<ResearchReport>;
      const standardized = standardizeResearchBatch(batch.id, parsed);
      parts.push(standardized);
      await writeJson(`api_${stage}_parsed.json`, parsed);
      await writeJson(`api_${stage}_standardized.json`, standardized);
      await appendLog(`[api:${stage}] completed in ${Date.now() - started}ms sources=${standardized.sources?.length ?? 0}`);
    } catch (error) {
      await appendLog(`[api:${stage}] error; continuing with other research batches: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (parts.length === 0) {
    await appendLog("[research] all live research batches failed; using profile-aware fallback packet");
    await writeJson("00_research_report.json", PROFILE_RESEARCH_FALLBACK);
    return PROFILE_RESEARCH_FALLBACK;
  }
  const report = mergeResearchReports(parts);
  await writeJson("api_00_live_research_parsed.json", report);
  await writeJson("00_research_report.json", report);
  await appendLog(`[api:00_live_research] merged batches=${parts.length} sources=${report.sources?.length ?? 0}`);
  return report;
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
  const degreeTrack: LogicGraphDocument["degree_track"] =
    REQUESTED_PROFILE.grade === "Undergraduate" ? "undergraduate" : "master_taught";
  const destination = REQUESTED_PROFILE.city || REQUESTED_PROFILE.country;
  const graph: LogicGraphDocument = {
    flow_version: "post_offer_v1",
    story_id: STORY_ID,
    degree_track: degreeTrack,
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
      E_local_job: {
        id: "E_local_job",
        title: `${destination} becomes home`,
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
        condition_summary: `The player uses the ${destination} degree and network to launch in another country.`,
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
  "node_adjustments": [{"node_id":"N03_student_visa","title":"...","is_special":true,"why_special":"...","variant_triggers":[{"variables":["visa","time"],"reason":"..."}],"facts_used":["..."]}],
  "new_nodes": [{"id":"NXX_name","title":"...","insert_after":"N05_arrival_registration","stage":"study","is_special":true,"why_special":"...","variables_read":["money"],"variables_written":["money"],"variant_triggers":[{"variables":["money"],"reason":"..."}],"facts_used":["..."]}],
  "accepted_supplemental_variables": [],
  "special_nodes": [{"node_id":"N03_student_visa","reason":"...","ending_impact":"..."}],
  "research_adjustments": [{"node_id":"N03_student_visa","adjustment":"...","facts_used":["..."]}],
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
  // Option ids are runtime keys, not creative output. Force a node-scoped id
  // even when the model returns generic O1/O2/O3, otherwise two nodes can
  // collide and trigger an expensive whole-graph LLM repair for a trivial
  // deterministic problem.
  const id = `${nodeId}_${suffix}`;
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

function normalizeStableOptionIds(graph: LogicGraphDocument): void {
  for (const node of Object.values(graph.nodes)) {
    for (let index = 0; index < node.options.length; index++) {
      node.options[index].id = `${node.id}_O${index + 1}`;
    }
  }
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
    annotation: pages[node.id]?.annotation,
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
      annotation: pages[option.result_page_id]?.annotation,
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
  const grounding = `${REQUESTED_PROFILE.school || REQUESTED_PROFILE.city} ${REQUESTED_PROFILE.major}`;
  return OUTPUT_LANGUAGE === "zh"
    ? `- Simplified Chinese only, second person, grounded in the supplied ${grounding} research.
- Warning pages: 45-90 Chinese characters.
- Endings: 90-160 Chinese characters.`
    : `- English only, second person, grounded in the supplied ${grounding} research.
- Warning pages: 45-90 English words.
- Endings: 90-160 English words.`;
}

function variantLanguageRule(): string {
  return OUTPUT_LANGUAGE === "zh" ? "- Simplified Chinese only." : "- English only.";
}

function choiceOutputExample(): string {
  return OUTPUT_LANGUAGE === "zh" ? "\"choices\": [\"<id>：...\", \"<id>：...\", \"<id>：...\"]" : "\"choices\": [\"<id>: ...\", \"<id>: ...\", \"<id>: ...\"]";
}

function annotationOutputExample(): string {
  return `"annotation": {
        "cause": "why the reader reached this page",
        "current_step": "what real-world step this page represents",
        "consequence": "the immediate practical consequence",
        "next_impact": "what this can change later",
        "terms": [{"term":"the exact visible entity, professional term, or monetary text as it appears in the page prose","explanation":"plain-language meaning","category":"location|institution|discipline|professional_term|money","importance":"critical|important|supplementary","importance_reason":"why this level applies","monetary_amount":{"amount":6000,"currency":"EUR"},"evidence_ids":["S01"]}],
        "evidence_ids": ["S01"]
      }`;
}

function allowedEvidenceIds(): Set<string> {
  return new Set((ACTIVE_RESEARCH.sources ?? []).map((source) => source.evidence_id).filter((id): id is string => Boolean(id)));
}

function cleanEvidenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = allowedEvidenceIds();
  return [...new Set(value.filter((id): id is string => typeof id === "string" && allowed.has(id)))];
}

function annotationText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fallbackPageAnnotation(page: LogicPage): PageAnnotation {
  if (OUTPUT_LANGUAGE === "zh") {
    if (page.role === "result") {
      return {
        cause: "你刚才的选择把路线带到了这个直接结果。",
        current_step: `本页说明“${page.title}”这项行动实际产生了什么。`,
        consequence: "行动会立刻消耗或恢复相应资源，并留下可继续追踪的结果。",
        next_impact: "继续后会进入该选项预先连接的下一项留学流程；严重后果可能先触发警告或失败。",
        terms: [],
        evidence_ids: [],
      };
    }
    if (page.role === "warning") {
      return {
        cause: "此前连续选择已经让一项关键条件进入需要立即注意的状态。",
        current_step: `本页解释“${page.title}”为什么构成现实风险。`,
        consequence: "这还是可挽回的提醒，但继续忽视会压缩后续选择空间。",
        next_impact: "确认后会回到刚才的结果页；同一条件继续恶化时可能进入失败结局。",
        terms: [],
        evidence_ids: [],
      };
    }
    return {
      cause: `你已推进到“${page.title}”这一阶段。`,
      current_step: `本页要求你处理“${page.title}”对应的现实流程和取舍。`,
      consequence: "不同选择会产生不同的即时结果，并改变后续可承受的成本与风险。",
      next_impact: "结果页会说明本次行动的影响，然后按该选项进入后续流程。",
      terms: [],
      evidence_ids: [],
    };
  }
  if (page.role === "result") {
    return {
      cause: "Your previous choice led directly to this result.",
      current_step: `This page explains what the action “${page.title}” produced in practice.`,
      consequence: "The action immediately consumes or restores resources and leaves a traceable outcome.",
      next_impact: "Continue to the next study-abroad step connected to that choice; severe effects may first trigger a warning or failure.",
      terms: [],
      evidence_ids: [],
    };
  }
  if (page.role === "warning") {
    return {
      cause: "Earlier choices pushed a key condition into a state that now needs attention.",
      current_step: `This page explains why “${page.title}” is a practical risk.`,
      consequence: "The situation is still recoverable, but ignoring it will narrow later choices.",
      next_impact: "You will return to the interrupted result; further deterioration can lead to a failure ending.",
      terms: [],
      evidence_ids: [],
    };
  }
  return {
    cause: `Your route has reached the “${page.title}” stage.`,
    current_step: `This page asks you to handle the real process and trade-off represented by “${page.title}.”`,
    consequence: "Each choice creates an immediate result and changes the cost or risk you can carry later.",
    next_impact: "The result page explains the action's effect before the route continues.",
    terms: [],
    evidence_ids: [],
  };
}

function fallbackEndingAnnotation(ending: LogicEnding): PageAnnotation {
  if (OUTPUT_LANGUAGE === "zh") {
    return {
      cause: `此前多次选择共同满足了“${ending.title}”的进入条件。`,
      current_step: "本页汇总这条留学路线最终形成的状态。",
      consequence: ending.condition_summary,
      next_impact: "你可以回看沿途选择，识别哪些准备、求助或风险控制最早改变了结果。",
      terms: [],
      evidence_ids: [],
    };
  }
  return {
    cause: `Your earlier choices collectively met the entry conditions for “${ending.title}.”`,
    current_step: "This page summarizes the final state produced by this study-abroad route.",
    consequence: ending.condition_summary,
    next_impact: "Review the route to identify which preparation, support, or risk-control decision changed the outcome earliest.",
    terms: [],
    evidence_ids: [],
  };
}

function sanitizeAnnotation(value: unknown, fallback: PageAnnotation): PageAnnotation {
  const raw = value && typeof value === "object" ? (value as Partial<PageAnnotation>) : {};
  const evidenceIds = cleanEvidenceIds(raw.evidence_ids);
  const terms = Array.isArray(raw.terms)
    ? raw.terms
        .map((term) => {
          if (!term || typeof term !== "object") return null;
          const candidate = term as {
            term?: unknown;
            explanation?: unknown;
            category?: unknown;
            importance?: unknown;
            importance_reason?: unknown;
            monetary_amount?: unknown;
            evidence_ids?: unknown;
          };
          const termEvidenceIds = cleanEvidenceIds(candidate.evidence_ids);
          if (
            typeof candidate.term !== "string" ||
            !candidate.term.trim() ||
            typeof candidate.explanation !== "string" ||
            !candidate.explanation.trim() ||
            termEvidenceIds.length === 0
          ) return null;
          const importance = candidate.importance === "critical" || candidate.importance === "important" || candidate.importance === "supplementary"
            ? candidate.importance
            : "important";
          const category = candidate.category === "location"
            || candidate.category === "institution"
            || candidate.category === "discipline"
            || candidate.category === "professional_term"
            || candidate.category === "money"
            ? candidate.category
            : "professional_term";
          const rawMoney = candidate.monetary_amount && typeof candidate.monetary_amount === "object"
            ? candidate.monetary_amount as { amount?: unknown; currency?: unknown }
            : null;
          const monetaryAmount = rawMoney
            && typeof rawMoney.amount === "number"
            && Number.isFinite(rawMoney.amount)
            && rawMoney.amount >= 0
            && typeof rawMoney.currency === "string"
            && /^[A-Za-z]{3}$/.test(rawMoney.currency.trim())
            ? { amount: rawMoney.amount, currency: rawMoney.currency.trim().toUpperCase() }
            : undefined;
          return {
            term: candidate.term.trim(),
            explanation: candidate.explanation.trim(),
            category,
            importance,
            importance_reason: typeof candidate.importance_reason === "string" && candidate.importance_reason.trim()
              ? candidate.importance_reason.trim()
              : undefined,
            monetary_amount: monetaryAmount,
            evidence_ids: termEvidenceIds,
          };
        })
        .filter((term): term is PageAnnotation["terms"][number] => Boolean(term))
    : [];
  return {
    cause: annotationText(raw.cause, fallback.cause),
    current_step: annotationText(raw.current_step, fallback.current_step),
    consequence: annotationText(raw.consequence, fallback.consequence),
    next_impact: annotationText(raw.next_impact, fallback.next_impact),
    terms,
    evidence_ids: [...new Set([...evidenceIds, ...terms.flatMap((term) => term.evidence_ids)])],
  };
}

function ensurePageAnnotations(graph: LogicGraphDocument): void {
  for (const page of Object.values(graph.pages)) {
    page.annotation = sanitizeAnnotation(page.annotation, fallbackPageAnnotation(page));
  }
  for (const ending of Object.values(graph.endings)) {
    ending.annotation = sanitizeAnnotation(ending.annotation, fallbackEndingAnnotation(ending));
  }
}

async function fillNodeContent(graph: LogicGraphDocument, node: LogicNode, priorSummaries: string[]): Promise<string> {
  const ids = pageIdsForNode(graph, node);
  const pages = Object.fromEntries(ids.map((id) => [id, graph.pages[id]]));
  const response = await chatJson<ContentPatch>(`06_content_${node.id}`, [
    {
      role: "system",
      content:
        `You write clear ${proseLanguageName()} second-person informational scenarios for a study-abroad decision simulator. Return strict JSON only. Do not change routing ids.`,
    },
    {
      role: "user",
      content: `Fill this node and its option-result pages.

Rules:
${nodeContentRules(node.id)}
- Prefer plain, neutral, procedural language over dramatic or literary narration. The purpose is to teach the real process and its trade-offs.
- Make the situation concrete and readable, then place the decision at the end of the node page.
- Specific professional terms, policy rules, dates, fees, deadlines, named services, and authorization claims may appear only when supported by the evidence catalog.
- Explain and annotate every named place, country, city, university, school/faculty/department, degree/program, academic discipline/major, named organization/service, and professional term used on the page in annotation.terms. Cite one or more allowed evidence ids for each.
- annotation.terms[].term must copy the exact visible phrase from this page's text so the frontend can mark it inline.
- Assign category location, institution, discipline, professional_term, or money. Do not omit a visible entity just because it is familiar or already appeared on an earlier page.
- Give each term an importance: critical when misunderstanding can cause ineligibility, missed legal/academic status, failure, or a major deadline; important when it materially changes cost, time, or decisions; supplementary for helpful context.
- Also annotate every explicit monetary phrase in the prose (for example "6,000欧元") as a term. Copy the exact phrase and add monetary_amount with the numeric amount and ISO 4217 currency code. Do not calculate another currency here.
- annotation.evidence_ids may contain only ids from the catalog. Never invent an id, URL, organization, deadline, amount, or policy detail.
- If the catalog does not support a detail, keep it general and tell the reader to verify the current official page instead of fabricating precision.
- For every page, annotation must explain cause -> current real-world step -> immediate consequence -> later impact.
- Do not mention implementation, variables, JSON, branches, or page ids in the prose.
- Do not change next_node, planned_next_id, delta, or ids.
- Later content already written is summarized below; avoid repeating the same scene beats.

Previously filled summaries:
${compact(priorSummaries)}

Research:
${compact(ACTIVE_RESEARCH)}

Allowed evidence catalog:
${compact(evidenceCatalog(), 8_000)}

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
      ${choiceOutputExample()},
      ${annotationOutputExample()}
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
        `You write clear ${proseLanguageName()} warning and ending pages for a deterministic study-abroad decision simulator. Return strict JSON only.`,
    },
    {
      role: "user",
      content: `Fill all warning pages and endings.

Rules:
- Warning pages mean a variable has entered the bad band once; write a warning, not a final failure.
- Failure endings mean a variable reached critical and killed the chain.
- Non-failure endings resolve the study-abroad route.
${systemContentRules()}
- Prefer plain, neutral, procedural language over literary narration.
- Specific terms, rules, amounts, dates, deadlines, and named services must be supported by the evidence catalog.
- Every named place, institution, degree/program, discipline/major, named organization/service, and professional term must be explained in annotation.terms and cite allowed evidence ids only.
- annotation.terms[].term must be an exact phrase present in that page's text. Assign critical, important, or supplementary importance using decision impact.
- Assign category location, institution, discipline, professional_term, or money; annotate repeated entities again when they appear on this page.
- Treat every explicit monetary phrase as an annotated term and add monetary_amount with the original numeric amount and ISO 4217 currency code; never invent or convert an amount.
- Every annotation must explain cause -> current real-world step -> immediate consequence -> later impact.
- Never invent an evidence id or URL. If evidence is insufficient, keep the claim general and recommend checking the current official page.
- Do not mention variable bands or implementation terms in prose.

Prior summaries:
${compact(priorSummaries)}

Warning pages:
${compact(warningPages)}

Endings:
${compact(graph.endings)}

Allowed evidence catalog:
${compact(evidenceCatalog(), 8_000)}

Output:
{
  "pages": {"<warning_page_id>": {"text":"...","insight":"...",${annotationOutputExample()}}},
  "endings": {"<ending_id>": {"text":"...","insight":"...",${annotationOutputExample()}}},
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
    if (pagePatch.annotation) page.annotation = sanitizeAnnotation(pagePatch.annotation, fallbackPageAnnotation(page));
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
    if (endingPatch.insight?.trim()) ending.insight = endingPatch.insight.trim();
    if (endingPatch.annotation) ending.annotation = sanitizeAnnotation(endingPatch.annotation, fallbackEndingAnnotation(ending));
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
- Do not introduce new professional terms, policy claims, dates, amounts, deadlines, or named services; the page keeps its base annotation and evidence citations.
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
  return `${REQUESTED_PROFILE.city} international ${REQUESTED_PROFILE.major} ${REQUESTED_PROFILE.grade} student decision scene at ${REQUESTED_PROFILE.school || "a university"}, page ${id}, inspired by this story moment: ${snippet}`;
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
  let everyVisiblePageAnnotated = true;
  let allEvidenceReferencesValid = true;
  let allTermsExplainedAndCited = true;
  let annotatedPages = 0;
  let evidenceReferences = 0;
  const validEvidenceIds = new Set((doc.sources ?? []).map((source) => source.evidence_id).filter((id): id is string => Boolean(id)));

  function checkAnnotation(pageId: string, pageText: string, annotation: PageAnnotation | undefined): void {
    if (
      !annotation ||
      !annotation.cause?.trim() ||
      !annotation.current_step?.trim() ||
      !annotation.consequence?.trim() ||
      !annotation.next_impact?.trim()
    ) {
      everyVisiblePageAnnotated = false;
      issues.push(`${pageId} is missing a complete cause/current-step/consequence/next-impact annotation.`);
      return;
    }
    annotatedPages += 1;
    const pageEvidence = annotation.evidence_ids ?? [];
    evidenceReferences += pageEvidence.length;
    for (const evidenceId of pageEvidence) {
      if (!validEvidenceIds.has(evidenceId)) {
        allEvidenceReferencesValid = false;
        issues.push(`${pageId} cites missing evidence ${evidenceId}.`);
      }
    }
    for (const [index, term] of (annotation.terms ?? []).entries()) {
      if (!term.term?.trim() || !term.explanation?.trim() || !term.evidence_ids?.length) {
        allTermsExplainedAndCited = false;
        issues.push(`${pageId} term ${index + 1} is not fully explained and cited.`);
        continue;
      }
      if (!pageText.includes(term.term)) {
        allTermsExplainedAndCited = false;
        issues.push(`${pageId} term ${term.term} is not an exact phrase in the visible page text.`);
      }
      if (!term.importance) {
        allTermsExplainedAndCited = false;
        issues.push(`${pageId} term ${term.term} is missing importance.`);
      }
      if (!term.category) {
        allTermsExplainedAndCited = false;
        issues.push(`${pageId} term ${term.term} is missing its semantic category.`);
      }
      for (const evidenceId of term.evidence_ids) {
        evidenceReferences += 1;
        if (!validEvidenceIds.has(evidenceId)) {
          allEvidenceReferencesValid = false;
          issues.push(`${pageId} term ${term.term} cites missing evidence ${evidenceId}.`);
        }
      }
    }
  }

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    checkAnnotation(nodeId, node.scene_text, node.annotation);
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

  for (const [endingId, endingNode] of Object.entries(doc.endings)) {
    checkAnnotation(endingId, endingNode.scene_text, endingNode.annotation);
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
      annotatedPages,
      evidenceReferences,
    },
    requirements: {
      allPlayableNodesHaveThreeOptions,
      allChoicesHaveExplicitIds,
      variableWarningsAndFailuresPresent,
      allEnumeratedPathsTerminate: exhaustiveSimulation.badCount === 0 && exhaustiveSimulation.terminalPaths > 0,
      normalStrategyReachesNaturalEnding,
      everyVisiblePageAnnotated,
      allEvidenceReferencesValid,
      allTermsExplainedAndCited,
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
    profile: REQUESTED_PROFILE,
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

  let graph: LogicGraphDocument;
  const resumeRequested = process.env.FULL_RESUME_CHECKPOINT === "true";
  const savedResearch = resumeRequested
    ? await readRunJson<ResearchReport & { research_batches?: JsonObject[] }>("00_research_report.json")
    : null;
  const savedBalancedGraph = resumeRequested
    ? await readRunJson<LogicGraphDocument>("05_balanced_logic_graph.json")
    : null;
  const savedPlannedGraph = resumeRequested
    ? await readRunJson<LogicGraphDocument>("04_planned_graph_before_supervisor.json")
    : null;
  const savedPartialPlanning = resumeRequested
    ? await readLatestMatchingRunJson<LogicGraphDocument>(/^04_after_.+\.json$/)
    : null;
  const savedGraph = savedBalancedGraph ?? savedPlannedGraph ?? savedPartialPlanning?.value ?? null;

  if (savedResearch && savedGraph) {
    ACTIVE_RESEARCH = normalizeResearchReport(savedResearch);
    graph = savedGraph;
    ensureSystemPages(graph);
    normalizeStableOptionIds(graph);
    const checkpoint = savedBalancedGraph
      ? "balanced graph"
      : savedPlannedGraph
        ? "completed node-planning graph"
        : savedPartialPlanning?.name ?? "partial node-planning graph";
    await appendLog(`[resume] restored research and ${checkpoint}`);
  } else {
    ACTIVE_RESEARCH = await retrieveResearch();

    graph = createInitialGraph();
    await writeJson("01_initial_graph.json", graph);
    await adaptResearch(graph);
  }

  if (!savedBalancedGraph && !savedPlannedGraph) {
    for (const nodeId of [...graph.main_node_order]) {
      if (graph.nodes[nodeId]?.options.length) continue;
      await planNodeOptions(graph, nodeId);
    }
    const extraNodeIds = Object.keys(graph.nodes).filter((id) => !graph.main_node_order.includes(id) && graph.nodes[id].options.length === 0);
    for (const nodeId of extraNodeIds) {
      await planNodeOptions(graph, nodeId);
    }
    normalizeStableOptionIds(graph);
    await writeJson("04_planned_graph_before_supervisor.json", graph);
  }

  let balanceNotes: string[] = [];
  if (savedBalancedGraph) {
    graph = savedBalancedGraph;
    validateLogicGraph(graph);
    await appendLog("[resume] skipped supervisor and balance stages already completed");
  } else {
    graph = await superviseGraph(graph);
    validateLogicGraph(graph);
    balanceNotes = rebalanceNormalChoiceDeltas(graph);
    await appendLog(`[balance] adjusted ${balanceNotes.length} normal-choice deltas`);
    validateLogicGraph(graph);
    await writeJson("05_supervised_logic_graph.json", graph);
    await writeJson("05_balanced_logic_graph.json", graph);
  }

  const priorSummaries: string[] = [];
  const savedCompleteContent = resumeRequested
    ? await readRunJson<LogicGraphDocument>("06_content_complete_graph.json")
    : null;
  const savedPartialContent = resumeRequested && !savedCompleteContent
    ? await readLatestMatchingRunJson<LogicGraphDocument>(/^06_content_after_.+\.json$/)
    : null;
  if (savedCompleteContent) {
    graph = savedCompleteContent;
    await appendLog("[resume] restored completed content graph");
  } else if (savedPartialContent) {
    graph = savedPartialContent.value;
    await appendLog(`[resume] restored ${savedPartialContent.name}`);
  }

  const orderedNodeIds = [...graph.main_node_order, ...Object.keys(graph.nodes).filter((id) => !graph.main_node_order.includes(id))];
  const nodeHasContent = (nodeId: string): boolean => pageIdsForNode(graph, graph.nodes[nodeId])
    .every((pageId) => Boolean(graph.pages[pageId]?.text?.trim()));
  for (const nodeId of orderedNodeIds) {
    if (nodeHasContent(nodeId)) {
      const page = graph.pages[graph.nodes[nodeId].page_id];
      priorSummaries.push(`${nodeId}: ${(page?.text || page?.placeholder || "").slice(0, 240)}`);
      continue;
    }
    const summary = await fillNodeContent(graph, graph.nodes[nodeId], priorSummaries.slice(-10));
    priorSummaries.push(summary);
    await writeJson(`06_content_after_${nodeId}.json`, graph);
  }
  if (!savedCompleteContent) {
    priorSummaries.push(await fillSystemContent(graph, priorSummaries.slice(-12)));
    ensurePageAnnotations(graph);
    await writeJson("06_content_complete_graph.json", graph);
  }

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
