import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/debug.css";
import type { AppConfig, Provider, RunFiles, RuntimeConfig, StoryDocument, UserProfile } from "../types";
import { fetchAppConfig, fetchPresets, fetchRunFiles, makeStoryId } from "../lib/api";
import { loadCredentials, loadProviderApiKey, saveCredentials } from "../lib/storage";

const DEBUG_TABS = [
  { id: "00_meta.json", label: "Meta" },
  { id: "01_search_report.json", label: "Search Agent" },
  { id: "02_design_skeleton.json", label: "Design Agent" },
  { id: "03_artist_final.json", label: "Artist Agent" },
  { id: "log.txt", label: "Timeline" },
] as const;

const PROFILE_SUGGESTIONS = {
  countries: ["Japan", "Canada", "United States", "United Kingdom", "Australia", "Singapore"],
  cities: ["Tokyo", "Toronto", "New York", "London", "Melbourne", "Singapore"],
  majors: ["Computer Science", "Business Administration", "Data Science", "Design", "Finance", "Education"],
  grades: ["High School", "Undergraduate", "Graduate", "PhD", "Exchange Student"],
};

function stringifyDebug(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default function DebugPage() {
  const stored = loadCredentials();
  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  // Each provider keeps its own key in state (and in storage) so toggling
  // between relay/OpenAI never clears the other provider's key.
  const [relayApiKey, setRelayApiKey] = useState(loadProviderApiKey("relay"));
  const [openaiApiKey, setOpenaiApiKey] = useState(loadProviderApiKey("openai"));
  const [provider, setProvider] = useState<Provider>(stored.provider);
  const [relayBaseURL, setRelayBaseURL] = useState(stored.baseURL);
  const [models, setModels] = useState({ search: "gpt-4o", design: "gpt-4o-mini", image: "gpt-image-1" });
  const [enableImageGeneration, setEnableImageGeneration] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    country: "Japan",
    city: "Tokyo",
    major: "Computer Science",
    grade: "Graduate",
    semesters: 1,
  });
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [runFiles, setRunFiles] = useState<RunFiles | null>(null);
  const [activeDebugTab, setActiveDebugTab] = useState<(typeof DEBUG_TABS)[number]["id"]>("01_search_report.json");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const apiKey = provider === "relay" ? relayApiKey : openaiApiKey;
  const setApiKey = provider === "relay" ? setRelayApiKey : setOpenaiApiKey;

  useEffect(() => {
    Promise.all([fetchAppConfig(), fetchPresets()])
      .then(([appConfig, presetList]: [AppConfig, string[]]) => {
        setModels(appConfig.models);
        setEnableImageGeneration(appConfig.features.enableImageGeneration);
        if (!relayBaseURL) setRelayBaseURL(appConfig.openai.baseURL);
        setPresets(presetList);
        setSelectedPreset(presetList[0] ?? "");
      })
      .catch(() => setError("Could not reach backend. Is it running on :3001?"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateProfile(key: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateModel(key: keyof typeof models, value: string) {
    setModels((current) => ({ ...current, [key]: value }));
  }

  function persistCredentials() {
    saveCredentials({ provider, apiKey: apiKey.trim(), baseURL: relayBaseURL.trim() });
    setStatusNote("Saved — the main app will use these credentials too.");
  }

  function buildRuntimeConfig(): RuntimeConfig {
    return {
      provider,
      apiKey: apiKey.trim(),
      baseURL: provider === "relay" ? relayBaseURL.trim() : undefined,
      models,
      features: {
        enableLiveSearch: true,
        enableImageGeneration,
        maxImagesPerStory: 30,
      },
    };
  }

  async function loadRunFiles(storyId: string) {
    const files = await fetchRunFiles(storyId);
    if (files) setRunFiles(files);
  }

  async function generate(mode: "live_search" | "preset", regenerate: boolean) {
    // Only pin a client-side storyId when forcing a fresh run. For cache-reuse
    // runs we must NOT send a storyId — the server derives a deterministic
    // hash from mode/preset/profile/models and checks that exact cache slot.
    // Sending a fresh Date.now()-based id here (as this used to do
    // unconditionally) meant every "Run (reuse cache)" click looked up a
    // brand-new, never-generated file and always missed the cache, forcing a
    // live API call (and an API key) even when a cached story already existed.
    const clientStoryId = regenerate ? makeStoryId(mode === "preset" ? selectedPreset : profile.city) : undefined;
    let pollTimer: number | undefined;

    setLoading(true);
    setError(null);
    setStory(null);
    setRunFiles(null);
    setStatusNote(null);

    try {
      // A cache-reuse attempt shouldn't require an API key at all — the
      // backend checks the cache before it ever needs to call OpenAI, and
      // will return its own clear error if a live call turns out to be
      // necessary. Only force-fresh regenerations need a key upfront.
      // Same reasoning applies to the relay base URL: a cache-reuse attempt
      // doesn't need it unless the run actually turns out to require a live
      // call, so only enforce it for forced regenerations.
      if (regenerate && !apiKey.trim()) throw new Error("Enter an API key above before starting a run.");
      if (regenerate && provider === "relay" && !relayBaseURL.trim()) throw new Error("Relay mode needs a base URL.");

      if (clientStoryId) {
        pollTimer = window.setInterval(() => {
          void loadRunFiles(clientStoryId);
        }, 900);
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          presetId: mode === "preset" ? selectedPreset : undefined,
          profile: mode === "live_search" ? profile : undefined,
          storyId: clientStoryId,
          regenerate,
          runtimeConfig: buildRuntimeConfig(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload.storyId) await loadRunFiles(payload.storyId);
        throw new Error(payload.error ?? "Generation failed");
      }

      const doc = payload as StoryDocument;
      setStory(doc);
      if (doc.cached) setStatusNote("Loaded from cache (matching story already existed).");
      await loadRunFiles(doc.story_id ?? clientStoryId ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (pollTimer) window.clearInterval(pollTimer);
      setLoading(false);
    }
  }

  const totalStoryNodes = useMemo(
    () => (story ? Object.keys(story.nodes).length + Object.keys(story.endings).length : 0),
    [story],
  );

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div>
          <div className="brandMark">FL</div>
          <p className="labelText">Dev tools</p>
          <h1>Debug console</h1>
          <p className="sidebarCopy">
            Configuration and raw agent output for developing Future Life Simulator. Not shown to end users.
          </p>
        </div>
        <Link className="ghostButton" to="/">
          ← Back to the app
        </Link>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="labelText">Workspace</p>
            <h2>Configuration &amp; agent outputs</h2>
          </div>
        </header>

        <div className="workspaceGrid">
          <section className="panel inputPanel">
            <div className="panelHeader">
              <div>
                <p className="labelText">Connection</p>
                <h3>Provider &amp; models</h3>
              </div>
            </div>

            <div className="providerToggle" role="group" aria-label="Provider">
              <button className={provider === "openai" ? "active" : ""} onClick={() => setProvider("openai")}>
                OpenAI
              </button>
              <button className={provider === "relay" ? "active" : ""} onClick={() => setProvider("relay")}>
                Relay
              </button>
            </div>

            <label className="field">
              <span>API key</span>
              <input type="password" value={apiKey} placeholder="sk-..." onChange={(event) => setApiKey(event.target.value)} />
            </label>

            {provider === "relay" && (
              <label className="field">
                <span>Relay base URL</span>
                <input
                  type="text"
                  value={relayBaseURL}
                  placeholder="https://xuedingmao.top/v1"
                  onChange={(event) => setRelayBaseURL(event.target.value)}
                />
              </label>
            )}

            <div className="gridThree">
              <label className="field">
                <span>Search model</span>
                <input value={models.search} onChange={(event) => updateModel("search", event.target.value)} />
              </label>
              <label className="field">
                <span>Design model</span>
                <input value={models.design} onChange={(event) => updateModel("design", event.target.value)} />
              </label>
              <label className="field">
                <span>Image model</span>
                <input value={models.image} onChange={(event) => updateModel("image", event.target.value)} />
              </label>
            </div>

            <label className="switchRow">
              <input
                type="checkbox"
                checked={enableImageGeneration}
                onChange={(event) => setEnableImageGeneration(event.target.checked)}
              />
              <span>Generate chapter images with Artist Agent</span>
            </label>

            <div className="actionRow">
              <button className="secondaryButton" onClick={persistCredentials}>
                Save credentials for main app
              </button>
            </div>

            <div className="panelHeader" style={{ marginTop: 24 }}>
              <div>
                <p className="labelText">Input</p>
                <h3>Study-abroad profile</h3>
              </div>
            </div>

            <div className="gridTwo">
              <label className="field">
                <span>Country</span>
                <input list="countries" value={profile.country} onChange={(event) => updateProfile("country", event.target.value)} />
              </label>
              <label className="field">
                <span>City</span>
                <input list="cities" value={profile.city} onChange={(event) => updateProfile("city", event.target.value)} />
              </label>
              <label className="field">
                <span>Subject / Major</span>
                <input list="majors" value={profile.major} onChange={(event) => updateProfile("major", event.target.value)} />
              </label>
              <label className="field">
                <span>Grade</span>
                <input list="grades" value={profile.grade} onChange={(event) => updateProfile("grade", event.target.value)} />
              </label>
              <label className="field">
                <span>School (optional)</span>
                <input
                  placeholder="e.g. University of Tokyo"
                  value={profile.school ?? ""}
                  onChange={(event) => updateProfile("school", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Department (optional)</span>
                <input
                  placeholder="e.g. Graduate School of Information Science"
                  value={profile.department ?? ""}
                  onChange={(event) => updateProfile("department", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Program (optional)</span>
                <input
                  placeholder="e.g. MS in Computer Science"
                  value={profile.program ?? ""}
                  onChange={(event) => updateProfile("program", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Semesters</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={profile.semesters ?? 1}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      semesters: Math.min(8, Math.max(1, Number.parseInt(event.target.value, 10) || 1)),
                    }))
                  }
                />
              </label>
            </div>

            <datalist id="countries">{PROFILE_SUGGESTIONS.countries.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="cities">{PROFILE_SUGGESTIONS.cities.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="majors">{PROFILE_SUGGESTIONS.majors.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="grades">{PROFILE_SUGGESTIONS.grades.map((item) => <option key={item} value={item} />)}</datalist>

            <div className="actionRow">
              <button className="primaryButton" disabled={loading} onClick={() => generate("live_search", false)}>
                {loading ? "Running agents..." : "Run (reuse cache)"}
              </button>
              <button className="secondaryButton" disabled={loading} onClick={() => generate("live_search", true)}>
                Regenerate (force fresh)
              </button>
            </div>
            <div className="actionRow">
              <button className="secondaryButton" disabled={loading || !selectedPreset} onClick={() => generate("preset", false)}>
                Use demo preset
              </button>
              {presets.length > 0 && (
                <select value={selectedPreset} onChange={(event) => setSelectedPreset(event.target.value)}>
                  {presets.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {statusNote && <div className="configHint">{statusNote}</div>}
            {error && <div className="errorBox">{error}</div>}
          </section>

          <section className="panel resultPanel">
            <div className="panelHeader">
              <div>
                <p className="labelText">Output</p>
                <h3>Generated story</h3>
              </div>
            </div>

            {story ? (
              <div className="resultCard">
                <h2>{story.user_profile.city}, {story.user_profile.country}</h2>
                <p>{story.framework_reason}</p>
                <dl>
                  <div>
                    <dt>Framework</dt>
                    <dd>{story.framework_type}</dd>
                  </div>
                  <div>
                    <dt>Nodes</dt>
                    <dd>{totalStoryNodes}</dd>
                  </div>
                  <div>
                    <dt>Cached</dt>
                    <dd>{story.cached ? "yes" : "freshly generated"}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="emptyState">
                <p className="labelText">No run yet</p>
                <h2>Run the pipeline to inspect agent output below.</h2>
              </div>
            )}
          </section>
        </div>

        <section className="panel debugPanel">
          <div className="debugTabs">
            {DEBUG_TABS.map((tab) => (
              <button key={tab.id} className={activeDebugTab === tab.id ? "active" : ""} onClick={() => setActiveDebugTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <pre>{runFiles?.[activeDebugTab] ? stringifyDebug(runFiles[activeDebugTab]) : "No output for this stage yet."}</pre>
        </section>
      </section>
    </main>
  );
}
