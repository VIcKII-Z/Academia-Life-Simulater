export interface UserProfile {
  country: string;
  city: string;
  grade: string;
  major: string;
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
}

export type FrameworkType = "convergence" | "diverging" | "turning_point";
export type Tone = "hopeful" | "bittersweet" | "challenging";

export interface Choice {
  text: string;
  next_node: string;
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
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
}
