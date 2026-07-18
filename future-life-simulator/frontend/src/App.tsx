import { useEffect, useMemo, useState } from "react";
import type {
  AppConfig,
  EndingNode,
  Provider,
  RunFiles,
  RuntimeConfig,
  StatBlock,
  StoryDocument,
  StoryNode,
  UserProfile,
} from "./types";
import "./App.css";

const DEFAULT_MODELS = {
  search: "gpt-4o",
  design: "gpt-4o-mini",
  image: "gpt-image-1",
};

const PROFILE_SUGGESTIONS = {
  countries: ["Japan", "Canada", "United States", "United Kingdom", "Australia", "Singapore"],
  cities: ["Tokyo", "Toronto", "New York", "London", "Melbourne", "Singapore"],
  majors: ["Computer Science", "Business Administration", "Data Science", "Design", "Finance", "Education"],
  grades: ["High School", "Undergraduate", "Graduate", "PhD", "Exchange Student"],
};

const DEBUG_TABS = [
  { id: "00_meta.json", label: "Meta" },
  { id: "01_search_report.json", label: "Search Agent" },
  { id: "02_design_skeleton.json", label: "Design Agent" },
  { id: "03_artist_final.json", label: "Artist Agent" },
  { id: "log.txt", label: "Timeline" },
] as const;

type PipelineStage = "idle" | "search" | "design" | "artist" | "play" | "error";
type WorkspaceView = "run" | "agents";
type AppPage = "workspace" | "experience";

const PIPELINE_STAGES: { id: Exclude<PipelineStage, "idle" | "error">; label: string; detail: string }[] = [
  { id: "search", label: "Search", detail: "Collect context" },
  { id: "design", label: "Design", detail: "Build narrative" },
  { id: "artist", label: "Artist", detail: "Prepare scenes" },
  { id: "play", label: "Play", detail: "Ready to test" },
];

const TONE_CLASS: Record<string, string> = {
  hopeful: "toneHopeful",
  bittersweet: "toneBittersweet",
  challenging: "toneChallenging",
};

const DEFAULT_STATS: StatBlock = { health: 70, mood: 70, money: 70 };
const STAT_LABELS: { key: keyof StatBlock; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "mood", label: "Mood" },
  { key: "money", label: "Money" },
];

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

