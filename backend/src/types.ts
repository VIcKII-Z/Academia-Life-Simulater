export interface UserProfile {
  country: string;
  city: string;
  grade: string;
  major: string;
  /** Optional, finer-grained targeting (search_agent_strategy.md Phase 0). When present, the
   * Search Agent goes case-by-case for this exact school/department/program instead of
   * generic city+major research. All three are optional and independently omittable — the
   * Search Agent falls back gracefully (see ResearchReport.source_coverage/gaps). */
  school?: string;
  department?: string;
  program?: string;
  /** How many semesters the player's stay covers — drives story length: the Design Agent
   * scales total node count with this (see designAgent.ts's targetNodeCount), so a longer
   * stay produces a longer, differently-paced story and a different kind of ending. Defaults
   * to 1 semester (the original fixed 10-node story) when omitted. */
  semesters?: number;
}

export type Provider = "openai" | "relay";
export type FlowVersion = "legacy" | "post_offer_v1";

export interface RuntimeModels {
  search: string;
  design: string;
  image: string;
}

export interface RuntimeFeatures {
  enableLiveSearch: boolean;
  enableImageGeneration: boolean;
  maxImagesPerStory: number;
}

export interface RuntimeConfig {
  provider: Provider;
  apiKey?: string;
  baseURL?: string;
  models: RuntimeModels;
  features: RuntimeFeatures;
}

export interface ResearchReport {
  mode: "preset" | "live_search";
  location: { country: string; city: string };
  major: string;
  grade: string;
  /** Optional, finer-grained profile echoed back from the request (Phase 0). */
  profile?: {
    country: string;
    city: string;
    school?: string;
    department?: string;
    program?: string;
    major: string;
    grade: string;
  };
  report: {
    cost_of_living: string;
    academic: string;
    visa: string;
    culture_shock: string;
    community: string;
    career: string;
    safety: string;
    climate: string;
    part_time_work: string;
  };
  gameplay_signals?: {
    health: string[];
    mood: string[];
    money: string[];
    city_major_specific_challenges: string[];
  };
  /** Which source tiers (search_agent_strategy.md Layers 0-10) were actually found/used. */
  source_coverage?: {
    official_registry?: boolean;
    program_official?: boolean;
    department_official?: boolean;
    catalog?: boolean;
    handbook?: boolean;
    international_office?: boolean;
    tuition?: boolean;
    housing?: boolean;
    career?: boolean;
    student_forum?: boolean;
  };
  program_profile?: {
    official_name?: string;
    degree_type?: string;
    department?: string;
    duration?: string;
    delivery_mode?: string;
    visa_eligible_notes?: string;
    curriculum?: string[];
    milestones?: string[];
    prerequisites?: string[];
    admissions?: string[];
    deadlines?: string[];
    funding?: string[];
  };
  student_life_profile?: {
    housing?: string;
    commute?: string;
    campus_support?: string;
    community?: string;
    safety?: string;
    climate?: string;
  };
  career_profile?: {
    local_industry?: string;
    internship?: string;
    work_authorization?: string;
    language_or_networking_requirements?: string;
    /** Real, named employers who visibly recruit from this school/department (career fair
     * attendee lists, recruiting-partner pages, alumni outcome reports) — omit rather than
     * invent if no such page was found. */
    notable_employers?: string[];
    /** Real, specific recruiting/career events (career fairs, info sessions, hackathons)
     * tied to this school/department, if a page for one was actually found. */
    recruiting_events?: string[];
    /** Real alumni outcome statements/quotes if a department outcomes/placement page exists. */
    alumni_outcomes?: string[];
  };
  /** Concrete, named campus-life details that make the story feel like THIS specific school
   * instead of "a university abroad" — courses, faculty, libraries, clubs, and events. Every
   * entry MUST come from an actual page the Search Agent found (course catalog, department
   * faculty/people page, library site, student clubs/circles directory, campus events/news
   * page); never invent a named person, course code, or organization that wasn't found. If a
   * dimension has no real source, omit the array entirely (not an empty array with a filler
   * note) so the Design Agent knows to keep that part of the story generic. */
  campus_life_profile?: {
    /** Specific course titles (ideally with course code) beyond the generic curriculum
     * categories in program_profile.curriculum, e.g. "CS 6.867 Machine Learning". */
    notable_courses?: { title: string; code?: string; note?: string; url?: string }[];
    /** Real faculty names found on an official department/lab faculty or "people" page. */
    notable_faculty?: { name: string; title?: string; research_area?: string; url?: string }[];
    /** Real campus or department libraries, e.g. "Komaba Library", "Widener Library". */
    libraries?: { name: string; note?: string; url?: string }[];
    /** Real student clubs/organizations/circles (major-relevant and general campus life),
     * found via a student-life/clubs/circles directory page. */
    clubs?: { name: string; note?: string; url?: string }[];
    /** Real recurring campus events (festivals, hackathons, guest lectures, career fairs)
     * found via a campus events/news page. */
    events?: { name: string; note?: string; url?: string }[];
  };
  /** Per-claim provenance, ranked by search_agent_strategy.md's confidence tiers. */
  sources?: {
    title: string;
    url: string;
    source_type:
      | "official_registry"
      | "program_official"
      | "department"
      | "catalog"
      | "handbook"
      | "international_office"
      | "tuition"
      | "housing"
      | "career"
      | "forum"
      | "third_party"
      | "reference";
    confidence: "official_registry" | "high" | "medium" | "low";
    used_for: string[];
  }[];
  /** Explicit gaps/caveats — e.g. "no program-level page found, used department fallback." */
  gaps?: string[];
}

