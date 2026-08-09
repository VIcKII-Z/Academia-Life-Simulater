import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/debug.css";
import type { AppConfig, Provider, RunFiles, RuntimeConfig, StoryDocument, UserProfile } from "../types";
import {
  fetchAppConfig,
  fetchFullGenerationStatus,
  fetchPresets,
  fetchRunFiles,
  makeStoryId,
  startFullGeneration,
  type FullGenerationJob,
} from "../lib/api";
import { loadCredentials, loadProviderApiKey, saveCredentials, saveProviderApiKey } from "../lib/storage";
import { useI18n } from "../lib/i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";

const DEBUG_TABS = [
  { id: "00_meta.json", label: "Meta" },
  { id: "00_research_report.json", label: "Live Research" },
  { id: "01_search_report.json", label: "Search Agent" },
  { id: "02_design_skeleton.json", label: "Design Agent" },
  { id: "03_artist_final.json", label: "Artist Agent" },
  { id: "08_images_story.json", label: "Images" },
  { id: "09_final_story.json", label: "Final Story" },
  { id: "09_validation_report.json", label: "Validation" },
  { id: "full_generator.log", label: "Full Log" },
  { id: "logic_tree", label: "Logic Tree" },
  { id: "log.txt", label: "Timeline" },
] as const;

type DebugTabId = (typeof DEBUG_TABS)[number]["id"];

type ValidationReport = {
  counts?: Record<string, number>;
  requirements?: Record<string, boolean>;
  issues?: string[];
  sampleSimulation?: Record<string, { ok: boolean; ending?: string; warnings?: string[]; steps?: number }>;
  exhaustiveSimulation?: {
    terminalPaths?: number;
    naturalEndings?: number;
    failureEndings?: number;
    badCount?: number;
  };
};

const PROFILE_SUGGESTIONS = {
  countries: ["Japan", "Canada", "United States", "United Kingdom", "Australia", "Singapore"],
  cities: ["Tokyo", "Toronto", "New York", "London", "Melbourne", "Singapore"],
  majors: ["Computer Science", "Business Administration", "Data Science", "Design", "Finance", "Education"],
  grades: ["High School", "Undergraduate", "Graduate", "PhD", "Exchange Student"],
};

