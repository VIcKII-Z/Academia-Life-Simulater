import OpenAI from "openai";
import { config } from "../config/config.js";
import type { RuntimeConfig } from "../types.js";

/**
 * Shared OpenAI client factory.
 *
 * Supports pointing at either the official OpenAI API or an OpenAI-protocol-
 * compatible relay/proxy ("中转站", e.g. https://xuedingmao.top/v1). The relay
 * exposes the same request/response shape as OpenAI, so only baseURL + apiKey
 * need to change — no code changes required in the agents.
 *
 * Configure via backend/.env:
 *   OPENAI_API_KEY=...          (required)
 *   OPENAI_BASE_URL=...         (optional; omit to use official api.openai.com)
 *
 * Or override directly in config.ts -> openai.baseURL for a quick manual test.
 */
let client: OpenAI | null = null;

export function getOpenAIClient(runtimeConfig?: RuntimeConfig): OpenAI {
  if (runtimeConfig?.apiKey) {
    // IMPORTANT: the OpenAI SDK falls back to process.env.OPENAI_BASE_URL
    // whenever baseURL is undefined — passing `undefined` here does NOT mean
    // "use the official API" if that env var happens to be set (e.g. to the
    // relay, in backend/.env). So for provider "openai" we must explicitly
    // pass the official URL to override any relay URL set via env/.env.
    const baseURL =
      runtimeConfig.provider === "relay"
        ? runtimeConfig.baseURL?.trim() || undefined
        : "https://api.openai.com/v1";
    return new OpenAI({ apiKey: runtimeConfig.apiKey, baseURL });
  }

  if (client) return client;

  const baseURL = config.openai.baseURL || process.env.OPENAI_BASE_URL || undefined;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set in backend/.env");
  }

  client = new OpenAI({ apiKey, baseURL });
  return client;
}