export type FrameworkType = "convergence" | "diverging" | "turning_point";
export type Tone = "hopeful" | "bittersweet" | "challenging";
export type StatKey = "health" | "mood" | "money" | "school";

export interface StatBlock {
  health: number;
  mood: number;
  money: number;
  /** Academics/school standing — drops if the player skips coursework, ignores
   * professor messages, etc. in favor of leisure; a fourth visible stat
   * alongside health/mood/money. */
  school: number;
}

export interface Choice {
  /** Stable explicit id used by the post-offer if/else runtime and QA output. */
  logic_choice_id?: string;
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
  /** Post-offer logic graph deltas. These are applied before route guards:
   * newly-bad variables trigger warning pages once, critical variables route
   * to failure endings. Runtime routing remains explicit if/else over IDs and
   * values; no semantic/vector page matching is involved. */
  logic_delta?: Record<string, number>;
  logic_planned_next_node?: string;
  /** Legacy field from the earlier hint UI. The frontend no longer highlights
   * a recommended option, but cached stories may still include this safely. */
  recommended?: boolean;
}

export interface StoryNode {
  type: string;
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  choices: Choice[];
  /** Optional 1-2 sentence educational "field note", grounded in the research
   * report, explaining WHY this situation/challenge realistically happens to
   * study-abroad students with this profile. Rendered in the side panel so the
   * player learns about real study-abroad life while playing. */
  insight?: string;
  logic_page_role?: "node" | "result" | "warning";
  logic_source_id?: string;
}

export interface EndingNode {
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  tone: Tone;
  /** See StoryNode.insight. */
  insight?: string;
  logic_page_role?: "failure" | "ending";
  logic_source_id?: string;
}

export interface StoryDocument {
  story_id: string;
  framework_type: FrameworkType;
  framework_reason: string;
  user_profile: UserProfile;
  initial_stats?: StatBlock;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
  /** Carried over from ResearchReport.sources so the Field Notes panel can
   * link the player to the actual pages the story's facts were grounded in. */
  sources?: ResearchReport["sources"];
  logic?: StoryLogicRuntime;
  logic_content_variants?: Record<string, LogicContentVariant[]>;
}

export interface LogicContentVariant {
  variant_id: string;
  conditions: Partial<Record<string, LogicVariableBand>>;
  scene_text: string;
  insight?: string;
}

export type LogicVariableBand = "good" | "mid" | "bad" | "critical";
export type LogicOptionKind = "normal" | "positive_extreme" | "negative_extreme";
export type LogicNodeType = "base_node" | "special_node" | "branch_node";
export type LogicPageRole = "node" | "result" | "warning" | "failure" | "ending";

export interface LogicVariableDefinition {
  id: string;
  label: string;
  initial: number;
  is_base: boolean;
  rationale: string;
  affects_nodes: string[];
  warning_page_id: string;
  failure_page_id: string;
}

export interface StoryLogicRuntimeVariable {
  id: string;
  label: string;
  initial: number;
  warning_page_id: string;
  failure_page_id: string;
}

export interface StoryLogicRuntime {
  flow_version: "post_offer_v1";
  start_node_id: string;
  variables: StoryLogicRuntimeVariable[];
  /** Warning pages use this sentinel next_node. HomeFlow returns to the stored
   * interrupted result page instead of trusting model-authored semantic routing. */
  warning_return_sentinel: "__return_from_warning__";
  /** Result pages use this sentinel next_node. HomeFlow returns to the
   * option-specific planned_next_id captured when the option was chosen. */
  result_return_sentinel: "__continue_from_result__";
}

export interface LogicVariantTrigger {
  variables: string[];
  reason: string;
  combinations?: string[];
}

export interface LogicPage {
  id: string;
  role: LogicPageRole;
  owner_node_id?: string;
  title: string;
  placeholder?: string;
  text?: string;
  insight?: string;
  variant_triggers?: LogicVariantTrigger[];
}

export interface LogicOption {
  id: string;
  kind: LogicOptionKind;
  label: string;
  result_page_id: string;
  planned_next_id: string;
  route_decision: "return_to_next_main_node" | "enter_parallel_branch_node" | "enter_ending";
  delta: Record<string, number>;
  state_set?: Record<string, string | number | boolean>;
  rationale: string;
  facts_used?: string[];
}

export interface LogicNode {
  id: string;
  type: LogicNodeType;
  title: string;
  stage: "offer_prearrival" | "study" | "post_graduation";
  is_special: boolean;
  why_special?: string;
  variables_read: string[];
  variables_written: string[];
  facts_used?: string[];
  variant_triggers?: LogicVariantTrigger[];
  options: LogicOption[];
}

export interface LogicEnding {
  id: string;
  title: string;
  tone: Tone;
  condition_summary: string;
}

export interface LogicGraphDocument {
  flow_version: "post_offer_v1";
  story_id: string;
  degree_track: "undergraduate" | "master_taught";
  base_variables: LogicVariableDefinition[];
  suggested_variables?: LogicVariableDefinition[];
  accepted_supplemental_variables?: LogicVariableDefinition[];
  main_node_order: string[];
  special_nodes: { node_id: string; reason: string; ending_impact: string }[];
  research_adjustments: {
    node_id: string;
    adjustment: string;
    facts_used?: string[];
  }[];
  nodes: Record<string, LogicNode>;
  pages: Record<string, LogicPage>;
  endings: Record<string, LogicEnding>;
  gaps?: string[];
}
