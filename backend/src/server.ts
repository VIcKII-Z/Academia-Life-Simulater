import "dotenv/config";
import express from "express";
import cors from "cors";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config/config.js";
import { runSearchAgentPreset, runSearchAgentLive, listPresets } from "./agents/searchAgent.js";
import { runDesignAgent } from "./agents/designAgent.js";
import { runArtistAgent } from "./agents/artistAgent.js";
import { RunLogger, listRuns, readRunFiles } from "./runLogger.js";
import type { Provider, RuntimeConfig, UserProfile } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const STORIES_DIR = path.resolve(process.cwd(), "..", "data", "stories");
const ASSETS_DIR = path.resolve(process.cwd(), "..", "data", "assets");
app.use("/assets", express.static(ASSETS_DIR));

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
    throw new Error("Relay base URL is invalid. Use an OpenAI-compatible API base URL, for example: https://xuedingmao.top/v1");
  }
}

function resolveRuntimeConfig(input: unknown, mode: "preset" | "live_search"): RuntimeConfig | undefined {
  if (!input || typeof input !== "object") return undefined;

  const raw = input as {
    provider?: Provider;
    apiKey?: string;
    baseURL?: string;
    models?: Partial<RuntimeConfig["models"]>;
    features?: Partial<RuntimeConfig["features"]>;
  };

  const provider: Provider = raw.provider === "relay" ? "relay" : "openai";
  const apiKey = raw.apiKey?.trim();
  const baseURL = raw.baseURL?.trim();

  if (provider === "relay" && !baseURL) {
    throw new Error("Relay mode requires a relay base URL.");
  }

  return {
    provider,
    apiKey,
    baseURL: provider === "relay" ? normalizeRelayBaseURL(baseURL as string) : undefined,
    models: {
      search: raw.models?.search?.trim() || config.models.search,
      design: raw.models?.design?.trim() || config.models.design,
      image: raw.models?.image?.trim() || config.models.image,
    },
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
  const { apiKey: _apiKey, ...safeConfig } = runtimeConfig;
  return safeConfig;
}

function sanitizeStoryId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
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
): string {
  const keyPayload = canonicalize(
    {
      mode,
      presetId: mode === "preset" ? presetId ?? "tokyo_cs" : undefined,
      profile: mode === "live_search" ? profile : undefined,
      models: runtimeConfig?.models,
    },
    true,
  );
  const hash = createHash("sha1").update(JSON.stringify(keyPayload)).digest("hex").slice(0, 12);
  const seed = mode === "preset" ? presetId ?? "story" : profile?.city ?? "story";
  return `${sanitizeStoryId(seed)}_${hash}`;
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
 * Runs Search -> Design -> Artist and returns/saves the final story JSON.
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
  } = req.body as {
    mode: "preset" | "live_search";
    presetId?: string;
    profile?: UserProfile;
    runtimeConfig?: unknown;
    storyId?: string;
    regenerate?: boolean;
  };

  // Derive the cache key from the raw (unvalidated) model names only, so a
  // cache-reuse attempt never requires full provider validation (API key,
  // relay base URL) just to check whether a matching story already exists.
  // Full validation (resolveRuntimeConfig) happens below, and only actually
  // runs if we get past the cache check.
  const rawModels = (rawRuntimeConfig as { models?: Partial<RuntimeConfig["models"]> } | undefined)?.models;
  const cacheModels: RuntimeConfig["models"] = {
    search: rawModels?.search?.trim() || config.models.search,
    design: rawModels?.design?.trim() || config.models.design,
    image: rawModels?.image?.trim() || config.models.image,
  };
  const cacheStoryId = buildCacheStoryId(mode, presetId, profile, { models: cacheModels } as RuntimeConfig);
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
      const legacyStoryId = buildCacheStoryId(mode, presetId, legacyProfile, { models: cacheModels } as RuntimeConfig);
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

    await logger.init({ mode, presetId, profile, runtimeConfig: getSafeRuntimeConfig(runtimeConfig) });

    logger.startStage("search");
    const report =
      mode === "preset"
        ? await runSearchAgentPreset(presetId ?? "tokyo_cs")
        : await runSearchAgentLive(profile as UserProfile, runtimeConfig);
    await logger.endStage("search", "01_search_report.json", report);

    logger.startStage("design");
    const skeleton = await runDesignAgent(report, storyId, runtimeConfig, profile?.semesters);
    await logger.endStage("design", "02_design_skeleton.json", skeleton);

    logger.startStage("artist");
    const final = await runArtistAgent(skeleton, runtimeConfig);
    await logger.endStage("artist", "03_artist_final.json", final);

    // Carry the Search Agent's cited sources through to the saved/served
    // document so the Field Notes panel can link players to where the
    // story's facts actually came from.
    final.sources = report.sources;

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
