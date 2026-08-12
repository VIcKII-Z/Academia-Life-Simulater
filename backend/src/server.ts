import "dotenv/config";
import express from "express";
import cors from "cors";
import { exec, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config/config.js";
import { runSearchAgentPreset, runSearchAgentLive, listPresets } from "./agents/searchAgent.js";
import { runDesignAgent } from "./agents/designAgent.js";
import { runLogicGraphAgent } from "./agents/logicGraphAgent.js";
import { compileLogicGraphToStoryDocument } from "./agents/logicGraphCompiler.js";
import { runArtistAgent } from "./agents/artistAgent.js";
import { RunLogger, listRuns, readRunFiles } from "./runLogger.js";
import type {
  FlowVersion,
  Provider,
  ResearchReport,
  RuntimeConfig,
  RuntimeService,
  RuntimeServiceConfig,
  StoryDocument,
  UserProfile,
} from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const STORIES_DIR = path.resolve(process.cwd(), "..", "data", "stories");
const ASSETS_DIR = path.resolve(process.cwd(), "..", "data", "assets");
const RUNS_DIR = path.resolve(process.cwd(), "..", "data", "runs");
const STORY_STRUCTURE_VERSION = "post-offer-v1-variable-gated";
const FULL_GENERATOR_VERSION = "full-post-offer-v4-normalized-official-research";
const MANUAL_FULL_GENERATOR_PROFILE: UserProfile = {
  country: "Japan",
  city: "Tokyo",
  school: "The University of Tokyo",
  department: "Graduate School of Information Science and Technology",
  program: "Computer Science master's track",
  major: "Computer Science",
  grade: "Taught Master",
};
app.use("/assets", express.static(ASSETS_DIR));

type FullGenerationState = "running" | "completed" | "failed";

type FullGenerationJob = {
  storyId: string;
  status: FullGenerationState;
  pid?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
  lines: string[];
};

const fullGenerationJobs = new Map<string, FullGenerationJob>();
const exchangeRateCache = new Map<string, { expiresAt: number; payload: ExchangeRatePayload }>();

type ExchangeRatePayload = {
  base: string;
  quote: "CNY" | "LKR";
  rate: number;
  date: string;
  source: "Frankfurter";
};

function normalizeRelayBaseURL(rawBaseURL: string): string {
  try {
    const url = new URL(rawBaseURL);
    const pathname = url.pathname.replace(/\/+$/, "");

    if (!pathname || pathname === "/") {
      url.pathname = "/v1";
    } else if (pathname === "/responses") {
      url.pathname = "/v1";
    }

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Relay base URL is invalid. Use an OpenAI-compatible API base URL, for example: https://gcli.ggchan.dev/v1");
  }
}

type RawRuntimeServiceConfig = {
  provider?: Provider;
  apiKey?: string;
  baseURL?: string;
  model?: string;
};

function resolveRuntimeServiceConfig(
  service: RuntimeService,
  raw: RawRuntimeServiceConfig | undefined,
  fallback: RuntimeServiceConfig,
): RuntimeServiceConfig {
  const provider: Provider = raw?.provider === "relay" ? "relay" : raw?.provider === "openai" ? "openai" : fallback.provider;
  const apiKey = raw?.apiKey?.trim() || fallback.apiKey?.trim();
  const rawBaseURL = raw?.baseURL?.trim() || fallback.baseURL?.trim();
  if (provider === "relay" && apiKey && !rawBaseURL) {
    throw new Error(`${service} service uses relay mode and needs a relay base URL.`);
  }
  return {
    provider,
    apiKey,
    baseURL: provider === "relay" && rawBaseURL ? normalizeRelayBaseURL(rawBaseURL) : undefined,
    model: raw?.model?.trim() || fallback.model,
  };
}

function resolveRuntimeConfig(input: unknown, mode: "preset" | "live_search"): RuntimeConfig | undefined {
  if (!input || typeof input !== "object") return undefined;

  const raw = input as {
    provider?: Provider;
    apiKey?: string;
    baseURL?: string;
    models?: Partial<RuntimeConfig["models"]>;
    services?: Partial<Record<RuntimeService, RawRuntimeServiceConfig>>;
    outputLanguage?: RuntimeConfig["outputLanguage"];
    features?: Partial<RuntimeConfig["features"]>;
  };

  const provider: Provider = raw.provider === "relay" ? "relay" : "openai";
  const apiKey = raw.apiKey?.trim();
  const baseURL = raw.baseURL?.trim();
  const textServiceBaseURL = raw.services?.text?.baseURL?.trim();
  const backendRelayBaseURL = process.env.GCLI_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim();
  const resolvedRelayBaseURL = baseURL || textServiceBaseURL || backendRelayBaseURL;

  if (provider === "relay" && !resolvedRelayBaseURL) {
    throw new Error("Relay mode requires a relay base URL.");
  }

  const legacyService: RuntimeServiceConfig = {
    provider,
    apiKey: apiKey || (provider === "relay" ? process.env.GCLI_API_KEY : process.env.OPENAI_API_KEY),
    baseURL: provider === "relay" ? normalizeRelayBaseURL(resolvedRelayBaseURL as string) : undefined,
  };
  const models = {
    search: raw.models?.search?.trim() || config.models.search,
    design: raw.models?.design?.trim() || config.models.design,
    image: raw.models?.image?.trim() || config.models.image,
  };
  const services: RuntimeConfig["services"] = {
    search: resolveRuntimeServiceConfig("search", raw.services?.search, {
      provider: "openai",
      apiKey: legacyService.provider === "openai" ? legacyService.apiKey : process.env.OPENAI_API_KEY,
      model: models.search,
    }),
    text: resolveRuntimeServiceConfig("text", raw.services?.text, {
      ...legacyService,
      model: models.design,
    }),
    image: resolveRuntimeServiceConfig("image", raw.services?.image, {
      provider: "openai",
      apiKey: legacyService.provider === "openai" ? legacyService.apiKey : process.env.OPENAI_API_KEY,
      model: models.image,
    }),
  };

  return {
    provider,
    apiKey: legacyService.apiKey,
    baseURL: provider === "relay" ? normalizeRelayBaseURL(resolvedRelayBaseURL as string) : undefined,
    models,
    services,
    outputLanguage: raw.outputLanguage === "zh" ? "zh" : "en",
    features: {
      enableLiveSearch:
        raw.features?.enableLiveSearch ?? (mode === "live_search" ? true : config.features.enableLiveSearch),
      enableImageGeneration: raw.features?.enableImageGeneration ?? config.features.enableImageGeneration,
      maxImagesPerStory: raw.features?.maxImagesPerStory ?? config.features.maxImagesPerStory,
    },
  };
}

function getSafeRuntimeConfig(runtimeConfig?: RuntimeConfig): Omit<RuntimeConfig, "apiKey"> | undefined {
  if (!runtimeConfig) return undefined;
  const { apiKey: _apiKey, services, ...safeConfig } = runtimeConfig;
  const safeServices = services
    ? Object.fromEntries(
        Object.entries(services).map(([service, serviceConfig]) => {
          const { apiKey: _serviceApiKey, ...safeServiceConfig } = serviceConfig;
          return [service, safeServiceConfig];
        }),
      )
    : undefined;
  return { ...safeConfig, services: safeServices };
}

function sanitizeStoryId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
}