function stringifyDebug(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function makeStoryId(seed: string): string {
  const slug = seed.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
  return `${slug}_${Date.now()}`;
}

function inferPipelineStage(files: RunFiles): PipelineStage {
  if (files["03_artist_final.json"]) return "play";
  if (files["02_design_skeleton.json"]) return "artist";
  if (files["01_search_report.json"]) return "design";
  return "search";
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function applyStatDelta(stats: StatBlock, delta?: StatBlock): StatBlock {
  return {
    health: clampStat(stats.health + (delta?.health ?? 0)),
    mood: clampStat(stats.mood + (delta?.mood ?? 0)),
    money: clampStat(stats.money + (delta?.money ?? 0)),
  };
}

function statDeltaText(delta?: StatBlock): string {
  const safeDelta = delta ?? { health: 0, mood: 0, money: 0 };
  return STAT_LABELS
    .map(({ key, label }) => `${label} ${safeDelta[key] >= 0 ? "+" : ""}${safeDelta[key]}`)
    .join(" · ");
}

function getFailedStat(stats: StatBlock): keyof StatBlock | null {
  return STAT_LABELS.find(({ key }) => stats[key] <= 0)?.key ?? null;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  listId,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  listId?: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        list={listId}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function App() {
  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("openai");
  const [relayBaseURL, setRelayBaseURL] = useState("");
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [enableImageGeneration, setEnableImageGeneration] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    country: "Japan",
    city: "Tokyo",
    major: "Computer Science",
    grade: "Graduate",
  });
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState("A");
  const [playerStats, setPlayerStats] = useState<StatBlock>(DEFAULT_STATS);
  const [gameOverReason, setGameOverReason] = useState<string | null>(null);
  const [runFiles, setRunFiles] = useState<RunFiles | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("run");
  const [appPage, setAppPage] = useState<AppPage>("workspace");
  const [configOpen, setConfigOpen] = useState(false);
  const [activeDebugTab, setActiveDebugTab] = useState<(typeof DEBUG_TABS)[number]["id"]>("01_search_report.json");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/config"), fetch("/api/presets")])
      .then(async ([configRes, presetsRes]) => {
        if (!configRes.ok || !presetsRes.ok) throw new Error("Backend is not reachable.");
        const appConfig = (await configRes.json()) as AppConfig;
        const presetList = (await presetsRes.json()) as string[];
        setModels(appConfig.models);
        setEnableImageGeneration(appConfig.features.enableImageGeneration);
        setRelayBaseURL(appConfig.openai.baseURL);
        setPresets(presetList);
        setSelectedPreset(presetList[0] ?? "");
      })
      .catch(() => setError("Could not reach backend. Is it running on :3001?"));
  }, []);

  const currentNode = useMemo<StoryNode | EndingNode | null>(() => {
    if (!story) return null;
    return story.nodes[currentNodeId] ?? story.endings[currentNodeId] ?? null;
  }, [currentNodeId, story]);

  const ending = currentNode && isEnding(currentNode) ? currentNode : null;
  const totalStoryNodes = story ? Object.keys(story.nodes).length + Object.keys(story.endings).length : 0;

  function updateProfile(key: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateModel(key: keyof typeof DEFAULT_MODELS, value: string) {
    setModels((current) => ({ ...current, [key]: value }));
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
        maxImagesPerStory: 8,
      },
    };
  }

  async function loadRunFiles(storyId: string) {
    const res = await fetch(`/api/runs/${encodeURIComponent(storyId)}`);
    if (res.ok) {
      const files = (await res.json()) as RunFiles;
      setRunFiles(files);
      setPipelineStage(inferPipelineStage(files));
    }
  }

  async function generate(mode: "live_search" | "preset") {
    const storyId = makeStoryId(mode === "preset" ? selectedPreset : profile.city);
    let pollTimer: number | undefined;

    setLoading(true);
    setError(null);
    setStory(null);
    setRunFiles(null);
    setAppPage("workspace");
    setWorkspaceView("run");
    setPipelineStage("search");

    try {
      if (!apiKey.trim()) {
        setConfigOpen(true);
        throw new Error("Enter an API key in Configuration before starting a run.");
      }
      if (provider === "relay" && !relayBaseURL.trim()) {
        setConfigOpen(true);
        throw new Error("Relay mode needs a base URL in Configuration.");
      }

      pollTimer = window.setInterval(() => {
        void loadRunFiles(storyId);
      }, 900);

      const body =
        mode === "preset"
          ? { mode, presetId: selectedPreset, storyId, runtimeConfig: buildRuntimeConfig() }
          : { mode, profile, storyId, runtimeConfig: buildRuntimeConfig() };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload.storyId) await loadRunFiles(payload.storyId);
        throw new Error(payload.error ?? "Generation failed");
      }

      const doc = payload as StoryDocument;
      setStory(doc);
      setCurrentNodeId(Object.keys(doc.nodes)[0] ?? "A");
      await loadRunFiles(doc.story_id);
      setPipelineStage("play");
    } catch (err) {
      setPipelineStage("error");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (pollTimer) window.clearInterval(pollTimer);
      setLoading(false);
    }
  }

  async function shutdownDemo() {
    const confirmed = window.confirm("Shut down the local demo servers?");
    if (!confirmed) return;

    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      // The backend may close before the browser receives the final network state.
    } finally {
      window.close();
      setError("Shutdown requested. You can close this browser tab if it stays open.");
    }
  }

  function enterExperience() {
    if (!story) return;
    setCurrentNodeId(Object.keys(story.nodes)[0] ?? "A");
    setPlayerStats(story.initial_stats ?? DEFAULT_STATS);
    setGameOverReason(null);
    setAppPage("experience");
  }

  function handleChoice(choice: StoryNode["choices"][number]) {
    const nextStats = applyStatDelta(playerStats, choice.stat_delta);
    setPlayerStats(nextStats);

    const failedStat = getFailedStat(nextStats);
    if (failedStat) {
      setGameOverReason(`${failedStat} reached 0 after this decision.`);
      return;
    }

    setCurrentNodeId(choice.next_node);
  }

  if (appPage === "experience" && story && currentNode) {
    const failedStat = getFailedStat(playerStats);
    return (
      <main className="experiencePage">
        <header className="experienceHeader">
          <button className="ghostButton" onClick={() => setAppPage("workspace")}>
            Back to workspace
          </button>
          <div>
            <p className="labelText">Interactive experience</p>
            <h1>{story.user_profile.city}, {story.user_profile.country}</h1>
          </div>
          <button
            className="ghostButton"
            onClick={() => {
              setWorkspaceView("agents");
              setAppPage("workspace");
            }}
          >
            Inspect agents
          </button>
        </header>

        <section className={`experienceCard storyGame ${ending ? TONE_CLASS[ending.tone] : ""}`}>
          <div className="gameHud">
            <div>
              <p className="labelText">Scenario</p>
              <strong>{story.framework_type.replace(/_/g, " ")}</strong>
            </div>
            <div>
              <p className="labelText">Position</p>
              <strong>{ending ? "Ending" : currentNodeId} / {totalStoryNodes} nodes</strong>
            </div>
            <div className="statPanel">
              <p className="labelText">Survival stats</p>
              {STAT_LABELS.map(({ key, label }) => (
                <div className="statRow" key={key}>
                  <span>{label}</span>
                  <div className="statTrack">
                    <div className={`statFill ${key}`} style={{ width: `${playerStats[key]}%` }} />
                  </div>
                  <strong>{playerStats[key]}</strong>
                </div>
              ))}
            </div>
          </div>

          {currentNode.image_url ? (
            <div className="gameScene">
              <img className="sceneImage" src={currentNode.image_url} alt="" />
            </div>
          ) : null}

          <div className="dialogueBox">
            <div className="dialogueHeader">
              <div>
                <p className="labelText">{ending ? "Ending reached" : "Current scene"}</p>
                <h2>{ending ? `${ending.tone} ending` : `Scene ${currentNodeId}`}</h2>
              </div>
              <span>{story.user_profile.city}</span>
            </div>
            <p className="sceneText">
              {gameOverReason
                ? `Game over: ${gameOverReason} Your study-abroad plan collapsed under accumulated pressure.`
                : currentNode.scene_text}
            </p>
          </div>

          <aside className="choicePanel">
            {failedStat ? (
              <div className="endingPanel">
                <p className="labelText">Game over</p>
                <h3>{failedStat} depleted</h3>
                <p>
                  A single category falling to zero ends the run. Try balancing health, mood, and money rather than optimizing only one path.
                </p>
                <div className="actionRow">
                  <button className="primaryButton" onClick={enterExperience}>
                    Restart story
                  </button>
                  <button className="secondaryButton" onClick={() => setAppPage("workspace")}>
                    Return to workspace
                  </button>
                </div>
              </div>
            ) : ending ? (
              <div className="endingPanel">
                <p className="labelText">Run complete</p>
                <h3>{ending.tone}</h3>
                <p>{story.framework_reason}</p>
                <div className="actionRow">
                  <button className="primaryButton" onClick={enterExperience}>
                    Restart story
                  </button>
                  <button className="secondaryButton" onClick={() => setAppPage("workspace")}>
                    Return to workspace
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="labelText">Choose your next move</p>
                <div className="choices">
                  {(currentNode as StoryNode).choices.map((choice, index) => (
                    <button key={`${choice.next_node}-${index}`} onClick={() => handleChoice(choice)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>
                        {choice.text}
                        <small>{statDeltaText(choice.stat_delta)}</small>
                        {choice.stat_reason && <em>{choice.stat_reason}</em>}
                      </strong>
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div>
          <div className="brandMark">FL</div>
          <p className="labelText">Agent system</p>
          <h1>Future Life Simulator</h1>
          <p className="sidebarCopy">
            A multi-agent workflow that turns study-abroad intent into a research-grounded interactive scenario.
          </p>
        </div>

        <nav className="pipelineList" aria-label="Pipeline">
          {PIPELINE_STAGES.map((stage, index) => (
            <div
              key={stage.id}
              className={`pipelineItem ${pipelineStage === stage.id ? "active" : ""} ${pipelineStage === "error" ? "error" : ""}`}
            >
              <span className="stepIndex">{index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </div>
            </div>
          ))}
        </nav>

        <button className="shutdownButton" onClick={shutdownDemo}>
          Shutdown Demo
        </button>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="labelText">Workspace</p>
            <h2>Choose a future, then run the agents</h2>
          </div>
          <div className="topActions">
            <button className="configButton" onClick={() => setConfigOpen(true)}>
              Configuration
            </button>
            <div className="viewTabs">
              <button className={workspaceView === "run" ? "active" : ""} onClick={() => setWorkspaceView("run")}>
                Run
              </button>
              <button className={workspaceView === "agents" ? "active" : ""} onClick={() => setWorkspaceView("agents")}>
                Agent outputs
              </button>
            </div>
          </div>
        </header>

        {configOpen && (
          <div className="configOverlay" onClick={() => setConfigOpen(false)}>
            <section className="configDrawer" onClick={(event) => event.stopPropagation()}>
              <div className="panelHeader">
                <div>
                  <p className="labelText">Configuration</p>
                  <h3>Connection and models</h3>
                </div>
                <button className="ghostButton" onClick={() => setConfigOpen(false)}>
                  Close
                </button>
              </div>

              <div className="providerToggle" role="group" aria-label="Provider">
                <button className={provider === "openai" ? "active" : ""} onClick={() => setProvider("openai")}>
                  OpenAI
                </button>
                <button className={provider === "relay" ? "active" : ""} onClick={() => setProvider("relay")}>
                  Relay
                </button>
              </div>

              <Field label="API key" value={apiKey} onChange={setApiKey} placeholder="sk-..." type="password" />
              {provider === "relay" && (
                <Field
                  label="Relay base URL"
                  value={relayBaseURL}
                  onChange={setRelayBaseURL}
                  placeholder="https://xuedingmao.top/v1"
                />
              )}

              <div className="gridThree">
                <Field label="Search model" value={models.search} onChange={(value) => updateModel("search", value)} />
                <Field label="Design model" value={models.design} onChange={(value) => updateModel("design", value)} />
                <Field label="Image model" value={models.image} onChange={(value) => updateModel("image", value)} />
              </div>

              <label className="switchRow">
                <input
                  type="checkbox"
                  checked={enableImageGeneration}
                  onChange={(event) => setEnableImageGeneration(event.target.checked)}
                />
                <span>Generate key scene images with Artist Agent</span>
              </label>

              <div className="configHint">
                API keys are sent only with the current generation request and are not written to run logs.
              </div>
            </section>
          </div>
        )}

        {workspaceView === "run" ? (
          <div className="workspaceGrid">
            <section className="panel inputPanel">
              <div className="panelHeader">
                <div>
                  <p className="labelText">Input</p>
                  <h3>Study-abroad profile</h3>
                </div>
                <span className="pill">Live search</span>
              </div>

              <div className="gridTwo">
                <Field label="Country" value={profile.country} listId="countries" onChange={(value) => updateProfile("country", value)} />
                <Field label="City" value={profile.city} listId="cities" onChange={(value) => updateProfile("city", value)} />
                <Field label="Subject / Major" value={profile.major} listId="majors" onChange={(value) => updateProfile("major", value)} />
                <Field label="Grade" value={profile.grade} listId="grades" onChange={(value) => updateProfile("grade", value)} />
              </div>

              <datalist id="countries">{PROFILE_SUGGESTIONS.countries.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="cities">{PROFILE_SUGGESTIONS.cities.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="majors">{PROFILE_SUGGESTIONS.majors.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="grades">{PROFILE_SUGGESTIONS.grades.map((item) => <option key={item} value={item} />)}</datalist>

              <div className="actionRow">
                <button className="primaryButton" disabled={loading} onClick={() => generate("live_search")}>
                  {loading ? "Running agents..." : "Run live simulation"}
                </button>
                <button className="secondaryButton" disabled={loading || !selectedPreset} onClick={() => generate("preset")}>
                  Use demo preset
                </button>
              </div>

              {presets.length > 0 && (
                <label className="field compactField">
                  <span>Preset fallback</span>
                  <select value={selectedPreset} onChange={(event) => setSelectedPreset(event.target.value)}>
                    {presets.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {error && <div className="errorBox">{error}</div>}
            </section>

            <section className="panel resultPanel">
              <div className="panelHeader">
                <div>
                  <p className="labelText">Output</p>
                  <h3>Generated experience</h3>
                </div>
                <span className={`runBadge ${pipelineStage}`}>{pipelineStage}</span>
              </div>

              {story ? (
                <div className="resultCard">
                  <p className="labelText">Ready to experience</p>
                  <h2>{story.user_profile.city}, {story.user_profile.country}</h2>
                  <p>{story.framework_reason}</p>
                  <dl>
                    <div>
                      <dt>Framework</dt>
                      <dd>{story.framework_type}</dd>
                    </div>
                    <div>
                      <dt>Nodes</dt>
                      <dd>{Object.keys(story.nodes).length + Object.keys(story.endings).length}</dd>
                    </div>
                    <div>
                      <dt>Debug files</dt>
                      <dd>{runFiles ? Object.keys(runFiles).length : 0}</dd>
                    </div>
                  </dl>
                  <div className="actionRow">
                    <button className="primaryButton" onClick={enterExperience}>
                      Enter experience
                    </button>
                    <button className="secondaryButton" onClick={() => setWorkspaceView("agents")}>
                      Inspect agents
                    </button>
                  </div>
                </div>
              ) : (
                <div className="emptyState">
                  <p className="labelText">No run yet</p>
                  <h2>Configure the workflow and start a run.</h2>
                  <p>The generated game will appear as a separate experience entry after the agents finish.</p>
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className="panel debugPanel">
            <div className="debugTabs">
              {DEBUG_TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={activeDebugTab === tab.id ? "active" : ""}
                  onClick={() => setActiveDebugTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <pre>{runFiles?.[activeDebugTab] ? stringifyDebug(runFiles[activeDebugTab]) : "No output for this stage yet."}</pre>
          </section>
        )}
      </section>
    </main>
  );
}
