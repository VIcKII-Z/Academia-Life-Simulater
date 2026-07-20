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
const MIN_RECOMMENDED_IMAGES = 6;
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

function hasEnoughCachedImages(cached: unknown, rawRuntimeConfig: unknown): boolean {
  const raw = rawRuntimeConfig as { features?: Partial<RuntimeConfig["features"]> } | undefined;
  const enableImageGeneration = raw?.features?.enableImageGeneration ?? config.features.enableImageGeneration;
  if (!enableImageGeneration) return true;

  const maxImagesPerStory = raw?.features?.maxImagesPerStory ?? config.features.maxImagesPerStory;
  const minimumImages = Math.min(maxImagesPerStory, MIN_RECOMMENDED_IMAGES);
  return minimumImages <= 0 || countGeneratedImages(cached) >= minimumImages;
}

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.get("/api/presets", async (_req, res) => {
  res.json(await listPresets());
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
app.get("/api/universities/search", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  if (!name && !country) {
    res.json([]);
    return;
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
      res.json({ ...(cached as object), cached: true });
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
        res.json({ ...(legacyCached as object), cached: true });
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
