import type { AppConfig, RunFiles, RuntimeConfig, StoryDocument, UserProfile } from "../types";
import { loadCredentials } from "./storage";

const DEFAULT_MODELS = {
  search: "gpt-4o",
  design: "gpt-4o-mini",
  image: "gpt-image-1",
};

export async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Could not reach backend. Is it running on :3001?");
  return (await res.json()) as AppConfig;
}

export async function fetchPresets(): Promise<string[]> {
  const res = await fetch("/api/presets");
  if (!res.ok) throw new Error("Could not load presets.");
  return (await res.json()) as string[];
}

/** Live university name search, proxied through the backend (see
 * server.ts) to avoid the Hipolabs API's missing CORS headers. Best-effort:
 * network errors resolve to an empty array instead of throwing, so
 * QuizFlow's manual country/city fallback still works if this is down. */
export async function searchUniversitiesLive(
  name: string,
  country?: string,
): Promise<{ name: string; country: string }[]> {
  try {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (country) params.set("country", country);
    const res = await fetch(`/api/universities/search?${params.toString()}`);
    if (!res.ok) return [];
    return (await res.json()) as { name: string; country: string }[];
  } catch {
    return [];
  }
}

export async function fetchRunFiles(storyId: string): Promise<RunFiles | null> {
  const res = await fetch(`/api/runs/${encodeURIComponent(storyId)}`);
  if (!res.ok) return null;
  return (await res.json()) as RunFiles;
}

export async function fetchRunList(): Promise<string[]> {
  const res = await fetch("/api/runs");
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

/** Builds the RuntimeConfig sent to /api/generate from stored credentials + optional model overrides. */
export function buildRuntimeConfig(overrides?: Partial<RuntimeConfig["models"]>): RuntimeConfig {
  const { provider, apiKey, baseURL } = loadCredentials();
  return {
    provider,
    apiKey: apiKey.trim(),
    baseURL: provider === "relay" ? baseURL.trim() : undefined,
    models: { ...DEFAULT_MODELS, ...overrides },
    features: {
      enableLiveSearch: true,
      enableImageGeneration: true,
      maxImagesPerStory: 8,
    },
  };
}

export interface GenerateParams {
  mode: "preset" | "live_search";
  presetId?: string;
  profile?: UserProfile;
  runtimeConfig: RuntimeConfig;
  /** Force a fresh pipeline run even if a matching cached story exists. */
  regenerate?: boolean;
  /** Debug-only: explicit id so the caller can poll /api/runs/:storyId while it runs. */
  storyId?: string;
}

export async function generateStory(params: GenerateParams): Promise<StoryDocument> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error ?? "Generation failed");
  }
  return payload as StoryDocument;
}

export function makeStoryId(seed: string): string {
  const slug = seed.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
  return `${slug}_${Date.now()}`;
}

export { DEFAULT_MODELS };
