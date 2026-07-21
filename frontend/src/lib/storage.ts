import type { Provider } from "../types";

// Each provider keeps its own API key slot so switching the toggle between
// "relay" and "openai" never clears/overwrites the other provider's key —
// only the currently active provider's key is read/written by
// loadCredentials()/saveCredentials().
const KEYS = {
  apiKeyRelay: "fls.apiKey.relay",
  apiKeyOpenai: "fls.apiKey.openai",
  provider: "fls.provider",
  baseURL: "fls.baseURL",
  imageGenerationEnabled: "fls.imageGenerationEnabled",
} as const;

function keyForProvider(provider: Provider): string {
  return provider === "relay" ? KEYS.apiKeyRelay : KEYS.apiKeyOpenai;
}

export interface StoredCredentials {
  provider: Provider;
  apiKey: string;
  baseURL: string;
}

export function loadCredentials(): StoredCredentials {
  migrateLegacyApiKey();
  const provider: Provider = (localStorage.getItem(KEYS.provider) as Provider | null) ?? "relay";
  return {
    provider,
    apiKey: loadProviderApiKey(provider),
    baseURL: localStorage.getItem(KEYS.baseURL) ?? "",
  };
}

/** One-time migration: earlier versions stored a single "fls.apiKey" shared
 * across both providers, which meant switching providers silently wiped
 * whichever key wasn't currently selected. Move any legacy key into the
 * slot for whatever provider was last active, then remove the legacy key. */
function migrateLegacyApiKey(): void {
  const legacyKey = localStorage.getItem("fls.apiKey");
  if (legacyKey === null) return;
  const provider: Provider = (localStorage.getItem(KEYS.provider) as Provider | null) ?? "relay";
  if (!localStorage.getItem(keyForProvider(provider))) {
    localStorage.setItem(keyForProvider(provider), legacyKey);
  }
  localStorage.removeItem("fls.apiKey");
}

/** Reads the stored API key for a specific provider, independent of which
 * provider is currently "active" — used so the key entry form can remember
 * both keys at once while the user toggles between them. */
export function loadProviderApiKey(provider: Provider): string {
  return localStorage.getItem(keyForProvider(provider)) ?? "";
}

export function saveCredentials(credentials: StoredCredentials): void {
  localStorage.setItem(KEYS.provider, credentials.provider);
  localStorage.setItem(keyForProvider(credentials.provider), credentials.apiKey);
  localStorage.setItem(KEYS.baseURL, credentials.baseURL);
}

export function hasStoredApiKey(): boolean {
  const provider: Provider = (localStorage.getItem(KEYS.provider) as Provider | null) ?? "relay";
  return Boolean(loadProviderApiKey(provider).trim());
}

export function clearCredentials(): void {
  localStorage.removeItem(KEYS.apiKeyRelay);
  localStorage.removeItem(KEYS.apiKeyOpenai);
  localStorage.removeItem(KEYS.provider);
  localStorage.removeItem(KEYS.baseURL);
}

export function loadImageGenerationPreference(): boolean {
  return localStorage.getItem(KEYS.imageGenerationEnabled) !== "false";
}

export function saveImageGenerationPreference(enabled: boolean): void {
  localStorage.setItem(KEYS.imageGenerationEnabled, String(enabled));
}
