# Future Life Simulator

Multi-agent pipeline that turns a study-abroad profile (country → city → university → degree →
program, searched layer-by-layer) into a playable text-adventure game: Search Agent → Design Agent
→ Artist Agent → React frontend, presented as a warm "travel journal / postcard" experience.

Based on the hackathon design doc (v1.0). This README tracks actual implementation status,
not the original spec — see the design doc for full product context, and **`fls-design.md`**
for the full visual/UX design spec (fonts, colors, components, copywriting tone), plus
**`search_agent_strategy.en.md`** / **`.zh.md`** for the Search Agent's source strategy per layer.

## 👋 For teammates picking this up

If you're new to this codebase, read this section first, then skim "Architecture" below.

1. **Get it running**: see "Running locally" — you need Node installed and either an official
   OpenAI API key or access to our team's relay key (中转站). Both work; pick one via the toggle
   on the key-entry screen (see "Provider: relay vs. official OpenAI" below).
2. **Where things live**: almost everything you'd touch day-to-day is in `backend/src/agents/*`
   (the three LLM prompts) and `frontend/src/pages/HomeFlow.tsx` + `frontend/src/components/*`
   (the user-facing flow). `backend/src/config/config.ts` is the one place to flip feature
   toggles or swap models — don't hardcode model names/toggles elsewhere.
3. **If something looks broken that "should" work**: first suspect a **stale dev server**. This
   project has been iterated on across many sessions with `npm run dev` left running in the
   background; if you (or another agent) start a second `vite`/`tsx watch` process without
   killing the old one, your browser may silently keep hitting the old process on the same port
   and never see your latest changes, even after a hard refresh. Check `lsof -iTCP -sTCP:LISTEN`
   for duplicate processes on :5173/:3001 before assuming there's a real bug.
4. **Image generation needs a real OpenAI key**, not the relay — see the callout below. If you
   pick "Official OpenAI" in the key-entry toggle and enter your own key, everything (search,
   story design, AND images) routes straight to `api.openai.com`, bypassing the relay entirely —
   confirmed by code in `backend/src/agents/openaiClient.ts`.
