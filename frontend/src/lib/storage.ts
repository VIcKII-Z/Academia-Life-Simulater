import type { Provider } from "../types";

// Each provider keeps its own API key slot so switching the toggle between
// "relay" and "openai" never clears/overwrites the other provider's key —
// only the currently active provider's key is read/written by
// loadCredentials()/saveCredentials().
const sessionValues = new Map<string, string>();
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return sessionValues.get(key) ?? null; }
}
function write(key: string, value: string): void {
  sessionValues.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* Keep the setting for this session. */ }
}
function remove(key: string): void {
  sessionValues.delete(key);
  try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

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
  const provider: Provider = read(KEYS.provider) === "openai" ? "openai" : "relay";
  return {
    provider,
    apiKey: loadProviderApiKey(provider),
    baseURL: read(KEYS.baseURL) ?? "",
  };
}

/** One-time migration: earlier versions stored a single "fls.apiKey" shared
 * across both providers, which meant switching providers silently wiped
 * whichever key wasn't currently selected. Move any legacy key into the
 * slot for whatever provider was last active, then remove the legacy key. */
function migrateLegacyApiKey(): void {
  const legacyKey = read("fls.apiKey");
  if (legacyKey === null) return;
  const provider: Provider = read(KEYS.provider) === "openai" ? "openai" : "relay";
  if (!read(keyForProvider(provider))) {
    write(keyForProvider(provider), legacyKey);
  }
  remove("fls.apiKey");
}

/** Reads the stored API key for a specific provider, independent of which
 * provider is currently "active" — used so the key entry form can remember
 * both keys at once while the user toggles between them. */
export function loadProviderApiKey(provider: Provider): string {
  return read(keyForProvider(provider)) ?? "";
}

export function saveProviderApiKey(provider: Provider, apiKey: string): void {
  write(keyForProvider(provider), apiKey);
}

export function saveCredentials(credentials: StoredCredentials): void {
  write(KEYS.provider, credentials.provider);
  write(keyForProvider(credentials.provider), credentials.apiKey);
  write(KEYS.baseURL, credentials.baseURL);
}

export function hasStoredApiKey(): boolean {
  const provider: Provider = read(KEYS.provider) === "openai" ? "openai" : "relay";
  return Boolean(loadProviderApiKey(provider).trim());
}

export function clearCredentials(): void {
  remove(KEYS.apiKeyRelay);
  remove(KEYS.apiKeyOpenai);
  remove(KEYS.provider);
  remove(KEYS.baseURL);
}

export function loadImageGenerationPreference(): boolean {
  return read(KEYS.imageGenerationEnabled) !== "false";
}

export function saveImageGenerationPreference(enabled: boolean): void {
  write(KEYS.imageGenerationEnabled, String(enabled));
}
