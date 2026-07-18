/**
 * ============================================================
 *  CENTRAL CONFIG — edit this file to quickly change behavior.
 *  No other file should hardcode model names or feature toggles.
 * ============================================================
 */

export const config = {
  // ---- OpenAI connection -----------------------------------------
  // Leave baseURL empty ("") to hit the official api.openai.com.
  // To use an OpenAI-protocol-compatible relay/proxy ("中转站"), e.g.
  // https://xuedingmao.top/v1, set it here or via OPENAI_BASE_URL in .env.
  // Model names must match whatever the relay's "支持模型" list calls them —
  // update models.* below to match exactly what the relay/provider supports.
  openai: {
    baseURL: "", // e.g. "https://xuedingmao.top/v1"
  },

  // ---- Models -------------------------------------------------
  // Search Agent needs a model that supports the `web_search` tool.
  // Use "gpt-4o" for live search; not used at all in preset mode.
  // NOTE: if using a relay, confirm it supports the Responses API +
  // web_search tool — many relays only proxy /chat/completions.
  models: {
    search: "gpt-4o",
    design: "gpt-4o-mini", // bump to "gpt-4o" if JSON/quality is unreliable
    image: "gpt-image-1",
  },

  // ---- Feature toggles -----------------------------------------
  features: {
    // If false, Search Agent always reads /data/presets/*.json (no API call, no cost, instant).
    enableLiveSearch: false,
    // If false, Artist Agent is skipped entirely; nodes render with no image / a placeholder.
    enableImageGeneration: false,
    // Max number of images generated per story if enableImageGeneration is true.
    maxImagesPerStory: 4,
  },

  // ---- Story generation tuning -----------------------------------
  story: {
    minNodes: 5,
    maxNodes: 8,
  },
} as const;

export type AppConfig = typeof config;
