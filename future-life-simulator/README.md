# Future Life Simulator

Multi-agent pipeline that turns a study-abroad profile (country / city / grade / major)
into a playable text-adventure game: Search Agent → Design Agent → Artist Agent → React frontend,
presented as a warm "travel journal / postcard" experience.

Based on the hackathon design doc (v1.0). This README tracks actual implementation status,
not the original spec — see the design doc for full product context, and **`fls-design.md`**
for the full visual/UX design spec (fonts, colors, components, copywriting tone).

## Current Status (as of last session)

✅ **Working end-to-end**, tested with a real API key through an OpenAI-protocol relay:
- Live search mode confirmed working end-to-end through the relay (Search → Design → Artist → playable story), in addition to preset mode
- 2 preset destinations ready: `tokyo_cs` (Tokyo, Computer Science), `toronto_business` (Toronto, Business Administration)
- Confirmed via `/api/generate`: both presets and live-search profiles produce valid, fully-linked story graphs with correctly-tagged endings (`hopeful` / `bittersweet` / `challenging`)
- Debug/observability: every run persists intermediate agent outputs to disk (see "Debugging" below)
- **New user-facing UX**: passport-style API key entry → one-question-at-a-time quiz intake → "dreaming" loading screen → Polaroid-framed playthrough with margin-note stat gauges → postcard ending with tone-based wax seal. All dev/agent tooling lives at **`/debug`**, fully separated from the user-facing flow.
- **Story caching**: `/api/generate` derives a deterministic story ID from `(mode, preset/profile, model config)`; a repeat request instantly returns the previously generated story (`cached: true`) instead of re-running the pipeline. Pass `regenerate: true` in the request body to force a fresh run.
- **Image generation confirmed working** (`enableImageGeneration: true`) — but only against **official OpenAI** (`provider: "openai"`), not the relay. The relay's image endpoint returned 429s ("upstream load saturated") on every attempt. Artist Agent successfully generated and saved real PNGs to `data/assets/generated/`, and they render correctly in the Polaroid scene frames.

⚠️ **Not yet tested against the relay:**
- Image generation via the relay — repeatedly hit 429 rate-limits; use `provider: "openai"` with an official OpenAI key for image gen until this is revisited.

🐛 **Known issues, mitigated:**
- The Design Agent occasionally generates a `next_node` reference to a node ID it forgot to define. Mitigated with two layers: (1) a self-correction retry loop that feeds the validation error back to the model (up to 4 attempts), (2) an automatic repair pass (`repairDanglingLinks`) that reroutes any still-dangling reference to a valid existing ending, so the pipeline cannot hard-fail on this class of bug. Similarly, `repairChoicelessNodes()` promotes any node with zero choices to an ending.
- The Responses API + `web_search_preview` tool sometimes appends citation/commentary text after the JSON payload, which broke a naive greedy-regex JSON extraction. Fixed with a balanced-brace scanner (`extractBalancedJson`) plus a self-correction retry (up to 3 attempts) that asks the model to reply with JSON only.

## Architecture

```
/backend          Express + TypeScript API server, runs the 4-agent pipeline
  src/agents/      searchAgent.ts, designAgent.ts, artistAgent.ts, openaiClient.ts (shared client)
  src/config/      config.ts <- single place to change models/toggles (see below)
  src/runLogger.ts per-run debug logging (see "Debugging")
  src/server.ts    Express routes + story-cache lookup/key derivation
/frontend          React + Vite app, two route groups:
  src/pages/HomeFlow.tsx   User-facing flow: passport entry -> quiz -> dreaming loader ->
                           playthrough -> postcard ending (the "travel journal" theme)
  src/pages/DebugPage.tsx  Dev-only /debug route: provider/model config, manual run trigger,
                           raw agent-output tabs (Search/Design/Artist/Timeline) — the old
                           dashboard UI, unchanged in function, just moved off the main route
  src/components/  PassportCard, QuizFlow, DreamingLoader, SceneCard, PostcardEnding
  src/styles/       journal.css (user-facing theme), debug.css (dev dashboard, unchanged)
  src/lib/          api.ts (fetch helpers), storage.ts (localStorage credential persistence),
                    gameplay.ts (stat delta / game-over logic)
/data
  /presets         Hand-authored research reports for preset mode (tokyo_cs.json, toronto_business.json)
  /stories         Generated final story JSON per run ({story_id}_final.json) — also the cache store
  /assets/generated  Generated images (when image gen is enabled)
  /runs            Per-run debug output (see "Debugging") — gitignored
```

