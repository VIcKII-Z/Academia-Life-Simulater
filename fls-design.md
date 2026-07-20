# Design Guidance — Future Life Simulator

## App Visual Direction

The app should feel like flipping through a **personal travel journal or passport**, written by someone
imagining their future life abroad before it happens. The core visual metaphor is a **paper travel
journal / postcard collection**, so the interface should feel warm, intimate, tactile, and slightly
nostalgic — like something you'd want to keep, not a product dashboard.

The design should balance:

- **Cinematic warmth** for scene moments (images, story text, endings)
- **Quiet, paper-like calm** for everything else (inputs, transitions, chrome)
- **Editorial clarity** for layout, spacing, and hierarchy — never busier than the story itself

Avoid making the app look like a SaaS admin tool, a dev dashboard, or a game HUD. The mood should be
dreamy, reflective, and personal — this is for someone who has never been to a place, imagining what
their life there could feel like. All pipeline/agent/config language ("Search Agent", "Design Agent",
"Configuration") is developer-facing only and must never appear in the user-facing flow (see `/debug`).

*(Note: this document is written fresh for this project. It borrows the two-font-system pattern, the
type-hierarchy table format, and the accessibility/motion guidance structure from a prior unrelated
project's design.md as a useful shape — but every color, motif, and tone decision below is new and
specific to this app.)*

---

## Typography

Use two font systems:

### 1. Journal Display Font

Use a warm, slightly editorial **serif** (e.g. "Fraunces", "Lora", or "Playfair Display") for anything
that should feel written or storybook-like.

Use it for:

- App wordmark / title ("Future Life Simulator")
- Quiz question headlines ("Where do you picture yourself?")
- Scene headings and ending titles
- The postcard/stamp label text on endings
- Loading-screen narrative lines ("Checking rent near your campus...")

Guidance:

- Use generously — this is the emotional voice of the app, not a decorative accent.
- Keep weights limited to Regular and a Bold/SemiBold for emphasis.
- Avoid using it for dense body paragraphs longer than ~3 lines.

### 2. Reading Font

Use a clean, highly readable **sans or humanist serif** (e.g. "Inter", "Source Sans", "Charter") for
all standard interface text and the actual scene body copy the player reads most.

Use it for:

- Scene body text (the 130-220 word narrative paragraphs)
- Choice button labels
- Form field labels and inputs
- Helper/meta text, timestamps, small print
- All `/debug` page content (debug page can be plainer/denser than the main app)

Guidance:

- This carries the majority of on-screen reading — prioritize legibility over character.
- Use Regular for body, Medium/SemiBold for buttons and labels.

---

## Type Hierarchy

| Role | Font | Size |
|---|---|---|
| App wordmark | Journal Display | 28–36px |
| Quiz question headline | Journal Display | 28–40px |
| Scene / ending heading | Journal Display, SemiBold | 22–28px |
| Scene body text | Reading font, Regular | 16–18px, generous line-height (1.6+) |
| Choice button label | Reading font, Medium | 15–17px |
| Form label | Reading font, Medium | 13–14px |
| Helper / meta text | Reading font, Regular | 12–13px |
| Loading narrative line | Journal Display, Regular italic | 18–22px |

---

## Color Direction

Warm paper palette, low saturation, high readability. Ink tones instead of pure black/white.

- Background: warm cream / aged paper — `#FBF3E7`
- Primary text ("ink"): deep warm charcoal, not pure black — `#2E2620`
- Primary accent (CTAs, active states): warm gold/ochre — `#C98A3B`
- Secondary accent (links, quieter highlights): muted terracotta — `#B5654A`
- Paper card / polaroid surface: off-white — `#FFFBF3`
- Borders / dividers: soft warm grey — `#E4D8C4`

Tone colors (endings, stat gauges — used sparingly, as accents not backgrounds):

- Hopeful: warm gold — `#D9A441`
- Bittersweet: dusty rose/amber — `#C08561`
- Challenging: muted slate blue — `#5C6B7A`

Avoid:

- Bright saturated "app" colors (no neon, no pure blues/greens)
- Flat corporate blue/grey dashboard palettes
- Pure black text or pure white backgrounds — always keep the "paper" warmth
- Using tone colors as full-screen backgrounds — use them as accents (stamps, gauge fills, small badges)

---

## UI Style

The UI should combine:

- Soft paper textures / very subtle grain on backgrounds
- Torn-edge or deckle-edge card treatments where it reads as "paper," not just rounded rectangles
- Tilted Polaroid-style photo frames (with a "tape corner" detail) for scene images
- Wax-seal / postal-stamp iconography for endings
- Thin hairline dividers rather than heavy borders or shadows
- Generous whitespace — this app should never feel dense or dashboard-like

Good visual elements to include:

- Polaroid/tape photo frames
- Passport stamp motifs (for the loading screen and ending seals)
- Dotted "journey path" progress indicators (for the quiz steps)
- Hand-drawn-style small gauges/dials (for health/mood/money, tucked like margin notes)
- Postmark/postcard layout for the ending screen

