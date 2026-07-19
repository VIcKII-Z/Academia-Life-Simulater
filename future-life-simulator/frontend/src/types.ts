export interface Choice {
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
}

export interface StatBlock {
  health: number;
  mood: number;
  money: number;
}

export interface StoryNode {
  type: string;
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  choices: Choice[];
}

export type Tone = "hopeful" | "bittersweet" | "challenging";

export interface EndingNode {
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  tone: Tone;
}

export interface StoryDocument {
  story_id: string;
  framework_type: "convergence" | "diverging" | "turning_point";
  framework_reason: string;
  user_profile: { country: string; city: string; grade: string; major: string };
  initial_stats?: StatBlock;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
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
