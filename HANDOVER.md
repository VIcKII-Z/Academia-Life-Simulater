# Handover — Future Life Simulator

This document is the engineering handover for this project: what it is, how it's built, every
notable feature/fix made across the build, and what a new engineer should know before touching
it. For product framing (why this exists) and end-user instructions, see `README.md`. For the
full visual/UX spec (fonts, colors, copywriting tone), see `fls-design.md`.

## 1. What this is

A 4-agent LLM pipeline (Search → Design → Artist → frontend) that turns a study-abroad profile
(country → city → university → degree → program) into a playable, illustrated text-adventure
story ("travel journal / postcard" theme), with stat-tracked choices and a tone-based ending.
Built as a hackathon MVP, then iterated on extensively for UX polish.

- **Backend**: Node.js + TypeScript + Express. Runs the agent pipeline, exposes `/api/generate`
  and debug endpoints, persists per-run debug artifacts and final stories to disk.
- **Frontend**: React + Vite + TypeScript, `react-router-dom` for two route groups (`/` user flow,
  `/debug` dev dashboard).
- **LLM provider**: OpenAI API (official or via a third-party OpenAI-protocol relay, "中转站",
  toggle-able per request). Web search (`web_search_preview` tool via Responses API) for the
  Search Agent in live mode; `gpt-image-1` for the Artist Agent.

## 2. Architecture

```
/backend
  src/agents/searchAgent.ts    Research: profile -> ResearchReport (named courses/faculty/
                                clubs/housing/weather, via live web search or preset JSON)
  src/agents/designAgent.ts    Story writing: ResearchReport -> story graph (nodes, choices,
                                stat deltas, endings) — currently LINEAR (see §4)
  src/agents/artistAgent.ts    Illustration: generates + saves PNGs for nodes flagged has_image
  src/agents/openaiClient.ts   Shared OpenAI client factory; forces official baseURL for
                                provider: "openai" (see §6, critical relay-bypass fix)
  src/config/config.ts         SINGLE source of truth for model names + feature toggles
  src/runLogger.ts             Per-run debug logging to data/runs/{storyId}/
  src/server.ts                Express routes, story-cache key derivation
                                (buildCacheStoryId, canonicalize)
  src/types.ts                 Shared types: ResearchReport, StoryDocument, etc.

/frontend
  src/pages/HomeFlow.tsx       User-facing flow (see component list below)
  src/pages/DebugPage.tsx      /debug: provider/model config, manual run trigger, raw
                                agent-output tabs — unchanged dev dashboard
  src/components/
    PassportCard.tsx           API key entry (first-run + mid-flow "🔑 API key" modal editor);
                                relay vs. official OpenAI toggle; per-provider localStorage keys
    QuizFlow.tsx                Multi-layer accordion quiz: country -> city -> university ->
                                degree -> program, each layer constrained to the previous layer's
                                results (real search-backed autocomplete, not free typing)
    DreamingLoader.tsx          Loading screen while the pipeline runs; narrative lines
                                cosmetically tied to the user's own input
    AdmissionLetter.tsx          Personalized acceptance-letter overlay shown after story load,
                                before node 1 (see §5 for full history)
    SceneCard.tsx                Full-bleed cinematic scene playthrough: generated illustration,
                                margin stat gauges, choice cards, Field Notes panel with sourced
                                facts + link icons, "Why this happens" explainer callouts
    PostcardEnding.tsx           Tone-based ending screen (hopeful/bittersweet/challenging wax
                                seal), final stat recap, "save your story" action
    HighlightedText.tsx          Renders inline highlighted terms/links within story prose
                                (e.g. a housing mention linking out to a map)
    Floaty.tsx                   Small floating decorative/UI chip primitive (used for the
                                housing chip, stat chips, etc.)
    BackgroundMusic.tsx          Ambient background audio component
    icons.tsx                    Shared inline SVG icon components (HeartIcon, SunFaceIcon,
                                CoinIcon, CompassRoseIcon, etc.)
  src/styles/
    journal.css                  User-facing theme (all "travel journal" visual styling —
                                admission letter, cards, quiz, scene, ending, onboarding bg)
    debug.css                    Dev dashboard styling, unchanged from original scaffold
  src/lib/
    api.ts                       fetch helpers, buildRuntimeConfig (per-request provider/model
                                overrides sent to the backend)
    storage.ts                   Per-provider localStorage credential persistence
    gameplay.ts                  Stat delta application / game-over logic

/data
  /presets                      Hand-authored ResearchReport JSON for preset mode
                                (tokyo_cs.json, toronto_business.json)
  /stories                      Generated final story JSON per run, {story_id}_final.json —
                                doubles as the cache store
  /assets/generated             Generated images (when image gen is enabled)
  /runs                         Per-run debug output (gitignored)
```

