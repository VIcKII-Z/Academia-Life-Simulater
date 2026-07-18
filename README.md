# Future Life Simulator

Multi-agent pipeline that turns a study-abroad profile (country / city / grade / major)
into a playable text-adventure game: Search Agent → Design Agent → Artist Agent → React frontend.

Based on the hackathon design doc (v1.0). This README tracks actual implementation status,
not the original spec — see the design doc for full product context.

## Current Status (as of last session)

✅ **Working end-to-end**, tested with a real API key through an OpenAI-protocol relay:
- Preset mode: Search Agent (skips API call, reads hand-authored JSON) → Design Agent (LLM call) → Artist Agent (stubbed/optional) → playable story in browser
- 2 preset destinations ready: `tokyo_cs` (Tokyo, Computer Science), `toronto_business` (Toronto, Business Administration)
- Confirmed via `/api/generate`: both presets produce valid, fully-linked story graphs with correctly-tagged endings (`hopeful` / `bittersweet` / `challenging`)
- Debug/observability: every run persists intermediate agent outputs to disk (see "Debugging" below)

⚠️ **Not yet tested / disabled by default:**
- Live search mode (`enableLiveSearch: false`) — Search Agent would call OpenAI's `web_search_preview` tool via the Responses API; untested against the relay, which may only proxy `/chat/completions`
- Image generation (`enableImageGeneration: false`) — Artist Agent would call `gpt-image-1`; untested against the relay

🐛 **Known issue, mitigated:** the Design Agent occasionally generates a `next_node` reference to a node ID it forgot to define. Mitigated with two layers: (1) a self-correction retry loop that feeds the validation error back to the model (up to 4 attempts), (2) an automatic repair pass (`repairDanglingLinks`) that reroutes any still-dangling reference to a valid existing ending, so the pipeline cannot hard-fail on this class of bug.

## Architecture

```
/backend          Express + TypeScript API server, runs the 4-agent pipeline
  src/agents/      searchAgent.ts, designAgent.ts, artistAgent.ts, openaiClient.ts (shared client)
  src/config/      config.ts <- single place to change models/toggles (see below)
  src/runLogger.ts per-run debug logging (see "Debugging")
  src/server.ts    Express routes
/frontend          React + Vite app; fetches generated story JSON and renders it as a
                   choice-driven state machine (node graph -> scene text/image -> choices -> ending)
/data
  /presets         Hand-authored research reports for preset mode (tokyo_cs.json, toronto_business.json)
  /stories         Generated final story JSON per run ({story_id}_final.json)
  /assets/generated  Generated images (when image gen is enabled)
  /runs            Per-run debug output (see "Debugging") — gitignored
```

`POST /api/generate` orchestrates Search → Design → Artist and returns the final story JSON.

## Configuration

All tunable behavior lives in **`backend/src/config/config.ts`** — no other file should hardcode
model names or feature toggles.

```ts
openai: {
  baseURL: "", // set to an OpenAI-protocol-compatible relay URL, e.g. "https://xuedingmao.top/v1"
},
models: {
  search: "gpt-4o",       // must support the web_search tool (live search mode only)
  design: "gpt-4o-mini",  // bump to "gpt-4o" if JSON/story quality is unreliable
  image: "gpt-image-1",
},
features: {
  enableLiveSearch: false,       // false = Search Agent reads /data/presets/*.json (free, instant)
  enableImageGeneration: false,  // false = Artist Agent is skipped, no image API calls
  maxImagesPerStory: 4,
},
```

### Environment variables (`backend/.env`, see `.env.example`)

```
OPENAI_API_KEY=...       # required — official OpenAI key, or your relay/proxy key
PORT=3001
OPENAI_BASE_URL=...      # optional — omit for official api.openai.com, or point at a relay
```

We're currently using a third-party OpenAI-protocol relay ("中转站"), `https://xuedingmao.top/v1`,
with model `gpt-4o-mini` for the Design Agent — confirmed working.

## Running locally

```bash
# Backend
cd backend
npm install
cp .env.example .env   # then fill in OPENAI_API_KEY (and OPENAI_BASE_URL if using a relay)
npm run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173 — open this in your browser
```

Frontend dev server proxies `/api` and `/assets` to the backend (see `frontend/vite.config.ts`).

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Dump the current resolved config (models, feature toggles) |
| GET | `/api/presets` | List available preset IDs |
| GET | `/api/health/openai` | Quick connectivity check against the configured OpenAI/relay endpoint |
| POST | `/api/generate` | Run the full pipeline. Body: `{ "mode": "preset", "presetId": "tokyo_cs" }` or `{ "mode": "live_search", "profile": {...} }` |
| GET | `/api/runs` | List all past pipeline runs (debug) |
| GET | `/api/runs/:storyId` | Fetch every stage's raw output for one run (debug) |

## Debugging — inspecting what each agent produced

Every `/api/generate` call writes its intermediate outputs to `data/runs/{storyId}/`:

- `00_meta.json` — mode, preset/profile, timestamps
- `01_search_report.json` — Search Agent's raw research report
- `02_design_skeleton.json` — Design Agent's story graph, before Artist Agent touches it
- `03_artist_final.json` — final output (what the frontend actually receives)
- `log.txt` — human-readable timeline with per-stage duration and failure details

Also queryable live via `GET /api/runs` and `GET /api/runs/:storyId`, and every stage
transition is logged to the backend console (`[RunLogger] {storyId} :: {stage} started/completed`).

## Known risks / open items

- Relay's exact supported model list is unconfirmed — model names in `config.ts` may need
  updating to match whatever the relay's "支持模型" page calls them, if they differ from
  official OpenAI names (`gpt-4o-mini` confirmed working so far).
- Live search mode is coded (`searchAgent.ts` → `runSearchAgentLive`) but untested; the relay
  may not proxy the Responses API's `web_search_preview` tool. May need a dedicated search API
  (e.g. Tavily) if the relay only supports `/chat/completions`.
- Image generation is coded (`artistAgent.ts`) but untested against the relay's image endpoint.
- Some Design Agent endings have been observed omitting the `has_image` field entirely (falls
  back to falsy in the frontend, so it doesn't crash, but it's a minor schema drift worth
  tightening if time allows).
- Only 2 preset combos exist; doc calls for a handful more to guarantee demo coverage.
