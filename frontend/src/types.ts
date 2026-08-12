export interface Choice {
  /** Stable explicit id used by the post-offer if/else runtime and QA output. */
  logic_choice_id?: string;
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
  /** Post-offer logic variables applied before explicit if/else guards. */
  logic_delta?: Record<string, number>;
  logic_planned_next_node?: string;
  /** Marks the choice the Design Agent considers the "intended"/best path for
   * this profile — shown with a star badge. All choices on a node share the
   * same next_node (single generated content path), so this is a hint only. */
  recommended?: boolean;
}

export interface StatBlock {
  health: number;
  mood: number;
  money: number;
  /** Academics/school standing — drops if the player skips coursework/ignores
   * professor messages in favor of leisure. */
  school: number;
}

export interface PageTermAnnotation {
  term: string;
  explanation: string;
  importance?: "critical" | "important" | "supplementary";
  importance_reason?: string;
  monetary_amount?: {
    amount: number;
    currency: string;
  };
  evidence_ids: string[];
}

export interface PageAnnotation {
  cause: string;
  current_step: string;
  consequence: string;
  next_impact: string;
  terms: PageTermAnnotation[];
  evidence_ids: string[];
}

export interface StoryNode {
  type: string;
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  choices: Choice[];
  /** Optional educational "field note" grounded in real research, explaining
   * why this challenge/situation realistically happens to study-abroad students
   * with this profile. Shown in the scene's side "Field Notes" panel. */
  insight?: string;
  annotation?: PageAnnotation;
  logic_page_role?: "node" | "result" | "warning";
  logic_source_id?: string;
}

export type Tone = "hopeful" | "bittersweet" | "challenging";

export interface EndingNode {
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  tone: Tone;
  /** See StoryNode.insight. */
  insight?: string;
  annotation?: PageAnnotation;
  logic_page_role?: "failure" | "ending";
  logic_source_id?: string;
}

export interface StorySource {
  evidence_id?: string;
  title: string;
  url: string;
  source_type: string;
  confidence: "official_registry" | "high" | "medium" | "low";
  used_for: string[];
}

export interface StoryDocument {
  story_id: string;
  framework_type: "convergence" | "diverging" | "turning_point";
  framework_reason: string;
  user_profile: {
    country: string;
    city: string;
    grade: string;
    major: string;
    school?: string;
    department?: string;
    program?: string;
  };
  initial_stats?: StatBlock;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
  /** The Search Agent's cited sources — rendered as clickable links in the
   * Field Notes panel so the player can verify where the story's facts came from. */
  sources?: StorySource[];
  cached?: boolean;
  logic?: StoryLogicRuntime;
  logic_content_variants?: Record<string, LogicContentVariant[]>;
}

export type LogicBand = "good" | "mid" | "bad" | "critical";

export interface LogicContentVariant {
  variant_id: string;
  conditions: Partial<Record<string, LogicBand>>;
  scene_text: string;
  insight?: string;
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
  warning_return_sentinel: "__return_from_warning__";
  result_return_sentinel: "__continue_from_result__";
}

export type Provider = "openai" | "relay";
export type RuntimeService = "search" | "text" | "image";
export type OutputLanguage = "en" | "zh";

export interface RuntimeServiceConfig {
  provider: Provider;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface UserProfile {
  country: string;
  city: string;
  grade: string;
  major: string;
  /** Optional, case-by-case targeting — see search_agent_strategy.md Phase 0. */
  school?: string;
  department?: string;
  program?: string;
  /** How many semesters the stay covers — scales story length; defaults to 1. */
  semesters?: number;
}

export interface RuntimeConfig {
  provider: Provider;
  apiKey: string;
  baseURL?: string;
  models: {
    search: string;
    design: string;
    image: string;
  };
  services?: Partial<Record<RuntimeService, RuntimeServiceConfig>>;
  outputLanguage?: OutputLanguage;
  features: {
    enableLiveSearch: boolean;
    enableImageGeneration: boolean;
    maxImagesPerStory: number;
  };
}

export interface AppConfig {
  openai: {
    baseURL: string;
  };
  models: RuntimeConfig["models"];
  features: RuntimeConfig["features"];
  story: {
    minNodes: number;
    maxNodes: number;
  };
}

export type RunFiles = Record<string, unknown>;
