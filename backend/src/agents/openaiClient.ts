import OpenAI from "openai";
import { config } from "../config/config.js";
import type { RuntimeConfig, RuntimeService, RuntimeServiceConfig } from "../types.js";

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

function legacyServiceConfig(runtimeConfig: RuntimeConfig): RuntimeServiceConfig {
  return {
    provider: runtimeConfig.provider,
    apiKey: runtimeConfig.apiKey,
    baseURL: runtimeConfig.baseURL,
  };
}

function serviceConfig(runtimeConfig: RuntimeConfig | undefined, service: RuntimeService): RuntimeServiceConfig | undefined {
  if (!runtimeConfig) return undefined;
  return runtimeConfig.services?.[service] ?? legacyServiceConfig(runtimeConfig);
}

export function getRuntimeModel(runtimeConfig: RuntimeConfig | undefined, service: RuntimeService): string {
  const stageModel = runtimeConfig?.services?.[service]?.model?.trim();
  if (stageModel) return stageModel;
  if (service === "search") return runtimeConfig?.models.search ?? config.models.search;
  if (service === "image") return runtimeConfig?.models.image ?? config.models.image;
  return runtimeConfig?.models.design ?? config.models.design;
}

export function getOpenAIClient(runtimeConfig?: RuntimeConfig, service: RuntimeService = "text"): OpenAI {
  const selected = serviceConfig(runtimeConfig, service);
  if (selected?.apiKey) {
    // IMPORTANT: the OpenAI SDK falls back to process.env.OPENAI_BASE_URL
    // whenever baseURL is undefined — passing `undefined` here does NOT mean
    // "use the official API" if that env var happens to be set (e.g. to the
    // relay, in backend/.env). So for provider "openai" we must explicitly
    // pass the official URL to override any relay URL set via env/.env.
    const baseURL =
      selected.provider === "relay"
        ? selected.baseURL?.trim() || undefined
        : "https://api.openai.com/v1";
    return new OpenAI({ apiKey: selected.apiKey, baseURL });
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