`POST /api/generate` orchestrates Search → Design → Artist and returns the final story JSON, or
an instantly-returned cached story if one already exists for the same request key (see §3).

## 3. Story caching

`buildCacheStoryId()` in `server.ts` computes a story ID as `{city}_{12-char hash}`. The hash is a
SHA1 of the full request payload (`mode`, `presetId` or full `profile`, and model config),
canonicalized so object key order never matters, and — for the hash only — string leaves are
trimmed / whitespace-collapsed / lowercased, so `"MS in Computer Science"` and
`"ms in computer science"` hash identically and reuse the same story. The `{city}` prefix is
cosmetic; the hash is the real match key. A cache hit surfaces to the user as a green "✨
Reusing a story..." banner. Pass `regenerate: true` in the request body (or use the `/debug`
regenerate button) to force a fresh run.

Two cache-key algorithm changes happened during the build (object-key-order independence, then
string trim/lowercase/whitespace normalization) — each required a one-off manual migration of
existing cached story files to their new hash. See commits `3cdef35`, `b3fd6f4` in git history
for the pattern if this needs to happen again.

## 4. TEMP: linear storyline (intentional, not a bug)

`config.story.minNodes`/`maxNodes` are both pinned to `10`, and the Design Agent's system prompt
requires an exact node-id sequence (`opening`, `node2`..`node9`, `ending`) where every choice on a
given node points to the **same** next node — so choices still carry distinct stat consequences,
but the visited-node path is always a straight line, not a branching tree. This was a deliberate
simplification to get the core gameplay loop (stats, images, pacing, illustrated Field Notes)
solid before re-introducing branching. To restore branching: revert `config.story` to a range
(e.g. `12`-`15`) and remove the "LINEAR STORYLINE" constraint block in
`backend/src/agents/designAgent.ts`'s system prompt.

## 5. Feature-by-feature build history

This section covers everything built/fixed, roughly chronologically, condensed from 16 working
checkpoints:

1. **Initial scaffold + merge** — Express+TS backend, Vite+React frontend, 4-agent pipeline,
   preset mode (`tokyo_cs`, `toronto_business`), live search mode via Responses API
   `web_search_preview`. Merged a teammate's parallel fork (stat-based gameplay: health/mood/
   money with `stat_delta` per choice, runtime config support, `/api/shutdown`). Fixed a
   regression where the Design Agent could emit a choiceless node (implicit ending never routed
   to the endings map) via `repairChoicelessNodes()` + defensive guards in `normalizeStats()`.
2. **Image generation baseURL bug** — the OpenAI SDK silently falls back to
   `process.env.OPENAI_BASE_URL` whenever `baseURL` is `undefined` in the client constructor, so
   passing `undefined` did NOT mean "use the official API" while `backend/.env` still pointed at
   the relay. Fixed in `openaiClient.ts` by explicitly passing
   `"https://api.openai.com/v1"` when `provider: "openai"`, guaranteeing official-API requests
   truly bypass the relay — critical because the relay's image endpoint 429s ("upstream load
   saturated") on every attempt, while official OpenAI works reliably for `gpt-image-1`.
3. **Immersive UX redesign ("warm travel-journal/postcard" theme)** — full rebuild of the
   user-facing flow and visual language, documented in `fls-design.md`: PassportCard (API key
   entry) → QuizFlow (accordion, one question at a time) → DreamingLoader → SceneCard
   (Polaroid-framed illustrations + stat gauges + choice cards) → PostcardEnding (tone-colored wax
   seal). `/debug` kept as the untouched original dashboard, fully separated from the user flow.
4. **Search Agent Layer-0 accessibility fix, cache normalization, mid-flow key edit, campus
   detail** — Search Agent upgraded to look for real, named courses/faculty/libraries/clubs/
   events from official university pages so Design Agent can weave them into scene text/choices
   by name (a specific program reads distinct from a generic "university abroad" story). Added
   the "🔑 API key" mid-flow editor button (visible on every stage but the first onboarding
   screen) so users can fix/swap a key without losing quiz or game progress.
5. **Provider toggle (relay vs. official OpenAI)** — sliding toggle on both the first-run
   key-entry card and the mid-flow editor; separate localStorage keys per provider
   (`fls.apiKey.relay` / `fls.apiKey.openai`) so switching providers never clobbers the other's
   saved key (previously a bug: switching used to silently clear/overwrite the other key).
6. **Strict multi-layer onboarding scoping** — each quiz layer (country/city/university/degree/
   program) is constrained to results returned for the *previous* answer only, avoiding
   mismatched combinations (e.g. a city not actually in the chosen country).
