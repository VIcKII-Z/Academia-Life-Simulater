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
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
  /** Marks the choice the Design Agent considers the "intended"/best path for
   * this profile — surfaced in the UI with a star badge. Since the game only
   * generates a single linear content path per node (all choices on a node
   * share the same next_node, to save generation cost), this is purely a
   * player-facing hint, not a branch selector. */
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
}

export interface EndingNode {
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  tone: Tone;
  /** See StoryNode.insight. */
  insight?: string;
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
}
