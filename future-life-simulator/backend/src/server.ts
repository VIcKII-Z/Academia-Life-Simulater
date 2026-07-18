import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config/config.js";
import { runSearchAgentPreset, runSearchAgentLive, listPresets } from "./agents/searchAgent.js";
import { runDesignAgent } from "./agents/designAgent.js";
import { runArtistAgent } from "./agents/artistAgent.js";
import { RunLogger, listRuns, readRunFiles } from "./runLogger.js";
import type { UserProfile } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const STORIES_DIR = path.resolve(process.cwd(), "..", "data", "stories");
const ASSETS_DIR = path.resolve(process.cwd(), "..", "data", "assets");
app.use("/assets", express.static(ASSETS_DIR));

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.get("/api/presets", async (_req, res) => {
  res.json(await listPresets());
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
 * Body: { mode: "preset", presetId: string } | { mode: "live_search", profile: UserProfile }
 * Runs Search -> Design -> Artist and returns/saves the final story JSON.
 * Every stage's raw output is also persisted under /data/runs/{storyId}/
 * for debugging (see runLogger.ts) — use GET /api/runs/:storyId to inspect.
 */
app.post("/api/generate", async (req, res) => {
  const { mode, presetId, profile } = req.body as {
    mode: "preset" | "live_search";
    presetId?: string;
    profile?: UserProfile;
  };

  const storyId = `${(presetId ?? profile?.city ?? "story").toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
  const logger = new RunLogger(storyId);
  await logger.init({ mode, presetId, profile });

  try {
    logger.startStage("search");
    const report =
      mode === "preset"
        ? await runSearchAgentPreset(presetId ?? "tokyo_cs")
        : await runSearchAgentLive(profile as UserProfile);
    await logger.endStage("search", "01_search_report.json", report);

    logger.startStage("design");
    const skeleton = await runDesignAgent(report, storyId);
    await logger.endStage("design", "02_design_skeleton.json", skeleton);

    logger.startStage("artist");
    const final = await runArtistAgent(skeleton);
    await logger.endStage("artist", "03_artist_final.json", final);

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