Avoid:

- Card-heavy dashboard grids
- Numbered step badges that look like a technical pipeline (e.g. "1. Search Agent")
- Flat Material/Bootstrap-style default components

---

## Layout Principles

The app should be immersive and single-focus, similar to reading a book one page at a time.

Prioritize:

- **One question, one moment, one decision per screen** — no multi-field forms, no dashboards
- Full-screen, low-chrome layouts — no persistent sidebar in the user-facing flow
- Large, obvious primary action per screen
- Generous margins and paper-like breathing room
- Minimal cognitive load — never show pipeline/technical status to the end user

User-facing flow (in order):

1. **Passport cover / travel key entry** — one-time card, shown before the first quiz question
2. **One-question-at-a-time intake** — country → city → major → grade, each a full journal page
3. **Dreaming / loading screen** — passport stamping / page-turning animation with narrative lines
4. **Playthrough** — Polaroid scene image, scene text, margin-note stat gauges, full-width choice cards
5. **Ending** — postcard layout with tone-based wax-seal stamp

Developer-facing flow (fully separate, plainer style):

- `/debug` — Configuration (provider/model/key overrides) + Agent Outputs (Search/Design/Artist/Timeline
  per run), never linked to from the user-facing flow

---

## Key Components

### Passport / Travel Key Card
The one-time API key entry point. Styled like a passport cover page — a single centered card, deep
ink background, gold foil-style title text, one input field, one CTA ("Begin your journey"). Stored in
`localStorage` after first entry so returning users skip straight to the quiz.

### Journal Page (Quiz Step)
One question per screen: large serif headline, a handful of large tappable option cards (not a
`<select>` dropdown) or a styled text input, a dotted journey-path progress indicator at the top,
gentle slide/fade transition to the next page.

### Dreaming Loader
Full-screen, ambient. A passport being stamped or journal pages turning, with narrative lines that
change every few seconds, worded specifically to the user's input (e.g. "Checking rent near your
campus in Tokyo...", "Imagining your first week..."). These lines are cosmetic copy mapped to the real
backend pipeline stages (search/design/artist) — the mapping is internal only, never shown as
"Agent" labels to the user.

### Scene Card (Playthrough)
Tilted Polaroid-style photo frame (with a small tape-corner detail) for the scene image, sitting above
or beside the scene text. Health/Mood/Money shown as three small hand-drawn-style gauges tucked in a
corner like margin notes — quiet, not a HUD. Choices are full-width narrative cards, no numbering.

### Postcard Ending
The ending image fills a postcard-style card. A wax-seal/stamp icon in the tone color (hopeful =
gold, bittersweet = dusty rose, challenging = slate blue) sits over one corner like a postmark. A
short reflective line accompanies the tone. Actions: "Try a different path" / "Try a different city."

---

## Copywriting Tone

The product voice should be dreamy, warm, and reflective — like a travel journal entry, never like
product UI copy.

Tone keywords:

- Evocative
- Warm
- Reflective
- Personal
- Grounded (never purely promotional — include real friction, not just highlight reel)

Good examples:

- "What would your life actually look like in Tokyo?"
- "Checking rent near your campus..."
- "Your Tokyo story: bittersweet — you found your people, but the exhaustion never fully left."
- "Begin your journey."

Avoid:

- Pipeline/technical language in the user-facing flow ("Agent", "Config", "Run", "Pipeline stage")
- Generic SaaS/product copy ("Get started", "Dashboard", "Settings")
- Overhyped marketing tone that erases the "genuine challenge" requirement from the core design doc

---

## Accessibility

- Maintain strong text contrast even within the warm palette (ink `#2E2620` on cream `#FBF3E7` passes
  AA for body text).
- Do not rely on tone color alone to distinguish endings — always pair with a label/word (hopeful /
  bittersweet / challenging), not just a color.
- Keep touch targets (choice cards, quiz options) at least 44px tall.
- Keep loading-screen animations gentle and optional/reducible (respect `prefers-reduced-motion`).
- Ensure the Polaroid tilt/rotation doesn't reduce image legibility — cap rotation to a few degrees.

---

## Motion Guidance

Motion should feel like turning a page, not like a game or dashboard transition.

Use motion for:

- Journal page transitions between quiz questions (slide/fade)
- Passport stamp / page-turn animation on the loading screen
- Gentle reveal of the scene image and text on arrival at a new node
- Ending seal "stamping down" animation

Motion style:

- Slow, soft, unhurried — this is the opposite of snappy/bouncy game feedback
- Short enough not to slow down repeated use, but never abrupt
- Respect reduced-motion preferences (fade only, no animation, if requested)

---

## Overall Design Goal

The final app should feel like **a travel journal that writes itself** — a warm, personal, slightly
magical artifact that lets someone genuinely imagine a life they've never lived. It should be visually
memorable because of the paper/postcard/passport motifs, but every technical detail (agents, config,
model names, API keys) should live only in the developer-facing `/debug` route, never bleeding into
the story experience itself.