function stringifyDebug(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isStoryDocument(value: unknown): value is StoryDocument {
  return Boolean(value && typeof value === "object" && "nodes" in value && "endings" in value);
}

function isValidationReport(value: unknown): value is ValidationReport {
  return Boolean(value && typeof value === "object" && ("requirements" in value || "counts" in value));
}

function stripChoicePrefix(text: string): string {
  return text.replace(/^[^:：]+[:：]\s*/, "");
}

function deltaText(delta?: Record<string, number>): string {
  const entries = Object.entries(delta ?? {}).filter(([, value]) => value !== 0);
  if (entries.length === 0) return "no variable change";
  return entries.map(([key, value]) => `${key}${value > 0 ? "+" : ""}${value}`).join(" / ");
}

function LogicTreeView({ story, validation }: { story: StoryDocument; validation?: ValidationReport }) {
  const playableNodes = Object.entries(story.nodes).filter(([, node]) => node.logic_page_role === "node");
  const specialNodes = playableNodes.filter(([, node]) => node.type === "special_node");
  const variables = story.logic?.variables ?? [];

  return (
    <div className="logicTree">
      <div className="logicTreeSummary">
        <div>
          <span>Playable nodes</span>
          <strong>{playableNodes.length}</strong>
        </div>
        <div>
          <span>Variables</span>
          <strong>{variables.length}</strong>
        </div>
        <div>
          <span>Variable variants</span>
          <strong>{Object.keys(story.logic_content_variants ?? {}).length}</strong>
        </div>
        <div>
          <span>Enumerated paths</span>
          <strong>{validation?.exhaustiveSimulation?.terminalPaths ?? "n/a"}</strong>
        </div>
      </div>

      {validation?.requirements && (
        <div className="logicTreeChecks">
          {Object.entries(validation.requirements).map(([key, passed]) => (
            <span className={passed ? "pass" : "fail"} key={key}>
              {passed ? "PASS" : "FAIL"} {key}
            </span>
          ))}
        </div>
      )}

      <section className="logicVariables">
        {variables.map((variable) => (
          <div key={variable.id}>
            <strong>{variable.id}</strong>
            <span>initial {variable.initial}</span>
            <code>{variable.warning_page_id}</code>
            <code>{variable.failure_page_id}</code>
          </div>
        ))}
      </section>

      <div className="logicSpecialStrip">
        <strong>Special nodes</strong>
        <span>{specialNodes.map(([nodeId]) => nodeId).join(" -> ")}</span>
      </div>

      <section className="logicNodeList">
        {playableNodes.map(([nodeId, node]) => (
          <article className={`logicNode logicNode--${node.type}`} key={nodeId}>
            <header>
              <div>
                <span>{node.type}</span>
                <h4>{nodeId}</h4>
              </div>
              <code>{node.choices.length} choices</code>
            </header>
            <p>{node.scene_text}</p>
            <div className="logicChoices">
              {node.choices.map((choice, index) => (
                <div className={`logicChoice logicChoice--${index}`} key={choice.logic_choice_id ?? `${nodeId}-${index}`}>
                  <div className="logicChoiceHead">
                    <strong>{choice.logic_choice_id ?? `choice_${index + 1}`}</strong>
                    <span>{index === 0 ? "normal" : index === 1 ? "positive extreme" : "negative extreme"}</span>
                  </div>
                  <p>{stripChoicePrefix(choice.text)}</p>
                  <div className="logicRoute">
                    <code>{choice.next_node}</code>
                    <span>then</span>
                    <code>{choice.logic_planned_next_node ?? choice.next_node}</code>
                  </div>
                  <small>{deltaText(choice.logic_delta)}</small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export default function DebugPage() {
  const { language } = useI18n();
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
  const [activeDebugTab, setActiveDebugTab] = useState<DebugTabId>("logic_tree");
  const [manualRunId, setManualRunId] = useState("utokyo_cs_full_1785770721");
  const [fullModel, setFullModel] = useState("gemini-3-flash-preview");
  const [fullJob, setFullJob] = useState<FullGenerationJob | null>(null);
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

  useEffect(() => {
    if (!fullJob || fullJob.status !== "running") return;
    let cancelled = false;

    async function pollFullJob() {
      try {
        const status = await fetchFullGenerationStatus(fullJob?.storyId ?? "");
        if (cancelled) return;
        setFullJob(status);
        setManualRunId(status.storyId);
        await loadRunFiles(status.storyId);
        if (status.status === "completed") {
          setStatusNote(`Full generator completed: ${status.storyId}`);
          setActiveDebugTab("logic_tree");
          setLoading(false);
        } else if (status.status === "failed") {
          setError(status.error ?? "Full generator failed.");
          setActiveDebugTab("full_generator.log");
          setLoading(false);
        } else {
          const lastLine = status.logTail[status.logTail.length - 1] ?? status.lines[status.lines.length - 1];
          if (lastLine) setStatusNote(lastLine);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void pollFullJob();
    const timer = window.setInterval(() => {
      void pollFullJob();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullJob?.storyId, fullJob?.status]);

  function updateProfile(key: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateModel(key: keyof typeof models, value: string) {
    setModels((current) => ({ ...current, [key]: value }));
  }

  function persistCredentials() {
    saveCredentials({ provider, apiKey: apiKey.trim(), baseURL: relayBaseURL.trim() });
    saveProviderApiKey("openai", openaiApiKey.trim());
    setStatusNote("Saved — the main app will use these credentials too.");
  }

  function buildRuntimeConfig(): RuntimeConfig {
    const openaiStageKey = openaiApiKey.trim();
    const openaiStageProvider = openaiStageKey ? "openai" : provider;
    const openaiStageBaseURL = openaiStageKey ? undefined : provider === "relay" ? relayBaseURL.trim() : undefined;
    return {
      provider,
      apiKey: apiKey.trim(),
      baseURL: provider === "relay" ? relayBaseURL.trim() : undefined,
      models,
      outputLanguage: language === "zh" ? "zh" : "en",
      services: {
        search: {
          provider: openaiStageProvider,
          apiKey: openaiStageKey || apiKey.trim(),
          baseURL: openaiStageBaseURL,
          model: models.search,
        },
        text: {
          provider,
          apiKey: apiKey.trim(),
          baseURL: provider === "relay" ? relayBaseURL.trim() : undefined,
          model: models.design,
        },
        image: {
          provider: openaiStageProvider,
          apiKey: openaiStageKey || apiKey.trim(),
          baseURL: openaiStageBaseURL,
          model: models.image,
        },
      },
      features: {
        enableLiveSearch: true,
        enableImageGeneration,
        maxImagesPerStory: 12,
      },
    };
  }

  async function loadRunFiles(storyId: string) {
    const files = await fetchRunFiles(storyId);
    if (files) {
      setRunFiles(files);
      const finalStory = files["09_final_story.json"];
      if (isStoryDocument(finalStory)) setStory(finalStory);
    }
  }

  async function loadManualRun() {
    if (!manualRunId.trim()) return;
    setLoading(true);
    setError(null);
    setStatusNote(null);
    try {
      const files = await fetchRunFiles(manualRunId.trim());
      if (!files) throw new Error(`Run not found: ${manualRunId.trim()}`);
      setRunFiles(files);
      const finalStory = files["09_final_story.json"];
      if (isStoryDocument(finalStory)) {
        setStory(finalStory);
        setStatusNote(`Loaded run ${finalStory.story_id}.`);
      } else {
        setStory(null);
        setStatusNote(`Loaded run ${manualRunId.trim()}, but no 09_final_story.json was found.`);
      }
      setActiveDebugTab("logic_tree");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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

  async function runFullPostOfferGenerator() {
    const clientStoryId = makeStoryId(`${profile.city}_${profile.major}_full`);
    setLoading(true);
    setError(null);
    setStory(null);
    setRunFiles(null);
    setFullJob(null);
    setManualRunId(clientStoryId);
    setStatusNote("Starting full post-offer generator...");
    setActiveDebugTab("full_generator.log");

    try {
      if (!apiKey.trim()) throw new Error("Enter an API key before starting the full generator.");
      if (provider === "relay" && !relayBaseURL.trim()) throw new Error("Relay mode needs a base URL.");
      const job = await startFullGeneration({
        profile,
        storyId: clientStoryId,
        regenerate: true,
        model: fullModel.trim() || "gemini-3-flash-preview",
        runtimeConfig: buildRuntimeConfig(),
      });
      setFullJob(job);
      setStatusNote(`Full generator started: ${job.storyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  const totalStoryNodes = useMemo(
    () => (story ? Object.keys(story.nodes).length + Object.keys(story.endings).length : 0),
    [story],
  );
  const finalStoryFromRun = useMemo(() => {
    const value = runFiles?.["09_final_story.json"];
    return isStoryDocument(value) ? value : story;
  }, [runFiles, story]);
  const validationFromRun = useMemo(() => {
    const value = runFiles?.["09_validation_report.json"];
    return isValidationReport(value) ? value : undefined;
  }, [runFiles]);

  function renderDebugOutput() {
    if (activeDebugTab === "logic_tree") {
      return finalStoryFromRun ? (
        <LogicTreeView story={finalStoryFromRun} validation={validationFromRun} />
      ) : (
        <div className="emptyState">
          <p className="labelText">No logic tree</p>
          <h2>Load a full post-offer run to inspect the node graph.</h2>
        </div>
      );
    }
    if (activeDebugTab === "full_generator.log") {
      const liveLog = fullJob ? [...fullJob.lines, ...fullJob.logTail].filter(Boolean).join("\n") : "";
      const savedLog = runFiles?.["full_generator.log"];
      return <pre>{savedLog ? stringifyDebug(savedLog) : liveLog || "No full generator log yet."}</pre>;
    }
    return <pre>{runFiles?.[activeDebugTab] ? stringifyDebug(runFiles[activeDebugTab]) : "No output for this stage yet."}</pre>;
  }

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
          <LanguageSwitcher inline />
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
              <span>Text API key</span>
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

            {provider === "relay" && (
              <label className="field">
                <span>OpenAI key for live search/images</span>
                <input
                  type="password"
                  value={openaiApiKey}
                  placeholder="sk-... (used by Search Agent and Artist Agent)"
                  onChange={(event) => setOpenaiApiKey(event.target.value)}
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

            <section className="fullGeneratorBox">
              <div>
                <p className="labelText">Full post-offer automation</p>
                <h3>Run complete Tokyo CS generator</h3>
                <p>
                  Starts the long multi-call script: research adaptation, node planning, supervisor, content fill,
                  variable variants, simulation, and final validation.
                </p>
              </div>
              <label className="field compactField">
                <span>Full generator model</span>
                <input value={fullModel} onChange={(event) => setFullModel(event.target.value)} />
              </label>
              <div className="actionRow">
                <button className="primaryButton" disabled={loading} onClick={runFullPostOfferGenerator}>
                  {fullJob?.status === "running" ? "Full generator running..." : "Run full generator"}
                </button>
                {fullJob && (
                  <span className={`runBadge ${fullJob.status === "failed" ? "error" : fullJob.status === "completed" ? "play" : "design"}`}>
                    {fullJob.status} {fullJob.pid ? `pid ${fullJob.pid}` : ""}
                  </span>
                )}
              </div>
              {fullJob && (
                <div className="fullGeneratorMeta">
                  <code>{fullJob.storyId}</code>
                  <span>{fullJob.hasFinalStory ? "final story ready" : "waiting for 09_final_story.json"}</span>
                  {fullJob.status === "completed" && (
                    <Link className="secondaryButton" to={`/play-demo?storyId=${encodeURIComponent(fullJob.storyId)}`}>
                      Play generated story
                    </Link>
                  )}
                </div>
              )}
            </section>

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
          <div className="debugRunLoader">
            <label className="field compactField">
              <span>Run id</span>
              <input value={manualRunId} onChange={(event) => setManualRunId(event.target.value)} />
            </label>
            <button className="secondaryButton" disabled={loading} onClick={loadManualRun}>
              Load run
            </button>
          </div>
          <div className="debugTabs">
            {DEBUG_TABS.map((tab) => (
              <button key={tab.id} className={activeDebugTab === tab.id ? "active" : ""} onClick={() => setActiveDebugTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          {renderDebugOutput()}
        </section>
      </section>
    </main>
  );
}