7. **2-choice stats + semester-scaled stories** — tuned stat deltas per choice and scaled certain
   story elements (pacing/stakes) to the chosen program length (e.g. semester vs. full degree).
8. **Immersive UI — sources, icons, highlighted text, pixel font experiments** — added a Field
   Notes panel surfacing the real-world facts a scene is grounded in, each with a source link and
   a link icon (iterated multiple times on icon size/format — settled on a clear, appropriately
   sized SVG/PNG icon rather than a tiny illegible one); added `HighlightedText.tsx` so inline
   story prose can highlight a place/thing and link out (e.g. a mention of the dorm links to
   Google Maps); briefly tried a pixel font for Field Notes headers, then reverted so headers
   match the same typography as the rest of the card ("About this history" / "Why this happens"
   sections use identical formatting).
9. **Button restyle, NaN stat fix, university search fix** — restyled primary CTA buttons using
   branding assets (`primary-button-clean.png` etc.); fixed a stat display bug that could render
   `NaN` when a stat delta was missing/undefined; fixed the university search step returning
   incorrect/empty results for certain city inputs.
10. **Field Notes corner redesign** — repositioned the Field Notes card's "housing" indicator
    from an inline chip near the research text (which visually competed with the main content) to
    a dedicated chip anchored at the top-right corner of the Field Notes card, sized to be
    legible, with the housing icon (PNG, enlarged per user feedback) sitting above wrapped label
    text rather than squeezing text next to a tiny icon.
11. **Ending screen: stats, save story, icon fixes** — final stat recap on the postcard ending;
    replaced a placeholder "hopeful" icon with a proper envelope icon (`envelope.svg`); renamed the
    "dream" CTA button to warmer, more casual copy; added a "save your sealed story" option that
    bundles the story along with its accumulated Field Notes for the user to keep.
12. **Admission letter feature** (see next section for full detail) — a personalized acceptance
    letter with confetti, shown after the story loads and before node 1, referencing the
    university/program/grade the user entered.
13. **Admission letter redesign to match a formal-letter reference layout** — restructured from a
    centered "certificate" look to a left-aligned, formal official-letter look: date line,
    terracotta accent bar, mascot+university header row, "Dear future {grade} student,"
    salutation, bold "Congratulations!" opening line in serif body copy, ink accent bar above the
    CTA. Kept the mascot image and confetti animation, which the user explicitly wanted preserved
    across the redesign.
14. **Onboarding background + card sizing passes** — replaced the onboarding/homepage background
    multiple times per user reference images (`background.png` → `background1.png`), fixed an
    unwanted yellow focus-glow border and a missing pencil icon on `input.png`-styled input bars,
    and finally restored the onboarding `.journalCard` to its default 560px width after an earlier
    override had shrunk/repositioned it to 440px for a background image that (on inspection)
    never actually needed the card to be resized around it.

## 6. The admission letter feature — full detail

**What it does**: after the pipeline finishes generating a story (or a cached story loads), the
user sees a full-screen overlay styled as a physical acceptance letter — mascot in the header,
confetti (彩带) animation, and letter body dynamically referencing the specific university,
grade level, and program the user entered during onboarding — before clicking through to the
first story node. This mirrors the emotional beat of *actually* opening a real acceptance letter,
which the user specifically asked to have match "how you opened the application portal and got
admitted."

**Component**: `frontend/src/components/AdmissionLetter.tsx`
- Computes `today` via `useMemo` + `toLocaleDateString` for the date line.
- Renders (in the final, formal-letter version):
  1. `.admissionDate` — today's date, top-right or top-left per CSS
  2. `.admissionAccentBar` — a terracotta horizontal accent bar
  3. `.admissionHeader` — flex row: mascot `<img className="admissionSealIcon">` (64×64, not
     circular in the final version) + a text block with `.admissionUniversity` (bold, the
     specific university name the user entered) and `.admissionDept` (italic serif subtitle)
  4. `.admissionSalutation` — "Dear future {grade} student," in Georgia serif
  5. `.admissionBody` — leads with bold "Congratulations!" then a paragraph of acceptance copy in
     Georgia serif, referencing the program
  6. `.admissionFooterBar` — a second, ink-colored accent bar
  7. A CTA button row ("Begin your story" or similar) that dismisses the overlay and advances to
     the first story node
- Confetti is a separate lightweight animation layer, unaffected by the multiple layout
  redesigns (kept per explicit user request every time the layout changed).

**Styling**: `frontend/src/styles/journal.css`, search `.admissionLetter`. Went through two full
redesigns:
- v1: centered "certificate" look — circular mascot seal, centered kicker/title/body/footer.
- v2 (current): left-aligned formal letter — see structure above. `.admissionLetter` is
  `text-align: left`, `max-width: 560px`. `.admissionLetter .journalButtonRow` overridden to
  `justify-content: flex-start` to match the left-aligned letter body (rather than the centered
  button row used elsewhere in the app).