`POST /api/generate` orchestrates Search → Design → Artist and returns the final story JSON
(or an instantly-returned cached story if one already exists for the same request key).

## Configuration

All tunable behavior lives in **`backend/src/config/config.ts`** — no other file should hardcode
model names or feature toggles. In the running app, the same values can be overridden per-request
from the **`/debug`** page (provider, API key, base URL, model names, image-gen toggle) without
editing this file.

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
with model `gpt-4o-mini` for the Design Agent and `gpt-4o` for the Search Agent — both confirmed
working, including live search via the Responses API `web_search_preview` tool.

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

- **User-facing app**: `http://localhost:5173/` — enter your API key once (saved to
  `localStorage`), answer four quiz questions, then read/play your generated story.
- **Dev console**: `http://localhost:5173/debug` — configure provider/models, trigger runs
  (with cache reuse or forced regeneration), inspect raw per-stage agent output.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Dump the current resolved config (models, feature toggles) |
| GET | `/api/presets` | List available preset IDs |
| GET | `/api/health/openai` | Quick connectivity check against the configured OpenAI/relay endpoint |
| POST | `/api/generate` | Run the pipeline (or return a cached story). Body: `{ "mode": "preset", "presetId": "tokyo_cs" }` or `{ "mode": "live_search", "profile": {...} }`, plus optional `"regenerate": true` to bypass the cache |
| GET | `/api/runs` | List all past pipeline runs (debug) |
| GET | `/api/runs/:storyId` | Fetch every stage's raw output for one run (debug) |

## Debugging — inspecting what each agent produced

Every `/api/generate` call writes its intermediate outputs to `data/runs/{storyId}/`:

- `00_meta.json` — mode, preset/profile, timestamps
- `01_search_report.json` — Search Agent's raw research report
- `02_design_skeleton.json` — Design Agent's story graph, before Artist Agent touches it
- `03_artist_final.json` — final output (what the frontend actually receives)
- `log.txt` — human-readable timeline with per-stage duration and failure details

Also queryable live via `GET /api/runs` and `GET /api/runs/:storyId`, or from the **`/debug`**
page's "Agent Outputs" tabs, and every stage transition is logged to the backend console
(`[RunLogger] {storyId} :: {stage} started/completed`).

## Known risks / open items

- Relay's exact supported model list is unconfirmed — model names in `config.ts` may need
  updating to match whatever the relay's "支持模型" page calls them, if they differ from
  official OpenAI names (`gpt-4o-mini` and `gpt-4o` confirmed working so far).
- Image generation works against official OpenAI but fails with 429s against the current relay
  (xuedingmao.top) — use `provider: "openai"` for image gen for now.
- **Critical fix applied**: the OpenAI SDK silently falls back to `process.env.OPENAI_BASE_URL`
  whenever `baseURL` is `undefined` in the client constructor — passing `undefined` does NOT mean
  "use the official API" if that env var is set (which it is, to the relay, in `backend/.env`).
  `openaiClient.ts` now explicitly passes `"https://api.openai.com/v1"` when `provider: "openai"`
  to guarantee official-API requests actually bypass the relay.
- Some Design Agent endings have been observed omitting the `has_image` field entirely (falls
  back to falsy in the frontend, so it doesn't crash, but it's a minor schema drift worth
  tightening if time allows).
- Only 2 preset combos exist; doc calls for a handful more to guarantee demo coverage.
- Story cache is keyed on `(mode, preset/profile, model config)` and stored as plain files in
  `data/stories/` — fine for a hackathon demo, but has no eviction/versioning if the Design
  Agent's output schema changes later (old cached stories could serve a stale shape).

