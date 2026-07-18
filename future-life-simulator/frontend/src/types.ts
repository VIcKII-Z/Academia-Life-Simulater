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
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingNode>;
}