function fullGeneratorScriptPath(): string {
  return path.join(process.cwd(), "scripts", "fullPostOfferGenerator.ts");
}

function tsxCommand(): string {
  return process.execPath;
}

function tsxArgs(): string[] {
  return [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), fullGeneratorScriptPath()];
}

function appendFullJobLine(job: FullGenerationJob, line: string): void {
  const trimmed = line.trimEnd();
  if (!trimmed) return;
  job.lines.push(trimmed);
  if (job.lines.length > 200) job.lines.splice(0, job.lines.length - 200);
  job.updatedAt = new Date().toISOString();
}

async function readFullGeneratorLogTail(storyId: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, storyId, "full_generator.log"), "utf-8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-120);
  } catch {
    return [];
  }
}

async function hasFullGeneratorFinalStory(storyId: string): Promise<boolean> {
  try {
    await fs.access(path.join(RUNS_DIR, storyId, "09_final_story.json"));
    return true;
  } catch {
    return false;
  }
}

async function hasFullGeneratorPlanningCheckpoint(storyId: string): Promise<boolean> {
  try {
    await fs.access(path.join(RUNS_DIR, storyId, "00_research_report.json"));
    const names = await fs.readdir(path.join(RUNS_DIR, storyId));
    return names.some((name) =>
      name === "04_planned_graph_before_supervisor.json"
      || name === "05_balanced_logic_graph.json"
      || name === "06_content_complete_graph.json"
      || /^04_after_.+\.json$/.test(name)
      || /^06_content_after_.+\.json$/.test(name));
  } catch {
    return false;
  }
}

async function fullGenerationStatus(job: FullGenerationJob): Promise<FullGenerationJob & { logTail: string[]; hasFinalStory: boolean }> {
  const logTail = await readFullGeneratorLogTail(job.storyId);
  const logError = [...logTail].reverse().find((line) => line.includes("[fatal]") || line.includes("failed status="));
  return {
    ...job,
    error: job.status === "failed" ? logError ?? job.error : job.error,
    logTail,
    hasFinalStory: await hasFullGeneratorFinalStory(job.storyId),
  };
}

/**
 * Recursively sorts object keys (arrays keep their order) so that
 * JSON.stringify produces the same string regardless of the original
 * property insertion order. Plain `JSON.stringify` is order-sensitive, and
 * two logically-identical profile objects (e.g. `{school, department,
 * program}` vs `{school, program, department}`, which can differ depending
 * on which UI path built them — QuizFlow vs DebugPage vs a raw API call)
 * would otherwise hash to different cache keys and silently miss the cache.
 *
 * When `normalizeStrings` is true, string leaves are also trimmed, collapsed
 * to single spaces, and lowercased before hashing — used only for the cache
 * key (buildCacheStoryId), never for the data actually stored/displayed —
 * so free-text fields like school/department/program (which the player can
 * retype with different casing/spacing, e.g. "MS in Computer Science" vs
 * "MS in computer Science") still hit the same cache entry instead of
 * silently regenerating over a cosmetic difference.
 */
function canonicalize(value: unknown, normalizeStrings = false): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, normalizeStrings));
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key], normalizeStrings);
        return acc;
      }, {});
  }
  if (normalizeStrings && typeof value === "string") {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }
  return value;
}

/**
 * Deterministic cache key for a generation request: same mode + preset/profile
 * + model config always produces the same storyId, so repeated requests reuse
 * the previously generated story instead of re-running the whole pipeline.
 * Pass `regenerate: true` in the request body to force a fresh run (a short
 * random suffix is appended so it gets its own cache slot going forward).
 */
