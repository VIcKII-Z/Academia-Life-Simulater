export interface UserProfile {
  country: string;
  city: string;
  grade: string;
  major: string;
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
}

export type FrameworkType = "convergence" | "diverging" | "turning_point";
export type Tone = "hopeful" | "bittersweet" | "challenging";
export type StatKey = "health" | "mood" | "money";

export interface StatBlock {
  health: number;
  mood: number;
  money: number;
}

export interface Choice {
  text: string;
  next_node: string;
  stat_delta?: StatBlock;
  stat_reason?: string;
}

export interface StoryNode {
  type: string;
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  choices: Choice[];
}

export interface EndingNode {
  scene_text: string;
  image_prompt: string | null;
  has_image: boolean;
  image_url?: string;
  tone: Tone;
}

export interface StoryDocument {
  story_id: string;
  framework_type: FrameworkType;
  framework_reason: string;
  user_profile: UserProfile;
  initial_stats?: StatBlock;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
}
