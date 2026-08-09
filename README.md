# Future Life Simulator

Multi-agent pipeline that turns a study-abroad profile (country → city → university → degree →
program, searched layer-by-layer) into a playable text-adventure game: Search Agent → Design Agent
→ Artist Agent → React frontend, presented as a warm "travel journal / postcard" experience.

## 🧑‍⚖️ TL;DR for judges

- **What it is:** you tell it your intended country → city → university → degree → program, and
  it generates a personalized, playable "preview" of what that specific study-abroad life would
  actually feel like — real courses/clubs/neighborhoods woven into a choice-driven story with
  stat consequences (health/mood/money/school), pixel-art scene illustrations, and a tone-based
  ending (hopeful / bittersweet / challenging).
- **Why we built it:** study-abroad decisions are high-stakes but low-context — students without
  paid consultants or personal networks have no way to "try before you buy" a specific school and
  city. See **"Why we built this"** below for the full motivation.
- **How to try it in under a minute:** run the two `npm run dev` commands under "Running
  locally", open `http://localhost:5173`, and answer the destination quiz. Provider credentials
  are read by the backend and are never shipped to the browser. See **"How to use it"** for the full
  walkthrough.
- **What's real vs. simulated:** every story is grounded in agent-researched, named real-world
  details (see "Architecture" and `search_agent_strategy.en.md`) — not generic AI filler. Known
  limitations/risks are documented under "Known risks / open items" rather than hidden.

Based on the hackathon design doc (v1.0). This README tracks actual implementation status,
not the original spec — see the design doc for full product context, and **`fls-design.md`**
for the full visual/UX design spec (fonts, colors, components, copywriting tone), plus
**`search_agent_strategy.en.md`** / **`.zh.md`** for the Search Agent's source strategy per layer.

For a full engineering write-up of everything built this project (architecture decisions, every
feature added, every bug fixed, and why), see **[`HANDOVER.md`](./HANDOVER.md)**.

## 🛠️ Built with

This project's code was built with **OpenAI Codex (CLI)**, powered by **GPT-5.6**, as our primary
AI coding assistant throughout development — from scaffolding the multi-agent backend pipeline
and React frontend, to iterating on UI/UX bugs and agent-prompt tuning across many rounds of
testing and feedback. Codex was used interactively, in the loop with our own review at every
step: we drove the product direction and validated every change (via `tsc --noEmit`, manual
testing, and live pipeline runs) rather than accepting generated code unreviewed.

## 🌍 Why we built this

Deciding to study abroad is one of the biggest leaps a student can take — and it's also one of
the most **unequally supported** decisions in education. Students from well-resourced families
can lean on paid consultants, alumni networks, campus visits, and relatives who've "been there" to
turn an overwhelming choice (which country? which city? which university? which program?) into a
guided, low-anxiety process. Students without that access — first-generation applicants,
students in rural or low-income communities, international students with no local contacts, or
anyone who simply can't afford a $5,000 consulting package — are often left to piece together the
same decision from scattered forums, outdated blog posts, and marketing brochures, with no way to
"try before you buy" and truly picture what daily life would feel like at a specific school.

**Future Life Simulator exists to close that gap.** It uses AI not to replace research, but to
democratize the *narrative* — the lived-experience layer that's usually gatekept behind personal
networks and paid advising:

- **Real information, not generic fluff.** The Search Agent grounds every story in actual,
  named details about the chosen university (real courses, clubs, libraries, neighborhoods,
  even weather and typical housing), so a Northeastern CS story reads nothing like a generic
  Boston story — the same quality of specific, insider-feeling detail a well-connected student
  would get from a mentor, available to anyone with an internet connection.
- **Emotional rehearsal, not just facts.** By turning that research into a playable, choice-driven
  story with stat consequences (health/mood/money) and multiple tone-based endings, the app lets
  a student *feel* the tradeoffs of a decision — a tight budget, homesickness, a challenging
  first semester — before they've committed a single application fee, in a safe, low-stakes,
  even playful format.
- **Low barrier to entry.** No login wall, no paywall beyond bringing your own (optional, free-tier
  eligible) OpenAI API key; runs entirely from a browser; presets are available so the experience
  works even without live search or an API key at all.
- **A companion, not a gatekeeper.** The tone throughout — warm, encouraging, occasionally
  funny — is intentional: this is meant to feel like a supportive older sibling walking you
  through "what if", not another intimidating institutional form.

We think this is a small but meaningful example of what AI-for-education can look like when it's
designed around **access** first: not a shinier tutoring tool for students who already have
support, but a way to hand a bit of that "insider" guidance to students who currently have to go
without it.

