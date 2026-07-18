import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, UserProfile } from "../types.js";

const PRESETS_DIR = path.resolve(process.cwd(), "..", "data", "presets");

/**
 * Preset mode: read a hand-authored research report from /data/presets.
 * File naming convention: {city}_{major-slug}.json (lowercase, underscores).
 */
export async function runSearchAgentPreset(presetId: string): Promise<ResearchReport> {
  const filePath = path.join(PRESETS_DIR, `${presetId}.json`);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as ResearchReport;
}

export async function listPresets(): Promise<string[]> {
  const files = await fs.readdir(PRESETS_DIR);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

const SEARCH_SYSTEM_PROMPT = `You are a study-abroad research AI. Given a user's specified
"country + city + major + grade level," gather and compile a structured research report.

For each of the following 9 dimensions, produce a 100-150 word objective summary that
includes both positive and negative factors where relevant: cost of living, academic/major fit,
visa & status, cultural adaptation, community & support, career prospects, safety, climate,
part-time work policy.

If a dimension yields no reliable information, use "No reliable information available." Do not fabricate.

Output strictly this JSON structure, no extra text:
{
  "mode": "live_search",
  "location": { "country": "string", "city": "string" },
  "major": "string",
  "grade": "string",
  "report": {
    "cost_of_living": "string", "academic": "string", "visa": "string",
    "culture_shock": "string", "community": "string", "career": "string",
    "safety": "string", "climate": "string", "part_time_work": "string"
  }
}`;

/**
 * Live mode: use OpenAI web_search tool to research and summarize.
 * Only runs when config.features.enableLiveSearch is true.
 */
export async function runSearchAgentLive(profile: UserProfile): Promise<ResearchReport> {
  if (!config.features.enableLiveSearch) {
    throw new Error("Live search is disabled in config.ts (features.enableLiveSearch=false)");
  }
  const client = getOpenAIClient();
  const response = await client.responses.create({
    model: config.models.search,
    tools: [{ type: "web_search_preview" }],
    input: `${SEARCH_SYSTEM_PROMPT}\n\nUser input: country=${profile.country}, city=${profile.city}, major=${profile.major}, grade=${profile.grade}`,
  });

  const text = response.output_text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Search Agent did not return valid JSON");
  return JSON.parse(jsonMatch[0]) as ResearchReport;
}