function buildCacheStoryId(
  mode: "preset" | "live_search",
  presetId: string | undefined,
  profile: UserProfile | undefined,
  runtimeConfig: RuntimeConfig | undefined,
  flowVersion: FlowVersion | undefined,
): string {
  const keyPayload = canonicalize(
    {
      mode,
      storyStructureVersion: STORY_STRUCTURE_VERSION,
      flowVersion: flowVersion ?? "legacy",
      presetId: mode === "preset" ? presetId ?? "tokyo_cs" : undefined,
      profile: mode === "live_search" ? profile : undefined,
      models: runtimeConfig?.models,
      outputLanguage: runtimeConfig?.outputLanguage ?? "en",
    },
    true,
  );
  const hash = createHash("sha1").update(JSON.stringify(keyPayload)).digest("hex").slice(0, 12);
  const seed = mode === "preset" ? presetId ?? "story" : profile?.city ?? "story";
  return `${sanitizeStoryId(seed)}_${hash}`;
}

function buildFullGenerationStoryId(
  profile: UserProfile | undefined,
  runtimeConfig: RuntimeConfig | undefined,
): string {
  const keyPayload = canonicalize(
    {
      generatorVersion: FULL_GENERATOR_VERSION,
      profile,
      models: runtimeConfig?.models,
      outputLanguage: runtimeConfig?.outputLanguage ?? "en",
      imageGeneration: runtimeConfig?.features.enableImageGeneration ?? false,
      maxImagesPerStory: runtimeConfig?.features.maxImagesPerStory ?? 0,
    },
    true,
  );
  const hash = createHash("sha1").update(JSON.stringify(keyPayload)).digest("hex").slice(0, 12);
  const seed = profile?.school || profile?.city || "study_abroad";
  return `${sanitizeStoryId(seed)}_full_${hash}`;
}

