import type { RuntimeConfig, UserProfile } from "./types.js";

/** Only effective generation settings affect cache identity; credentials never do. */
export function fullGenerationCachePayload(profile: UserProfile | undefined, runtime: RuntimeConfig | undefined, model: string, version: string) {
  const service = (name: "search" | "text" | "image") => {
    const value = runtime?.services?.[name];
    return { provider: value?.provider ?? (name === "text" ? runtime?.provider : "openai"), baseURL: value?.baseURL ?? (name === "text" ? runtime?.baseURL : undefined) };
  };
  return {
    generatorVersion: version, profile,
    models: { search: runtime?.services?.search?.model ?? runtime?.models.search, design: model, image: runtime?.services?.image?.model ?? runtime?.models.image },
    services: { search: service("search"), text: service("text"), image: service("image") },
    outputLanguage: runtime?.outputLanguage ?? "en",
    liveResearch: runtime?.features.enableLiveSearch ?? true,
    imageGeneration: runtime?.features.enableImageGeneration ?? false,
    maxImagesPerStory: runtime?.features.maxImagesPerStory ?? 0,
  };
}