5. **The story is currently a straight line, not a branching tree** (see "TEMP: linear
   storyline" below) — this is intentional for now, not a bug, while we get the core gameplay
   loop right before re-introducing branching paths.
6. **Story caching can surprise you**: identical profiles (down to exact text + casing/whitespace)
   reuse a previously-generated story instead of calling the LLMs again — you'll see a green
   "✨ Reusing a story..." banner when this happens. Pass `regenerate: true` in a manual
   `/api/generate` call, or use the `/debug` page's regenerate button, to force a fresh run.

## Current Status

✅ **Working end-to-end**, tested with a real API key through an OpenAI-protocol relay and
against official OpenAI:
- Live search mode confirmed working end-to-end (Search → Design → Artist → playable story), in
  addition to preset mode
- 2 preset destinations ready: `tokyo_cs` (Tokyo, Computer Science), `toronto_business` (Toronto,
  Business Administration)
- Confirmed via `/api/generate`: both presets and live-search profiles produce valid, fully-linked
  story graphs with correctly-tagged endings (`hopeful` / `bittersweet` / `challenging`)
- Debug/observability: every run persists intermediate agent outputs to disk (see "Debugging" below)
- User-facing UX: passport-style API key entry (with a **relay vs. official OpenAI toggle**) →
  multi-layer accordion quiz (country → city → university → degree → program, each layer
  constrained to results from the previous layer) → "dreaming" loading screen → full-bleed
  cinematic scene playthrough with margin-note stat gauges → postcard ending with tone-based wax
  seal. All dev/agent tooling lives at **`/debug`**, fully separated from the user-facing flow.
- **API key can be edited mid-flow**: a small "🔑 API key" button (visible on every stage except
  the very first onboarding screen) opens the same key-entry card as a modal, without resetting
  quiz progress or the current game.
- **Story caching**: `/api/generate` derives a deterministic story ID from
  `(mode, preset/profile, model config)`, hashed **case/whitespace-insensitively** on free-text
  profile fields (school/department/program) so trivial retyping differences still hit the cache.
  A repeat request instantly returns the previously generated story (`cached: true`) — surfaced to
  the user via a green "✨ Reusing a story..." banner — instead of re-running the pipeline. Pass
  `regenerate: true` in the request body to force a fresh run.
- **Image generation confirmed working** (`enableImageGeneration: true`, now the frontend default)
  — but only against **official OpenAI** (`provider: "openai"`), not the relay. The relay's image
  endpoint returned 429s ("upstream load saturated") on every attempt so far. Artist Agent
  successfully generated and saved real PNGs to `data/assets/generated/` against official OpenAI,
  and they render correctly in the scene frames.
- **Named campus-life detail**: Search Agent now looks for real, named courses, faculty, libraries,
  clubs, and events (from official university pages) and Design Agent weaves them by name into
  scene text/choices, so a specific program feels distinct from a generic "university abroad"
  story. ⚠️ Known risk: the Search Agent's web-search-backed live mode can still hallucinate a
  real person's name at the wrong university despite explicit anti-fabrication prompt instructions
  — accepted as a hackathon-scope risk (see "Known risks" below for hardening options).
- **Relay vs. official OpenAI provider toggle**: the key-entry card (both the first-run screen and
  the mid-flow editor) now shows an explicit sliding toggle to choose the provider, with separate
  API key storage per provider (`fls.apiKey.relay` / `fls.apiKey.openai` in `localStorage`) — fixed
  a bug where switching providers used to silently clear/overwrite the other provider's key.

🚧 **TEMP: linear storyline (no branching tree)** — current design direction, not a bug:
- `backend/src/config/config.ts`'s `story.minNodes`/`maxNodes` are both pinned to `10`, and the
  Design Agent's prompt requires an exact node-id sequence (`opening`, `node2`..`node9`, `ending`)
  where every choice on a given node points to the **same** next node — so choices still carry
  distinct stat consequences, but the visited-node path is always a straight line. To restore
  branching, revert `config.story` to a range (e.g. `12`-`15`) and remove the "LINEAR STORYLINE"
  constraint block in `backend/src/agents/designAgent.ts`'s system prompt.

⚠️ **Not yet resolved:**
- Image generation via the relay — repeatedly hit 429 rate-limits on `gpt-image-1` specifically;
  use `provider: "openai"` with an official OpenAI key for image gen until this is revisited (or
  the relay's image-gen pool recovers).

🐛 **Known issues, mitigated:**
- The Design Agent occasionally generates a `next_node` reference to a node ID it forgot to define. Mitigated with two layers: (1) a self-correction retry loop that feeds the validation error back to the model (up to 4 attempts), (2) an automatic repair pass (`repairDanglingLinks`) that reroutes any still-dangling reference to a valid existing ending, so the pipeline cannot hard-fail on this class of bug. Similarly, `repairChoicelessNodes()` promotes any node with zero choices to an ending.
- The Responses API + `web_search_preview` tool sometimes appends citation/commentary text after the JSON payload, which broke a naive greedy-regex JSON extraction. Fixed with a balanced-brace scanner (`extractBalancedJson`) plus a self-correction retry (up to 3 attempts) that asks the model to reply with JSON only.

## Architecture

```
/backend          Express + TypeScript API server, runs the 4-agent pipeline
  src/agents/      searchAgent.ts, designAgent.ts, artistAgent.ts, openaiClient.ts (shared client)
  src/config/      config.ts <- single place to change models/toggles (see below)
  src/runLogger.ts per-run debug logging (see "Debugging")
  src/server.ts    Express routes + story-cache lookup/key derivation (buildCacheStoryId,
                   canonicalize — see "How story caching matches profiles" below)
  src/types.ts     Shared types: ResearchReport (incl. campus_life_profile), StoryDocument, etc.
/frontend          React + Vite app, two route groups:
  src/pages/HomeFlow.tsx   User-facing flow: key entry -> multi-layer quiz -> dreaming loader ->
                           playthrough -> postcard ending (the "travel journal" theme). Also
                           renders the mid-flow "🔑 API key" trigger + modal and the "reusing a
                           story" banner.
  src/pages/DebugPage.tsx  Dev-only /debug route: provider/model config, manual run trigger,
                           raw agent-output tabs (Search/Design/Artist/Timeline) — the old
                           dashboard UI, unchanged in function, just moved off the main route
  src/components/  PassportCard (key entry, shared by first-run + mid-flow editor), QuizFlow
                    (multi-layer country->city->university->degree->program search), SceneCard,
                    PostcardEnding
  src/styles/       journal.css (user-facing theme), debug.css (dev dashboard, unchanged)
  src/lib/          api.ts (fetch helpers, buildRuntimeConfig), storage.ts (per-provider
                    localStorage credential persistence), gameplay.ts (stat delta / game-over logic)
/data
  /presets         Hand-authored research reports for preset mode (tokyo_cs.json, toronto_business.json)
  /stories         Generated final story JSON per run ({story_id}_final.json) — also the cache store
  /assets/generated  Generated images (when image gen is enabled)
  /runs            Per-run debug output (see "Debugging") — gitignored
```

`POST /api/generate` orchestrates Search → Design → Artist and returns the final story JSON
(or an instantly-returned cached story if one already exists for the same request key).

### How story caching matches profiles

`buildCacheStoryId()` in `server.ts` computes a story ID as `{city}_{12-char hash}`. The hash is a
SHA1 of the entire request payload (`mode`, `presetId` or full `profile`, and model config),
canonicalized so **object key order never matters** and, for the hash only, **string leaves are
trimmed/whitespace-collapsed/lowercased** — so e.g. `"MS in Computer Science"` and
`"ms in computer science"` hash identically and reuse the same cached story. The `{city}` prefix
is purely cosmetic; the hash is the real match key. This means: if every profile field (country,
city, school, department, program, major, grade) and the model config match (modulo
casing/whitespace), you get the cached story — surfaced in the UI via the green reuse banner.

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
                                  // (frontend currently overrides this to true by default)
  maxImagesPerStory: 4,
},
story: {
  // TEMP: pinned to exactly 10 for a linear (non-branching) storyline — see "Current Status".
  // Restore a range (e.g. 12-15) + remove the LINEAR STORYLINE prompt block in designAgent.ts
  // to bring back a branching tree.
  minNodes: 10,
  maxNodes: 10,
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

- **User-facing app**: `http://localhost:5173/` — pick relay or official OpenAI on the key-entry
  card, enter your key (saved per-provider to `localStorage` so switching providers never clears
  the other one's key), search your destination layer-by-layer (country → city → university →
  degree → program), then read/play your generated story. You can reopen the key card anytime via
  the "🔑 API key" button without losing quiz/game progress.
- **Dev console**: `http://localhost:5173/debug` — configure provider/models, trigger runs
  (with cache reuse or forced regeneration), inspect raw per-stage agent output.

### Provider: relay vs. official OpenAI

Both the first-run key-entry screen and the mid-flow "🔑 API key" editor show a sliding toggle:

- **🔀 Relay (中转站)** — needs an API key + base URL (defaults to `https://xuedingmao.top/v1`).
  Cheaper/shared, but its image-generation endpoint has been unreliable (429s) — see "Current
  Status".
- **🤖 Official OpenAI** — needs only your own OpenAI API key; `openaiClient.ts` forces
  `baseURL: "https://api.openai.com/v1"` for every agent call (search, design, **and images**)
  when this is selected, regardless of any relay URL set in `backend/.env` — so this is the
  reliable path for image generation right now.

Each provider's key is stored independently (`fls.apiKey.relay` / `fls.apiKey.openai`), so you can
switch back and forth without re-entering either key.

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
  Agent's output schema changes later (old cached stories could serve a stale shape). Two cache-
  key algorithm changes so far (object-key-order independence, then string
  trim/lowercase/whitespace normalization) each required a one-off manual migration of existing
  cached stories to their new hash — see git history (`3cdef35`, `b3fd6f4`) for the pattern if
  this needs to happen again.
- **Accepted hallucination risk**: the Search Agent's live web-search mode can still fabricate a
  real person's name at the wrong university for `campus_life_profile.notable_faculty`, despite
  explicit anti-fabrication prompt instructions (confirmed with two real professors misattributed
  to the wrong school in testing). Accepted as a hackathon-scope risk. If this needs hardening
  later: either drop named professors in favor of anonymous research-area descriptions, or require
  a verifiable source URL per named person before including them.
- **TEMP linear-storyline mode** (see "Current Status") trades away branching-path gameplay for a
  simpler, more reliable 10-node chain — revisit once the core loop (stats, images, pacing) feels
  right and branching is worth the added complexity/token cost again.