**Verification approach used throughout**: Playwright walkthrough using `dummy-key` (never a real
API key — see §7) through onboarding to the cached Boston/Northeastern demo story
(`boston_7867de510c6a_final.json`), screenshotting the letter at each redesign, and confirming
"Begin your story" still cleanly transitions to node 1 afterward.

## 7. Important operational notes for whoever picks this up next

- **Never use a real OpenAI API key for verification/testing in this repo** — the user explicitly
  revoked permission to use any API key they'd previously shared for testing purposes. Always use
  `dummy-key` plus a cached demo story (e.g. the Boston/Northeastern one referenced above) to
  exercise the UI. Never call `/api/health/openai` or trigger real story generation during
  automated verification.
- **Playwright onboarding flow** (fastest path to a cached story, no real API calls): enter
  `dummy-key` → "Open my journal" → click a country (e.g. "United States", auto-advances) → click
  a city (e.g. "Boston", auto-advances) → click a university (e.g. "Northeastern University",
  auto-advances to degree) → click "Undergraduate" → "Next" → semester/program step → "Begin my
  story" → wait ~6s → admission letter appears → "Begin your story" → first story node.
- **Stale dev server risk**: this project has been iterated on across many sessions with
  `npm run dev` left running in the background. If a second `vite`/`tsx watch` process starts
  without killing the old one, the browser may silently keep hitting the old process on the same
  port and never show your latest changes, even after a hard refresh. Check
  `lsof -iTCP -sTCP:LISTEN` for duplicate processes on `:5173`/`:3001` before assuming there's a
  real bug.
- **Shared-file commit hygiene**: `journal.css` is a single large stylesheet touched by nearly
  every UI task. When committing changes to it, double-check `git diff` scope before `git add` —
  it's easy to accidentally bundle in an unrelated pending edit sitting in the same file (this
  happened once: a background/card-sizing tweak got swept into an unrelated admission-letter
  commit because both were unstaged changes to `journal.css` at commit time).
- **Repo has many unrelated untracked files** — generated story image assets, `data/runs/*`,
  `data/stories/*_final.json`, `data.zip`, ad hoc screenshot PNGs, and a couple of branding assets
  that arrived via file drops (`compass.png`, `background1.png`, etc.) — these are intentionally
  left untouched/untracked unless a task specifically calls for committing one of them.
- **`design.md` vs `fls-design.md`**: `design.md` at the repo root is an unrelated, pre-existing
  file from a different app ("slot machine" design doc) that happened to already exist in this
  directory — it is not part of this project. This project's real design spec is
  `fls-design.md`.

## 8. Known risks / open items (carried over, still relevant)

- Relay's exact supported model list is unconfirmed — model names in `config.ts` may need
  updating to match the relay's model list if they differ from official OpenAI names
  (`gpt-4o-mini` / `gpt-4o` confirmed working so far).
- Image generation works against official OpenAI but 429s against the current relay
  (`xuedingmao.top`) — use `provider: "openai"` for image gen for now.
- Some Design Agent endings have been observed omitting the `has_image` field entirely (falls
  back to falsy in the frontend, so it doesn't crash, but it's a minor schema drift worth
  tightening).
- Only 2 presets exist (`tokyo_cs`, `toronto_business`) — more would help guarantee demo coverage.
- Story cache has no eviction/versioning if the Design Agent's output schema changes later (an
  old cached story could serve a stale shape to the frontend).
- **Accepted hallucination risk**: the Search Agent's live web-search mode can still fabricate a
  real person's name at the wrong university for `campus_life_profile.notable_faculty` despite
  explicit anti-fabrication prompt instructions (confirmed with two real professors misattributed
  in testing). If hardening is needed: drop named professors in favor of anonymous
  research-area descriptions, or require a verifiable source URL per named person.
- **TEMP linear-storyline mode** (§4) trades away branching-path gameplay for a simpler, more
  reliable 10-node chain — revisit once the core loop (stats, images, pacing, Field Notes) feels
  fully right and branching is worth the added complexity/token cost again.

## 9. Where to look for more detail

- `README.md` — product framing, end-user usage guide, current status, config reference, API
  endpoint table, debugging guide.
- `fls-design.md` — full visual/UX design spec (typography, palette, components, copywriting
  tone, accessibility, motion).
- `search_agent_strategy.en.md` / `.zh.md` — Search Agent's source strategy per research layer.
- `git log` — 17 commits total on this repo's flattened history; commit messages are
  reasonably descriptive of scope per change.
