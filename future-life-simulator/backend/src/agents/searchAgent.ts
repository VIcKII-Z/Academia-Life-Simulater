import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, RuntimeConfig, UserProfile } from "../types.js";

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

Also extract game-design signals for a survival-style study-abroad game with three player stats:
- health: physical safety, sleep, climate stress, food, commuting fatigue, medical access.
- mood: loneliness, culture shock, academic pressure, community support, belonging.
- money: rent, daily expenses, scholarships, part-time work, internship/career income.

The gameplay signals must be specific to the requested city, major, and grade level. Do not write
generic "student abroad" challenges. A PhD in Japan should feel different from an undergraduate in
New York: research supervision, lab culture, publishing pressure, visa duration, funding, housing,
campus routines, internships, nightlife, language expectations, and social networks should change
based on the profile. For example, Tokyo + Computer Science + PhD should mention long commutes,
humid summers, lab workload, advisor hierarchy, research deadlines, language barriers, rent pressure,
tech internship upside, and Japanese ability tradeoffs where supported by research.

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
  },
  "gameplay_signals": {
    "health": ["3-5 concrete health-related pressure/opportunity signals"],
    "mood": ["3-5 concrete mood-related pressure/opportunity signals"],
    "money": ["3-5 concrete money-related pressure/opportunity signals"],
    "city_major_specific_challenges": ["6-8 challenge ideas grounded in this city + major + grade"]
  }
}`;

function explainLiveSearchError(err: unknown, runtimeConfig?: RuntimeConfig): Error {
  const message = err instanceof Error ? err.message : String(err);
  const returnedHtml =
    message.includes("<!DOCTYPE html") ||
    message.includes("<html") ||
    message.includes("Cannot use 'in' operator");

  if (returnedHtml) {
    return new Error(
      `Search Agent received an HTML page instead of OpenAI JSON. Check that the relay base URL is an API endpoint such as "https://xuedingmao.top/v1", not a dashboard/web page URL. Current baseURL: ${runtimeConfig?.baseURL ?? "OpenAI default"}`,
    );
  }

  if (runtimeConfig?.provider === "relay") {
    return new Error(
      `Live Search failed through the relay. This path uses the OpenAI Responses API with web_search_preview, which many relays do not support. Use official OpenAI for live_search, or confirm the relay supports /responses and web_search_preview. Original error: ${message}`,
    );
  }

  return new Error(`Live Search failed. Original error: ${message}`);
}

/**
 * Live mode: use OpenAI web_search tool to research and summarize.
 * Only runs when config.features.enableLiveSearch is true.
 */
export async function runSearchAgentLive(profile: UserProfile, runtimeConfig?: RuntimeConfig): Promise<ResearchReport> {
  const liveSearchEnabled = runtimeConfig?.features.enableLiveSearch ?? config.features.enableLiveSearch;
  if (!liveSearchEnabled) {
    throw new Error("Live search is disabled in config.ts (features.enableLiveSearch=false)");
  }
  const client = getOpenAIClient(runtimeConfig);
  let response;
  try {
    response = await client.responses.create({
      model: runtimeConfig?.models.search ?? config.models.search,
      tools: [{ type: "web_search_preview" }],
      input: `${SEARCH_SYSTEM_PROMPT}\n\nUser input: country=${profile.country}, city=${profile.city}, major=${profile.major}, grade=${profile.grade}`,
    });
  } catch (err) {
    throw explainLiveSearchError(err, runtimeConfig);
  }

  const text = response.output_text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Search Agent did not return valid JSON");
  return JSON.parse(jsonMatch[0]) as ResearchReport;
}
