export interface Choice {
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
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
}

export interface StorySource {
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
}

export type Provider = "openai" | "relay";

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
