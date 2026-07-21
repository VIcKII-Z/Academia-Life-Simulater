import { useState } from "react";
import { saveCredentials, loadCredentials, loadProviderApiKey } from "../lib/storage";
import { useI18n } from "../lib/i18n";
import type { Provider } from "../types";

/** Also used as an embedded "edit API key" panel mid-flow. */
export default function PassportCard({
  onComplete,
  onCancel,
  compact = false,
}: {
  onComplete: () => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const existing = loadCredentials();
  const DEFAULT_RELAY_URL = "https://xuedingmao.top/v1";
  const [relayApiKey, setRelayApiKey] = useState(loadProviderApiKey("relay"));
  const [openaiApiKey, setOpenaiApiKey] = useState(loadProviderApiKey("openai"));
  const [provider, setProvider] = useState<Provider>(existing.provider || "relay");
  const [baseURL, setBaseURL] = useState(existing.baseURL || DEFAULT_RELAY_URL);
  const [error, setError] = useState<string | null>(null);

  const apiKey = provider === "relay" ? relayApiKey : openaiApiKey;
  const setApiKey = provider === "relay" ? setRelayApiKey : setOpenaiApiKey;

  function selectProvider(next: Provider) {
    setProvider(next);
    if (next === "relay" && !baseURL.trim()) setBaseURL(DEFAULT_RELAY_URL);
  }

  function handleSubmit() {
    if (!apiKey.trim()) {
      setError(provider === "relay" ? t("passport.relayKeyError") : t("passport.openaiKeyError"));
      return;
    }
    if (provider === "relay" && !baseURL.trim()) {
      setError(t("passport.baseUrlError"));
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
        <img className="mascotGreeter" src="/branding/mascot.png" alt="Future Life Simulator mascot" />
      )}
      <div className="passportStamp">
        <img className="passportStampIcon" src="/stickers/map.png" alt="" />
      </div>
      <h2>{compact ? t("passport.titleCompact") : t("passport.title")}</h2>
      <p className="lede">{compact ? t("passport.ledeCompact") : t("passport.lede")}</p>

      {error && <div className="journalError">{error}</div>}

      <div className="providerToggle" role="group" aria-label={t("passport.providerAria")}>
        <button
          type="button"
          className={provider === "relay" ? "active" : ""}
          onClick={() => selectProvider("relay")}
        >
          <img className="inlineIcon" src="/stickers/network.png" alt="" /> {t("passport.relay")}
        </button>
        <button
          type="button"
          className={provider === "openai" ? "active" : ""}
          onClick={() => selectProvider("openai")}
        >
          <img className="inlineIcon" src="/stickers/gear.png" alt="" /> {t("passport.openai")}
        </button>
      </div>

      <input
        className="journalInput"
        type="password"
        placeholder={provider === "relay" ? t("passport.relayPlaceholder") : t("passport.openaiPlaceholder")}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />

      {provider === "relay" ? (
        <>
          <p className="journalHint">{t("passport.relayHint")}</p>
          <input
            className="journalInput"
            type="text"
            placeholder={t("passport.baseUrlPlaceholder")}
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
          />
        </>
      ) : (
        <p className="journalHint">{t("passport.openaiHint")}</p>
      )}

      <div className="journalButtonRow">
        {compact && onCancel && (
          <button className="journalButton secondary" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button className="journalButton" onClick={handleSubmit}>
          {compact ? t("passport.saveKey") : t("passport.openJournal")}
        </button>
      </div>
    </div>
  );
}