## 🎮 How to use it (for end users)

1. **Open the app** at the URL your team gives you (locally: `http://localhost:5173`).
2. **No API key is required in the browser.** The hosted backend supplies separate credentials
   for text generation, live research, and images. The optional "Travel key" dialog is only for
   developers who deliberately want to override those defaults in their own browser.
3. **Tell it about your dream destination**, one question at a time: country → city →
   university → degree level → program/major. Each step's options are generated from the
   previous answer, so you're always picking from real, relevant choices rather than typing
   into a void.
4. **Watch it "dream"** — a short loading screen while the Search → Design → Artist pipeline
   researches your destination and writes your story (or instantly loads a cached story if
   someone already generated this exact combination).
5. **Open your admission letter** — a personalized, confetti-filled acceptance letter addressed
   to you, referencing the university and program you picked, before your story begins.
6. **Play through your story**: read each scene (with a generated illustration when available),
   check your stat gauges (health/mood/money) in the margin, and pick one of the choices offered —
   each choice nudges your stats and moves you to the next scene. Field Notes on the side surface
   the real-world facts your story is grounded in, with source links so you can verify or dig
   deeper into anything that surprised you.
7. **Reach your ending** — one of several tone-based outcomes (hopeful / bittersweet /
   challenging) summarizing how your simulated journey turned out, with a final stats recap.
8. **Save your story** if you want to keep it — the ending screen offers a way to save your
   sealed story along with its Field Notes for later.
9. **Try again** with a different destination any time — every unique combination of answers
   gets its own story, and repeats are served instantly from cache.

## 👋 For teammates picking this up

If you're new to this codebase, read this section first, then skim "Architecture" below.

1. **Get it running**: see "Running locally" — you need Node plus the backend environment values
   documented in `.env.example`. Text generation and OpenAI search/images are configured separately.
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

🧭 **Braided branching storyline:**
- The Design Agent now generates a compact A/B → C topology instead of a single straight line.
  Some choice pairs create a short branch into different nodes, then converge back into a shared
  scene; other choice pairs intentionally keep the same `next_node` and only change stats. This
  gives real story variation without exploding generation cost into a full binary tree.
- The default 1-semester flow is now a little longer, with richer choice text that names both the
  concrete action and the tradeoff instead of using short button-label phrasing.
- Image generation is also anchor-based: not every node needs a new image. Similar nearby scenes
  can reuse the closest generated visual, while major location/emotion changes and endings keep
  their own visual anchors.

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
  maxImagesPerStory: 12,
},
story: {
  // Braided storyline: short A/B branches can merge back into shared nodes.
  // Actual node count scales with UserProfile.semesters.
  minNodes: 13,
  maxNodes: 13,
},
```

### Environment variables (`backend/.env`, see `.env.example`)

```
GCLI_API_KEY=...         # Gemini-compatible relay, used only for story planning and prose
GCLI_BASE_URL=https://gcli.ggchan.dev/v1
GCLI_MODEL=gemini-3-flash-preview
OPENAI_API_KEY=...       # official OpenAI, used only for web search and image generation
PORT=3001
```

The services are deliberately split: `gemini-3-flash-preview` on the GCLI-compatible relay writes
the logic and prose; official OpenAI `gpt-4o` performs Responses API web search; official
`gpt-image-1` generates images. Browser requests contain no backend API keys.

## Running locally

```bash
# Backend
cd backend
npm install
cp .env.example .env   # then fill in GCLI_API_KEY and OPENAI_API_KEY
npm run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173 — open this in your browser
```

Frontend dev server proxies `/api` and `/assets` to the backend (see `frontend/vite.config.ts`).

- **User-facing app**: `http://localhost:5173/` — search your destination layer-by-layer
  (country → city → university → degree → program), then read/play the generated story. No
  browser API key is required.
- **Dev console**: `http://localhost:5173/debug` — configure provider/models, trigger runs
  (with cache reuse or forced regeneration), inspect raw per-stage agent output.

### Service routing

- **Text planning and prose:** GCLI-compatible relay, `gemini-3-flash-preview`.
- **Live web research:** official OpenAI Responses API with `web_search_preview`.
- **Images:** official OpenAI Images API with `gpt-image-1`.
- **Optional browser override:** the "Travel key" dialog can replace the default text provider for
  a developer session; it is not part of normal visitor onboarding.

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

## Open items

- Relay's exact supported model list is unconfirmed — model names in `config.ts` may need
  updating to match whatever the relay's page calls them, if they differ from
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