async function readCachedStory(storyId: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(path.join(STORIES_DIR, `${storyId}_final.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function countGeneratedImages(story: unknown): number {
  if (!story || typeof story !== "object") return 0;
  const doc = story as {
    nodes?: Record<string, { image_url?: unknown }>;
    endings?: Record<string, { image_url?: unknown }>;
  };
  return [...Object.values(doc.nodes ?? {}), ...Object.values(doc.endings ?? {})].filter(
    (node) => typeof node.image_url === "string" && node.image_url.trim(),
  ).length;
}

function countStoryChapters(story: unknown): number {
  if (!story || typeof story !== "object") return 0;
  const doc = story as {
    nodes?: Record<string, unknown>;
    endings?: Record<string, unknown>;
  };
  return Object.keys(doc.nodes ?? {}).length + Object.keys(doc.endings ?? {}).length;
}

function hasEnoughCachedImages(cached: unknown, rawRuntimeConfig: unknown): boolean {
  const raw = rawRuntimeConfig as { features?: Partial<RuntimeConfig["features"]> } | undefined;
  const enableImageGeneration = raw?.features?.enableImageGeneration ?? config.features.enableImageGeneration;
  if (!enableImageGeneration) return true;

  const maxImagesPerStory = raw?.features?.maxImagesPerStory ?? config.features.maxImagesPerStory;
  const requiredImages = Math.min(countStoryChapters(cached), maxImagesPerStory);
  return requiredImages <= 0 || countGeneratedImages(cached) >= requiredImages;
}

function prepareCachedStoryForResponse(cached: unknown, rawRuntimeConfig: unknown): object {
  const raw = rawRuntimeConfig as { features?: Partial<RuntimeConfig["features"]> } | undefined;
  const enableImageGeneration = raw?.features?.enableImageGeneration ?? config.features.enableImageGeneration;
  if (enableImageGeneration) return cached as object;

  const doc = JSON.parse(JSON.stringify(cached)) as {
    nodes?: Record<string, { image_url?: string }>;
    endings?: Record<string, { image_url?: string }>;
  };
  for (const node of Object.values(doc.nodes ?? {})) delete node.image_url;
  for (const ending of Object.values(doc.endings ?? {})) delete ending.image_url;
  return doc as object;
}

function campusLifeSources(report: ResearchReport): NonNullable<ResearchReport["sources"]> {
  const campus = report.campus_life_profile;
  if (!campus) return [];

  const sources: {
    title: string;
    url: string;
    source_type:
      | "department"
      | "catalog"
      | "reference";
    confidence: "high" | "medium";
    used_for: string[];
  }[] = [];
  const add = (
    title: string | undefined,
    url: string | undefined,
    source_type: "department" | "catalog" | "reference",
    used_for: string[],
  ): void => {
    if (!title || !url || sources.some((source) => source.url === url)) return;
    sources.push({ title, url, source_type, confidence: source_type === "reference" ? "medium" : "high", used_for });
  };

  for (const course of campus.notable_courses ?? []) {
    add(course.code ? `${course.code}: ${course.title}` : course.title, course.url, "catalog", ["academic", "course"]);
  }
  for (const faculty of campus.notable_faculty ?? []) {
    add(faculty.name, faculty.url, "department", ["academic", "faculty"]);
  }
  for (const library of campus.libraries ?? []) {
    add(library.name, library.url, "reference", ["student_life", "library"]);
  }
  for (const club of campus.clubs ?? []) {
    add(club.name, club.url, "reference", ["student_life", "community"]);
  }
  for (const event of campus.events ?? []) {
    add(event.name, event.url, "reference", ["student_life", "event"]);
  }

  return sources;
}

function mergeSources<T extends { url?: string }>(base: T[] | undefined, extra: T[] | undefined): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const source of [...(base ?? []), ...(extra ?? [])]) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    merged.push(source);
  }
  return merged;
}

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.get("/api/presets", async (_req, res) => {
  res.json(await listPresets());
});

/**
 * In-memory cache of the full official country list (fetched once per
 * process — the list of ~195 countries is effectively static). Powers
 * QuizFlow's CountryStep so country selection is validated against real
 * countries instead of accepting arbitrary free text.
 */
let countryListCache: string[] | null = null;

/**
 * Full list of real country names, used so the "Country" quiz step is a
 * search-only picker (like City/University) instead of accepting any typed
 * text. Small enough (~195 entries) to send in one response and let the
 * frontend filter locally rather than round-tripping per keystroke.
 */
app.get("/api/countries", async (_req, res) => {
  if (countryListCache) {
    res.json(countryListCache);
    return;
  }
  try {
    const response = await fetch("https://countriesnow.space/api/v0.1/countries/positions");
    if (!response.ok) {
      res.json([]);
      return;
    }
    const payload = (await response.json()) as { error?: boolean; data?: { name: string }[] };
    const names = !payload.error && Array.isArray(payload.data) ? payload.data.map((c) => c.name).sort() : [];
    countryListCache = names;
    res.json(names);
  } catch {
    res.json([]);
  }
});

/**
 * Proxies university name search to the free Hipolabs University API
 * (universities.hipolabs.com) so QuizFlow's UniversityStep can search
 * universities beyond the small offline curated list (e.g. China, Germany,
 * anywhere) — without the browser calling it directly, since that API does
 * not send CORS headers and a same-origin browser fetch would just fail
 * silently. Best-effort: any failure (network, timeout, non-2xx) resolves
 * to an empty array rather than an error, so the frontend's manual
 * country/city fallback still works if this is unreachable.
 */
/**
 * In-memory cache of {country|city -> bounding box}, used to scope the
 * university search to the actual chosen city (see below) without
 * re-geocoding on every keystroke of a debounced search.
 */
const cityBboxCache = new Map<string, [string, string, string, string] | null>();

/** Nominatim (OpenStreetMap) requires a descriptive User-Agent identifying
 * the app per its usage policy — a generic/browser-like UA can get requests
 * throttled or blocked. */
const NOMINATIM_USER_AGENT = "FutureLifeSimulator/1.0 (study-abroad game prototype)";

async function geocodeCityBbox(country: string, city: string): Promise<[string, string, string, string] | null> {
  const key = `${country.trim().toLowerCase()}|${city.trim().toLowerCase()}`;
  if (cityBboxCache.has(key)) return cityBboxCache.get(key) ?? null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const params = new URLSearchParams({ city, country, format: "json", limit: "1" });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
    });
    if (!res.ok) {
      cityBboxCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { boundingbox?: [string, string, string, string] }[];
    const box = data[0]?.boundingbox ?? null;
    cityBboxCache.set(key, box);
    return box;
  } catch {
    cityBboxCache.set(key, null);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Accurate, city-scoped university search via OpenStreetMap/Nominatim: geocodes
 * the chosen city to a bounding box, then free-text-searches within that box
 * only, keeping just amenity/building results tagged as an actual
 * university/college. This is what actually fixes "Columbia University"
 * (New York) showing up as a suggestion for "Santa Clara" — the previous
 * Hipolabs-backed search only ever scoped by country (it has no per-record
 * city field to filter on), so any query text matched regardless of city.
 * Returns null (not []) when the city itself couldn't be geocoded, so the
 * caller can fall back to the country-only search instead of silently
 * showing zero results for a real but unrecognized city.
 *
 * Runs two bounded queries in parallel: the raw typed text, and the same
 * text with " university"/" college" appended. Nominatim's free-text search
 * behaves like a geocoder (best single place match) rather than a full
 * substring POI index, so a bare query like "santa clara" alone resolves to
 * the city's own boundary and never surfaces "Santa Clara University" —
 * appending the keyword nudges it toward the actual campus entry while the
 * raw-text query still wins for exact/partial official names typed as-is
 * (e.g. "columbia").
 */
async function searchUniversitiesInCity(
  name: string,
  country: string,
  city: string,
): Promise<{ name: string; country: string }[] | null> {
  const bbox = await geocodeCityBbox(country, city);
  if (!bbox) return null;
  const [south, north, west, east] = bbox;
  const viewbox = `${west},${north},${east},${south}`;

  async function boundedSearch(query: string): Promise<{ name: string; type: string }[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const params = new URLSearchParams({ q: query, format: "json", limit: "20", viewbox, bounded: "1" });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
      });
      if (!res.ok) return [];
      return (await res.json()) as { name: string; type: string }[];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  const lowerName = name.toLowerCase();
  const alreadyHasKeyword = /\b(university|college)\b/.test(lowerName);
  const [rawResults, keywordResults] = await Promise.all([
    boundedSearch(name),
    alreadyHasKeyword ? Promise.resolve([]) : boundedSearch(`${name} university`),
  ]);

  const seen = new Set<string>();
  const results: { name: string; country: string }[] = [];
  for (const entry of [...rawResults, ...keywordResults]) {
    if (entry.type !== "university" && entry.type !== "college") continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ name: entry.name, country });
  }
  return results.slice(0, 8);
}

app.get("/api/universities/search", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  if (!name && !country) {
    res.json([]);
    return;
  }

  // When a city is known, prefer the geocode-bounded OSM search — it's the
  // only source here that's actually scoped to the real city, not just the
  // country. Only fall back to the country-wide Hipolabs search below if
  // the city couldn't be geocoded at all (unusual/misspelled city name).
  if (name && city) {
    const cityScoped = await searchUniversitiesInCity(name, country, city);
    if (cityScoped !== null) {
      res.json(cityScoped);
      return;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (country) params.set("country", country);

    // The upstream Hipolabs API's own `name` search is a raw/unranked
    // substring match with known gaps in its index — e.g. searching
    // "northeastern" + country=United States never surfaces the real
    // Northeastern University (Boston) at all, even though the exact same
    // record IS found via a domain lookup (domain=northeastern.edu). So,
    // alongside the normal name search, also try a domain-guess lookup
    // (e.g. "Northeastern University" -> northeastern.edu) as a second,
    // parallel request — cheap, and it rescues exactly this class of
    // missing-from-name-index school.
    const domainGuess = name
      .toLowerCase()
      .replace(/\b(university|college|institute|of|the)\b/g, "")
      .replace(/[^a-z]/g, "");
    // Deliberately omit `country` here: Hipolabs' upstream API appears to
    // ignore/mis-combine domain+country together (returns effectively the
    // whole country's university list instead of filtering), so the
    // country match is done client-side below instead.
    const domainParams = new URLSearchParams();
    if (domainGuess.length >= 4) domainParams.set("domain", `${domainGuess}.edu`);

    const [nameRes, domainRes] = await Promise.all([
      fetch(`http://universities.hipolabs.com/search?${params.toString()}`, { signal: controller.signal }),
      domainGuess.length >= 4
        ? fetch(`http://universities.hipolabs.com/search?${domainParams.toString()}`, { signal: controller.signal }).catch(
            () => undefined,
          )
        : Promise.resolve(undefined),
    ]);

    type UniRecord = { name: string; country: string; alpha_two_code?: string };
    const nameData: UniRecord[] = nameRes.ok ? await nameRes.json() : [];
    let domainData: UniRecord[] = domainRes && domainRes.ok ? await domainRes.json() : [];
    if (country) {
      const countryLower = country.toLowerCase();
      domainData = domainData.filter((entry) => entry.country.toLowerCase() === countryLower);
    }


    const seen = new Set<string>();
    const merged: UniRecord[] = [];
    // Domain-guess hits go first — they're the most likely exact intended
    // match when the plain name search missed or buried it.
    for (const entry of [...domainData, ...nameData]) {
      const key = `${entry.name.toLowerCase()}|${entry.country}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }

    // Relevance rank the rest instead of trusting the upstream's raw
    // (effectively alphabetical) order, which routinely buries the actual
    // intended school behind unrelated same-prefix schools — e.g.
    // "Northeastern Junior/Louisiana/State/Technical..." sort before
    // "Northeastern University" purely alphabetically.
    const q = name.trim().toLowerCase();
    const rank = (entry: UniRecord): number => {
      const n = entry.name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(` ${q}`) || n.includes(`${q} `)) return 2;
      return 3;
    };
    merged.sort((a, b) => rank(a) - rank(b));

    res.json(merged.slice(0, 8).map((entry) => ({ name: entry.name, country: entry.country })));
  } catch {
    res.json([]);
  } finally {
    clearTimeout(timeout);
  }
});

/**
 * In-memory cache of {country -> full city list}, keyed lowercase. The
 * upstream API (see below) only supports "give me every city in this
 * country", not a name-filtered query, so we fetch a country's full list
 * once and filter/rank it locally on every subsequent request — avoids
 * re-fetching the same (sometimes 10k+ entry) list on every keystroke.
 * Never expires within a run: city lists don't change during a session,
 * and a hackathon-scope process restart is an acceptable cache-bust.
 */
const cityListCache = new Map<string, string[]>();

async function fetchCitiesForCountry(country: string): Promise<string[]> {
  const key = country.trim().toLowerCase();
  const cached = cityListCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://countriesnow.space/api/v0.1/countries/cities/q?country=${encodeURIComponent(country)}`,
      { signal: controller.signal },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { error?: boolean; data?: string[] };
    const cities = !payload.error && Array.isArray(payload.data) ? payload.data : [];
    cityListCache.set(key, cities);
    return cities;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Live, accurate worldwide city search scoped to a country, backing
 * QuizFlow's CityStep. Needed because our offline curated city list
 * (frontend/src/data/universities.ts) only contains the handful of cities
 * that already have a hand-authored university entry — e.g. no "Santa
 * Barbara"/"Santa Cruz"/"Santa Fe" for the US — so typing any real city
 * outside that tiny set previously had nowhere to go. Proxied through the
 * backend (like /api/universities/search) since the upstream API has no
 * CORS headers for a same-origin browser fetch. Best-effort: any failure
 * resolves to an empty array so the curated chips + manual free-text entry
 * in CityStep still work if this is unreachable.
 */
app.get("/api/cities/search", async (req, res) => {
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!country) {
    res.json([]);
    return;
  }

  try {
    const allCities = await fetchCitiesForCountry(country);
    const q = name.toLowerCase();
    const matches = q ? allCities.filter((city) => city.toLowerCase().includes(q)) : allCities;

    // Relevance rank: exact match, then starts-with, then contains — same
    // pattern as /api/universities/search, so "Santa" surfaces "Santa
    // Barbara"/"Santa Cruz"/"Santa Fe"/etc. before unrelated cities that
    // merely contain "santa" mid-word.
    const rank = (city: string): number => {
      const c = city.toLowerCase();
      if (c === q) return 0;
      if (c.startsWith(q)) return 1;
      return 2;
    };
    matches.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    res.json(matches.slice(0, 8));
  } catch {
    res.json([]);
  }
});

/**
 * Quick connectivity check against the configured OpenAI (or relay) endpoint.
 * Confirms OPENAI_API_KEY + OPENAI_BASE_URL are working before running the
 * full pipeline. Uses the cheap design model with a trivial prompt.
 */
app.get("/api/health/openai", async (_req, res) => {
  try {
    const { getOpenAIClient } = await import("./agents/openaiClient.js");
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: config.models.design,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 5,
    });
    res.json({ ok: true, model: config.models.design, reply: completion.choices[0]?.message?.content });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

/**
 * Debug: list all past pipeline runs (each run = one story_id directory
 * under /data/runs with per-stage output + log.txt).
 */
app.get("/api/runs", async (_req, res) => {
  res.json(await listRuns());
});

/**
 * Debug: fetch every stage file (meta, search report, design skeleton,
 * artist final, log.txt) for a single run, to inspect what each agent
 * actually produced for that story_id.
 */
app.get("/api/runs/:storyId", async (req, res) => {
  try {
    res.json(await readRunFiles(req.params.storyId));
  } catch (err) {
    res.status(404).json({ error: `Run not found: ${req.params.storyId}` });
  }
});

/** Reference-only currency conversion for reader-facing cost annotations.
 * The original amount always stays visible; rates are cached for six hours. */
app.get("/api/exchange-rate", async (req, res) => {
  const base = String(req.query.base ?? "").trim().toUpperCase();
  const quote = String(req.query.quote ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(base) || (quote !== "CNY" && quote !== "LKR")) {
    res.status(400).json({ error: "Use a three-letter base currency and quote CNY or LKR." });
    return;
  }

  const cacheKey = `${base}:${quote}`;
  const cached = exchangeRateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.payload);
    return;
  }

  try {
    const payload: ExchangeRatePayload = base === quote
      ? { base, quote, rate: 1, date: new Date().toISOString().slice(0, 10), source: "Frankfurter" }
      : await (async () => {
          const upstream = await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${quote}`);
          if (!upstream.ok) throw new Error(`Exchange-rate provider returned ${upstream.status}`);
          const raw = await upstream.json() as { base?: unknown; quote?: unknown; rate?: unknown; date?: unknown };
          if (typeof raw.rate !== "number" || !Number.isFinite(raw.rate) || typeof raw.date !== "string") {
            throw new Error("Exchange-rate provider returned invalid data");
          }
          return { base, quote, rate: raw.rate, date: raw.date, source: "Frankfurter" };
        })();
    exchangeRateCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1_000, payload });
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not load exchange rate." });
  }
});

/** Returns only the final playable document. The player must not download all
 * intermediate prompts and per-node generation artifacts just to open a run. */
app.get("/api/stories/:storyId", async (req, res) => {
  const storyId = sanitizeStoryId(req.params.storyId);
  try {
    const cached = await readCachedStory(storyId);
    if (cached) {
      res.json(cached);
      return;
    }
    const raw = await fs.readFile(path.join(RUNS_DIR, storyId, "09_final_story.json"), "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: `Final story not found: ${storyId}` });
  }
});

/**
 * Starts the full post-offer demo generator as a background job. This is the
 * long multi-call pipeline in backend/scripts/fullPostOfferGenerator.ts:
 * research adaptation -> per-node planning -> supervisor repair -> content
 * fill -> variable variants -> simulation/validation -> 09_final_story.json.
 */
app.post("/api/full-generate", async (req, res) => {
  const {
    runtimeConfig: rawRuntimeConfig,
    profile,
    storyId: requestedStoryId,
    regenerate,
    model: requestedModel,
  } = req.body as {
    runtimeConfig?: unknown;
    profile?: UserProfile;
    storyId?: string;
    regenerate?: boolean;
    model?: string;
  };

  let runtimeConfig: RuntimeConfig | undefined;
  try {
    runtimeConfig = resolveRuntimeConfig(rawRuntimeConfig, "live_search");
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const baseStoryId = buildFullGenerationStoryId(profile, runtimeConfig);
  const storyId =
    typeof requestedStoryId === "string" && requestedStoryId.trim()
      ? sanitizeStoryId(requestedStoryId)
      : regenerate
        ? `${baseStoryId}_${Date.now()}`
        : baseStoryId;

  const existingJob = fullGenerationJobs.get(storyId);
  if (existingJob?.status === "running") {
    res.json(await fullGenerationStatus(existingJob));
    return;
  }

  if (!regenerate && (await hasFullGeneratorFinalStory(storyId))) {
    const now = new Date().toISOString();
    const completedJob: FullGenerationJob = {
      storyId,
      status: "completed",
      startedAt: now,
      updatedAt: now,
      completedAt: now,
      lines: [`Reusing existing full generated run ${storyId}.`],
    };
    fullGenerationJobs.set(storyId, completedJob);
    res.json(await fullGenerationStatus(completedJob));
    return;
  }

  const textService = runtimeConfig?.services?.text;
  const searchService = runtimeConfig?.services?.search;
  const imageService = runtimeConfig?.services?.image;
  const textApiKey = textService?.apiKey?.trim() || runtimeConfig?.apiKey?.trim() || process.env.GCLI_API_KEY || process.env.OPENAI_API_KEY || "";
  const searchApiKey = searchService?.apiKey?.trim() || process.env.OPENAI_API_KEY || "";
  const imageApiKey = imageService?.apiKey?.trim() || process.env.OPENAI_API_KEY || "";
  if (!textApiKey.trim()) {
    res.status(400).json({ error: "Full generator needs a text API key from the browser or backend .env." });
    return;
  }

  const model = requestedModel?.trim() || textService?.model?.trim() || process.env.GCLI_MODEL || "gemini-3-flash-preview";
  const now = new Date().toISOString();
  const job: FullGenerationJob = {
    storyId,
    status: "running",
    startedAt: now,
    updatedAt: now,
    lines: [],
  };
  fullGenerationJobs.set(storyId, job);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FULL_DEMO_STORY_ID: storyId,
    FULL_PROFILE_JSON: JSON.stringify(profile ?? MANUAL_FULL_GENERATOR_PROFILE),
    FULL_OUTPUT_LANGUAGE: runtimeConfig?.outputLanguage === "zh" ? "zh" : "en",
    FULL_ENABLE_LIVE_RESEARCH: String(runtimeConfig?.features.enableLiveSearch ?? true),
    FULL_ENABLE_IMAGE_GENERATION: String(runtimeConfig?.features.enableImageGeneration ?? false),
    FULL_MAX_IMAGES: String(runtimeConfig?.features.maxImagesPerStory ?? 0),
    FULL_RESUME_CHECKPOINT: String(!regenerate && (await hasFullGeneratorPlanningCheckpoint(storyId))),
  };

  if (textService?.provider === "relay") {
    env.TEXT_API_KEY = textApiKey;
    env.TEXT_BASE_URL = textService.baseURL || process.env.GCLI_BASE_URL || process.env.OPENAI_BASE_URL || "https://gcli.ggchan.dev/v1";
    env.TEXT_MODEL = model;
    env.GCLI_API_KEY = textApiKey;
    env.GCLI_BASE_URL = env.TEXT_BASE_URL;
    env.GCLI_MODEL = model;
  } else {
    env.TEXT_API_KEY = textApiKey;
    env.TEXT_BASE_URL = textService?.baseURL || "https://api.openai.com/v1";
    env.TEXT_MODEL = model;
    env.OPENAI_API_KEY = textApiKey;
    env.OPENAI_BASE_URL = env.TEXT_BASE_URL;
  }
  env.RESEARCH_API_KEY = searchApiKey;
  env.RESEARCH_BASE_URL = searchService?.provider === "relay" ? searchService.baseURL : "https://api.openai.com/v1";
  env.RESEARCH_MODEL = searchService?.model || runtimeConfig?.models.search || config.models.search;
  env.IMAGE_API_KEY = imageApiKey;
  env.IMAGE_BASE_URL = imageService?.provider === "relay" ? imageService.baseURL : "https://api.openai.com/v1";
  env.IMAGE_MODEL = imageService?.model || runtimeConfig?.models.image || config.models.image;

  appendFullJobLine(job, `[full-generator] starting story_id=${storyId} model=${model}`);
  const child = spawn(tsxCommand(), tsxArgs(), {
    cwd: process.cwd(),
    env,
    shell: false,
    windowsHide: true,
  });
  job.pid = child.pid;

  child.stdout?.on("data", (chunk: Buffer) => {
    chunk.toString("utf8").split(/\r?\n/).forEach((line) => appendFullJobLine(job, line));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    chunk.toString("utf8").split(/\r?\n/).forEach((line) => appendFullJobLine(job, line));
  });
  child.on("error", (err) => {
    job.status = "failed";
    job.error = err.message;
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    appendFullJobLine(job, `[full-generator] failed to start: ${err.message}`);
  });
  child.on("exit", async (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.updatedAt = new Date().toISOString();
    job.completedAt = job.updatedAt;
    if (code === 0 && (await hasFullGeneratorFinalStory(storyId))) {
      job.status = "completed";
      appendFullJobLine(job, `[full-generator] completed story_id=${storyId}`);
    } else {
      job.status = "failed";
      job.error = code === 0
        ? "Full generator exited without producing 09_final_story.json."
        : `Full generator exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}.`;
      appendFullJobLine(job, `[full-generator] ${job.error}`);
    }
  });

  res.status(202).json(await fullGenerationStatus(job));
});

app.get("/api/full-generate/:storyId/status", async (req, res) => {
  const storyId = sanitizeStoryId(req.params.storyId);
  const job = fullGenerationJobs.get(storyId);
  if (job) {
    res.json(await fullGenerationStatus(job));
    return;
  }

  if (await hasFullGeneratorFinalStory(storyId)) {
    const now = new Date().toISOString();
    res.json(
      await fullGenerationStatus({
        storyId,
        status: "completed",
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        lines: [`Found completed full generated run ${storyId}.`],
      }),
    );
    return;
  }

  res.status(404).json({ error: `Full generation job not found: ${storyId}` });
});

/**
 * Local demo convenience: shuts down the backend and, on Windows, closes the
 * frontend terminal window opened by start.bat.
 */
app.post("/api/shutdown", (_req, res) => {
  res.json({ ok: true, message: "Future Life Simulator is shutting down." });

  setTimeout(() => {
    if (process.platform === "win32") {
      exec('taskkill /FI "WINDOWTITLE eq Future Life Simulator Frontend*" /T /F', () => {
        process.exit(0);
      });
      return;
    }

    process.exit(0);
  }, 250);
});

/**
 * Body: { mode: "preset", presetId: string } | { mode: "live_search", profile: UserProfile }
 * Runs Search -> Design/Logic -> Artist and returns/saves the final story JSON.
 * Every stage's raw output is also persisted under /data/runs/{storyId}/
 * for debugging (see runLogger.ts) — use GET /api/runs/:storyId to inspect.
 */
app.post("/api/generate", async (req, res) => {
  const {
    mode,
    presetId,
    profile,
    runtimeConfig: rawRuntimeConfig,
    storyId: requestedStoryId,
    regenerate,
    flowVersion,
  } = req.body as {
    mode: "preset" | "live_search";
    presetId?: string;
    profile?: UserProfile;
    runtimeConfig?: unknown;
    storyId?: string;
    regenerate?: boolean;
    flowVersion?: FlowVersion;
  };
  const resolvedFlowVersion: FlowVersion = flowVersion === "post_offer_v1" ? "post_offer_v1" : "legacy";

  // Derive the cache key from the raw (unvalidated) model names only, so a
  // cache-reuse attempt never requires full provider validation (API key,
  // relay base URL) just to check whether a matching story already exists.
  // Full validation (resolveRuntimeConfig) happens below, and only actually
  // runs if we get past the cache check.
  const rawRuntime = rawRuntimeConfig as
    | { models?: Partial<RuntimeConfig["models"]>; services?: Partial<Record<RuntimeService, RawRuntimeServiceConfig>> }
    | undefined;
  const rawModels = rawRuntime?.models;
  const rawServices = rawRuntime?.services;
  const rawOutputLanguage = (rawRuntimeConfig as { outputLanguage?: RuntimeConfig["outputLanguage"] } | undefined)?.outputLanguage === "zh" ? "zh" : "en";
  const cacheModels: RuntimeConfig["models"] = {
    search: rawServices?.search?.model?.trim() || rawModels?.search?.trim() || config.models.search,
    design: rawServices?.text?.model?.trim() || rawModels?.design?.trim() || config.models.design,
    image: rawServices?.image?.model?.trim() || rawModels?.image?.trim() || config.models.image,
  };
  const cacheStoryId = buildCacheStoryId(mode, presetId, profile, { models: cacheModels, outputLanguage: rawOutputLanguage } as RuntimeConfig, resolvedFlowVersion);
  const storyId =
    typeof requestedStoryId === "string" && requestedStoryId.trim()
      ? sanitizeStoryId(requestedStoryId)
      : regenerate
        ? `${cacheStoryId}_${Date.now()}`
        : cacheStoryId;

  if (!regenerate) {
    const cached = await readCachedStory(storyId);
    if (cached && hasEnoughCachedImages(cached, rawRuntimeConfig)) {
      res.json({ ...prepareCachedStoryForResponse(cached, rawRuntimeConfig), cached: true });
      return;
    }
    // Fallback for stories cached before the "semesters" onboarding field
    // existed: their cache key was hashed without a semesters value at all,
    // so a legacy story can never be found once the (now-mandatory) slider
    // always sends a number. Recompute the hash the same way but with
    // semesters stripped from the profile, and serve that legacy story if
    // it exists — the player's chosen semester count just doesn't apply to
    // stories generated before it was configurable.
    if (mode === "live_search" && profile?.semesters !== undefined) {
      const { semesters: _semesters, ...legacyProfile } = profile;
      const legacyStoryId = buildCacheStoryId(mode, presetId, legacyProfile, { models: cacheModels, outputLanguage: rawOutputLanguage } as RuntimeConfig, resolvedFlowVersion);
      const legacyCached = await readCachedStory(legacyStoryId);
      if (legacyCached && hasEnoughCachedImages(legacyCached, rawRuntimeConfig)) {
        res.json({ ...prepareCachedStoryForResponse(legacyCached, rawRuntimeConfig), cached: true });
        return;
      }
    }
  }

  const logger = new RunLogger(storyId);

  try {
    // Only validated once we know we actually need to call an agent —
    // this can throw (e.g. relay mode with no base URL), which is now
    // safely caught below instead of hanging the request.
    const runtimeConfig = resolveRuntimeConfig(rawRuntimeConfig, mode);

    await logger.init({ mode, presetId, profile, flowVersion: resolvedFlowVersion, runtimeConfig: getSafeRuntimeConfig(runtimeConfig) });

    logger.startStage("search");
    const report =
      mode === "preset"
        ? await runSearchAgentPreset(presetId ?? "tokyo_cs")
        : await runSearchAgentLive(profile as UserProfile, runtimeConfig);
    await logger.endStage("search", "01_search_report.json", report);

    let skeleton: StoryDocument;
    if (resolvedFlowVersion === "post_offer_v1") {
      logger.startStage("logic");
      const logicGraph = await runLogicGraphAgent(report, storyId, runtimeConfig);
      await logger.endStage("logic", "02_logic_graph.json", logicGraph);

      logger.startStage("compile");
      skeleton = compileLogicGraphToStoryDocument(logicGraph, report, storyId, runtimeConfig?.outputLanguage ?? "en");
      await logger.endStage("compile", "03_compiled_story.json", skeleton);
    } else {
      logger.startStage("design");
      skeleton = await runDesignAgent(report, storyId, runtimeConfig, profile?.semesters);
      await logger.endStage("design", "02_design_skeleton.json", skeleton);
    }

    logger.startStage("artist");
    const final = await runArtistAgent(skeleton, runtimeConfig);
    await logger.endStage("artist", resolvedFlowVersion === "post_offer_v1" ? "04_artist_final.json" : "03_artist_final.json", final);

    // Carry the Search Agent's cited sources through to the saved/served
    // document so the Field Notes panel can link players to where the
    // story's facts actually came from. Also include fine-grained campus
    // URLs (faculty profiles, course pages, libraries, clubs, events), since
    // these are stored on campus_life_profile rather than report.sources.
    final.sources = mergeSources(report.sources, campusLifeSources(report));

    await fs.mkdir(STORIES_DIR, { recursive: true });
    await fs.writeFile(
      path.join(STORIES_DIR, `${storyId}_final.json`),
      JSON.stringify(final, null, 2),
    );
    await logger.flush();

    res.json(final);
  } catch (err) {
    console.error(err);
    await logger.fail("pipeline", err);
    res.status(500).json({ error: String(err instanceof Error ? err.message : err), storyId });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Config: liveSearch=${config.features.enableLiveSearch}, imageGen=${config.features.enableImageGeneration}`);
});
