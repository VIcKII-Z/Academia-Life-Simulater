import type { AppConfig, RunFiles, RuntimeConfig, StoryDocument, UserProfile } from "../types";
import { loadCredentials, loadProviderApiKey } from "./storage";

const DEFAULT_MODELS = {
  search: "gpt-4o",
  design: "gemini-3-flash-preview",
  image: "gpt-image-1",
};

const DEFAULT_TEXT_RELAY_BASE_URL = "https://gcli.ggchan.dev/v1";

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

/** Live worldwide university name search, proxied through the backend (see
 * server.ts) to avoid the upstream APIs' missing CORS headers. When `city`
 * is given, the backend uses a geocode-bounded OpenStreetMap search so
 * results are actually scoped to that city (not just the country) —
 * without it, unrelated same-name-match universities from other cities in
 * the same country could show up. Best-effort: network errors resolve to
 * an empty array instead of throwing, so QuizFlow's curated fallback still
 * works if this is down. */
export async function searchUniversitiesLive(
  name: string,
  country?: string,
  city?: string,
): Promise<{ name: string; country: string }[]> {
  try {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (country) params.set("country", country);
    if (city) params.set("city", city);
    const res = await fetch(`/api/universities/search?${params.toString()}`);
    if (!res.ok) return [];
    return (await res.json()) as { name: string; country: string }[];
  } catch {
    return [];
  }
}

/** Full list of real country names, used so CountryStep is a search-only
 * picker instead of accepting arbitrary free text. Best-effort: network
 * errors resolve to an empty array, so the curated quick-pick chips still
 * work if this is down (though free typing is then unavailable — matches
 * intended "no free-type" behavior rather than silently degrading it). */
export async function fetchCountries(): Promise<string[]> {
  try {
    const res = await fetch("/api/countries");
    if (!res.ok) return [];
    return (await res.json()) as string[];
  } catch {
    return [];
  }
}

/** Live, accurate worldwide city search scoped to a country, proxied
 * through the backend (see server.ts) to avoid the upstream city API's
 * missing CORS headers. Best-effort: network errors resolve to an empty
 * array, so QuizFlow's curated-city chips + manual free-text entry still
 * work if this is down. */
export async function searchCitiesLive(country: string, name: string): Promise<string[]> {
  try {
    const params = new URLSearchParams();
    params.set("country", country);
    if (name) params.set("name", name);
    const res = await fetch(`/api/cities/search?${params.toString()}`);
    if (!res.ok) return [];
    return (await res.json()) as string[];
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
export function buildRuntimeConfig(
  overrides?: Partial<RuntimeConfig["models"]>,
  featureOverrides?: Partial<RuntimeConfig["features"]>,
  outputLanguage: RuntimeConfig["outputLanguage"] = "en",
): RuntimeConfig {
  const { provider, apiKey, baseURL } = loadCredentials();
  const models = { ...DEFAULT_MODELS, ...overrides };
  const openaiApiKey = loadProviderApiKey("openai").trim();
  const textApiKey = apiKey.trim();
  const textBaseURL = provider === "relay" ? baseURL.trim() || DEFAULT_TEXT_RELAY_BASE_URL : undefined;
  return {
    provider,
    apiKey: textApiKey,
    baseURL: textBaseURL,
    models,
    outputLanguage,
    services: {
      search: {
        provider: "openai",
        apiKey: openaiApiKey,
        model: models.search,
      },
      text: {
        provider,
        apiKey: textApiKey,
        baseURL: textBaseURL,
        model: models.design,
      },
      image: {
        provider: "openai",
        apiKey: openaiApiKey,
        model: models.image,
      },
    },
    features: {
      enableLiveSearch: true,
      enableImageGeneration: true,
      maxImagesPerStory: 12,
      ...featureOverrides,
    },
  };
}

export interface GenerateParams {
  mode: "preset" | "live_search";
  presetId?: string;
  profile?: UserProfile;
  runtimeConfig: RuntimeConfig;
  flowVersion?: "legacy" | "post_offer_v1";
  /** Force a fresh pipeline run even if a matching cached story exists. */
  regenerate?: boolean;
  /** Debug-only: explicit id so the caller can poll /api/runs/:storyId while it runs. */
  storyId?: string;
}

export async function fetchStory(storyId: string): Promise<StoryDocument | null> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`);
  if (!res.ok) return null;
  return (await res.json()) as StoryDocument;
}

export interface CachedStorySummary {
  storyId: string;
  school: string;
  program: string;
  city: string;
  country: string;
  outputLanguage: "zh" | "en" | string;
  updatedAt: string;
  imageCount: number;
}

export async function fetchCachedStories(limit = 6): Promise<CachedStorySummary[]> {
  const res = await fetch(`/api/stories?limit=${encodeURIComponent(String(limit))}`);
  if (!res.ok) return [];
  const payload = await res.json() as { stories?: CachedStorySummary[] };
  return payload.stories ?? [];
}

export interface ExchangeRate {
  base: string;
  quote: "CNY" | "LKR";
  rate: number;
  date: string;
  source: string;
}

export async function fetchExchangeRate(base: string, quote: string): Promise<ExchangeRate> {
  const params = new URLSearchParams({ base, quote });
  const res = await fetch(`/api/exchange-rate?${params.toString()}`);
  if (!res.ok) throw new Error("Could not load the reference exchange rate.");
  return (await res.json()) as ExchangeRate;
}

export interface FullGenerationJob {
  storyId: string;
  status: "running" | "completed" | "failed";
  pid?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  lines: string[];
  logTail: string[];
  hasFinalStory: boolean;
}

export async function generateStory(params: GenerateParams): Promise<StoryDocument> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  // Read as text first: a dropped connection (e.g. the dev server hot-reloading
  // mid-request, or an upstream relay cutting off) leaves an empty/partial body,
  // which res.json() would surface as an opaque "Unexpected end of JSON input".
  // Give a clearer, retry-friendly message in that case instead.
  const raw = await res.text();
  let payload: Record<string, unknown>;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Lost connection to the story server mid-generation. Please try again.");
  }
  if (!res.ok) {
    throw new Error((payload.error as string | undefined) ?? "Generation failed");
  }
  return payload as unknown as StoryDocument;
}

export async function startFullGeneration(params: {
  runtimeConfig: RuntimeConfig;
  profile?: UserProfile;
  storyId?: string;
  regenerate?: boolean;
  model?: string;
}): Promise<FullGenerationJob> {
  const res = await fetch("/api/full-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as FullGenerationJob & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? "Full generation failed to start");
  return payload;
}

export async function waitForFullGeneration(
  initialJob: FullGenerationJob,
  pollIntervalMs = 2_000,
): Promise<FullGenerationJob> {
  let job = initialJob;
  while (job.status === "running") {
    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));
    job = await fetchFullGenerationStatus(job.storyId);
  }
  if (job.status === "failed") {
    throw new Error(job.error ?? "Full generation failed.");
  }
  if (!job.hasFinalStory) {
    throw new Error("Generation finished without a playable final story.");
  }
  return job;
}

export async function fetchFullGenerationStatus(storyId: string): Promise<FullGenerationJob> {
  const res = await fetch(`/api/full-generate/${encodeURIComponent(storyId)}/status`);
  const payload = (await res.json()) as FullGenerationJob & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? "Could not load full generation status");
  return payload;
}

export function makeStoryId(seed: string): string {
  const slug = seed.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
  return `${slug}_${Date.now()}`;
}

export { DEFAULT_MODELS };
