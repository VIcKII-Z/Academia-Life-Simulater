import { useState } from "react";
import { saveCredentials, loadCredentials, loadProviderApiKey } from "../lib/storage";
import type { Provider } from "../types";

/** Also used as an embedded "edit API key" panel mid-flow (see HomeFlow's
 * key-editor overlay) — `compact` swaps the copy/button labels and adds a
 * "Cancel" button via `onCancel`, so the user isn't forced back to the very
 * first onboarding screen just to fix or swap their key. */
export default function PassportCard({
  onComplete,
  onCancel,
  compact = false,
}: {
  onComplete: () => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const existing = loadCredentials();
  const DEFAULT_RELAY_URL = "https://xuedingmao.top/v1";
  // Each provider keeps its own key in state (and in storage) so toggling
  // between relay/OpenAI never clears the other provider's key.
  const [relayApiKey, setRelayApiKey] = useState(loadProviderApiKey("relay"));
  const [openaiApiKey, setOpenaiApiKey] = useState(loadProviderApiKey("openai"));
  const [provider, setProvider] = useState<Provider>(existing.provider || "relay");
  const [baseURL, setBaseURL] = useState(existing.baseURL || DEFAULT_RELAY_URL);
  const [error, setError] = useState<string | null>(null);

  const apiKey = provider === "relay" ? relayApiKey : openaiApiKey;
  const setApiKey = provider === "relay" ? setRelayApiKey : setOpenaiApiKey;

  function selectProvider(next: Provider) {
    setProvider(next);
    // Restore a sensible default base URL when switching back to relay so the
    // user isn't left with a blank/OpenAI URL if they had cleared it earlier.
    if (next === "relay" && !baseURL.trim()) {
      setBaseURL(DEFAULT_RELAY_URL);
    }
  }

  function handleSubmit() {
    if (!apiKey.trim()) {
      setError(
        provider === "relay"
          ? "Enter your relay API key to unlock your travel journal."
          : "Enter your OpenAI API key to unlock your travel journal.",
      );
      return;
    }
    if (provider === "relay" && !baseURL.trim()) {
      setError("Enter your relay's base URL.");
      return;
    }
    saveCredentials({
      provider,
      apiKey: apiKey.trim(),
      baseURL: provider === "relay" ? baseURL.trim() : "",
    });
    onComplete();
  }

  return (
    <div className="journalCard passportCard">
      {!compact && (
        <img className="mascotGreeter" src="/branding/mascot.png" alt="Future Life Simulator mascot, a pixel-art owl in a graduation cap" />
      )}
      <div className="passportStamp">
        <img className="passportStampIcon" src="/stickers/map.png" alt="" />
      </div>
      <h2>{compact ? "Update your travel key" : "Enter your travel key"}</h2>
      <p className="lede">
        {compact
          ? "Change or re-enter your API key anytime — it stays in this browser only and is never written to our logs."
          : "Your future life abroad is generated just for you. We need an API key to open your journal — it stays in this browser only and is never written to our logs."}
      </p>

      {error && <div className="journalError">{error}</div>}

      <div className="providerToggle" role="group" aria-label="Choose your provider">
        <button
          type="button"
          className={provider === "relay" ? "active" : ""}
          onClick={() => selectProvider("relay")}
        >
          <img className="inlineIcon" src="/stickers/network.png" alt="" /> Relay (中转站)
        </button>
        <button
          type="button"
          className={provider === "openai" ? "active" : ""}
          onClick={() => selectProvider("openai")}
        >
          <img className="inlineIcon" src="/stickers/gear.png" alt="" /> Official OpenAI
        </button>
      </div>

      <input
        className="journalInput"
        type="password"
        placeholder={provider === "relay" ? "Relay API key..." : "sk-... (OpenAI API key)"}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />

      {provider === "relay" ? (
        <>
          <p className="journalHint">
            Using a relay endpoint — enter its base URL below. Change this and other settings anytime from
            the <code>/debug</code> page.
          </p>
          <input
            className="journalInput"
            type="text"
            placeholder="Relay base URL, e.g. https://your-relay.example/v1"
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
          />
        </>
      ) : (
        <p className="journalHint">
          Using the official OpenAI API — no base URL needed. Note: some features (like Live Search) call
          the OpenAI Responses API directly and may not work through third-party relays.
        </p>
      )}

      <div className="journalButtonRow">
        {compact && onCancel && (
          <button className="journalButton secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="journalButton" onClick={handleSubmit}>
          {compact ? "Save key" : "Open my journal"}
        </button>
      </div>
    </div>
  );
}
