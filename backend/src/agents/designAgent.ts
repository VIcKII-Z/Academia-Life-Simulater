import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, RuntimeConfig, StoryDocument } from "../types.js";

/** Builds the ordered node-id chain for a target total node/ending count:
 * "opening", "node2", ..., "node{N-1}", then a single "ending". Mirrors the
 * original fixed 10-node chain (opening, node2..node9, ending) but scales
 * with story length so a longer stay (more semesters) produces a longer
 * chain instead of always exactly 10. */
function buildNodeChain(targetNodeCount: number): { nodeIds: string[]; endingId: string } {
  const nodeIds = ["opening"];
  for (let i = 2; i <= targetNodeCount - 1; i++) nodeIds.push(`node${i}`);
  return { nodeIds, endingId: "ending" };
}

/** Minimum semesters is 1 (the original fixed-length story); each additional
 * semester adds ~5 more nodes, capped so generation cost/time stays bounded. */
export function computeTargetNodeCount(semesters?: number): number {
  const s = Math.max(1, Math.round(semesters ?? 1));
  return Math.min(30, 10 + 5 * (s - 1));
}

function buildDesignSystemPrompt(targetNodeCount: number, semesters: number): string {
  const { nodeIds, endingId } = buildNodeChain(targetNodeCount);
  const chainDescription = `${nodeIds.join('" -> "')}" -> "${endingId}`;
  const nodeIdList = nodeIds.map((id) => `"${id}"`).join(", ");

  return `You are a story design AI responsible for transforming a
study-abroad research report into the skeleton of an interactive survival text-adventure game.
The player's stay covers ${semesters} semester${semesters === 1 ? "" : "s"} — pace the story and its
ending to actually reflect that timeline (a 1-semester story should feel like a single fast
orientation arc; a multi-semester story should show real progression across time — course cycles,
changing seasons, deepening relationships/responsibilities, a visibly different person by the
end — and its ending should reflect a multi-semester arc, not just a longer version of the
1-semester ending).

[Core Game System]
The player has four visible stats:
- health: physical wellbeing, sleep, safety, food, fatigue, climate stress.
- mood: loneliness, motivation, belonging, culture shock, academic confidence.
- money: rent, food, transport, tuition pressure, part-time work, internships.
- school: academic standing/coursework progress — drops when the player skips classes, ignores
  professor/advisor messages, or blows off deadlines and assignments in favor of leisure/social
  time; rises when they prioritize coursework, office hours, or study time.

Initial stats should usually be { "health": 70, "mood": 70, "money": 70, "school": 70 }.
The frontend ends the game immediately if any stat reaches 0 or below. Therefore, choices must
create meaningful pressure without being random punishment.

[Stat Balance Rules]
- LINEAR STORYLINE, NO BRANCHING TREE: produce EXACTLY ${targetNodeCount} total nodes/endings
  forming a SINGLE linear chain with EXACTLY these node ids, in this exact order and count, no
  more and no fewer: ${nodeIdList} under "nodes" (${nodeIds.length} nodes), and exactly one
  "${endingId}" under "endings" (1 ending) — ${targetNodeCount} total. "${chainDescription}".
  Every non-ending node has EXACTLY 2 choices (still meaningful, still carrying stat_delta), but
  BOTH choices on a given node MUST point to the SAME "next_node" — the one next node in the
  sequence above. This keeps player agency over consequences (different choices, different
  stat_delta) without ever branching the visited-node path itself — only one linear content path
  is generated per node, which keeps generation cost down. Do not add, remove, rename, or
  reorder any node id, and do not create alternate paths or additional endings.
- Of the 2 choices on each non-ending node, mark exactly ONE with "recommended": true — the
  choice you consider the more sensible/better path for this specific profile (e.g. the one a
  thoughtful player balancing all four stats would pick). Mark the other "recommended": false.
  This is shown to the player as a hint (a star badge), not a hard branch.
- Every non-ending choice MUST include:
  "stat_delta": { "health": number, "mood": number, "money": number, "school": number }
  "stat_reason": "short explanation grounded in the report"
  "recommended": boolean
- Typical choice deltas should be between -20 and +12 per stat.
- High-risk choices may include one -25 to -30 penalty, but compensate with a clear benefit in another stat.
- At least 60% of choices should involve tradeoffs, not simply all-positive or all-negative outcomes.
- Across the likely playthrough, cumulative pressure should be able to push one stat near 0 if the player repeatedly ignores that category.
- Ground stat effects in city + major + grade specifics from report.gameplay_signals whenever available.
- If report.program_profile, report.student_life_profile, or report.career_profile are present,
  they describe a SPECIFIC school/program (curriculum, milestones, funding, housing, career/visa
  details) — use them for concrete, program-real nodes (advisor/lab/course names, specific
  deadlines, funding structure) instead of generic city+major content. If report.gaps notes that
  program-specific information was unavailable, keep the story at the city+major+grade level
  instead of inventing school-specific details.
- If report.campus_life_profile is present, weave its REAL, NAMED specifics directly into scene
  text and choices so the story feels like this exact school instead of "a university abroad":
  * notable_courses -> reference a specific course by name/code when depicting a class, lab, or
    exam scene (e.g. "your 6.867 Machine Learning problem set is due at midnight").
  * notable_faculty -> name-drop a real advisor/professor when depicting office hours, research
    meetings, or a recommendation-letter request.
  * libraries -> use the actual named library as a study/refuge/all-nighter location instead of
    "the library".
  * clubs -> have the player consider joining (or attend a meeting of) a specific real club as a
    mood/community choice.
  * events -> use a specific real recurring event (career fair, hackathon, festival, guest
    lecture) as a plot beat or choice trigger.
  Only use entries that are actually present in campus_life_profile — never invent a name, course
  code, or club/event that isn't listed there. If campus_life_profile is absent or a given
  sub-list is missing, keep that part of the story at a generic/unnamed level instead of making
  something up.
- Whenever a campus_life_profile entry you reference has a "url" field, cite the REAL source
  instead of just naming it: wrap that mention as a markdown link inside the bold marker, e.g.
  "**[CS 170: Efficient Algorithms and Intractable Problems](https://www2.eecs.berkeley.edu/Courses/CS170/)**"
  or "**[Doe Memorial Library](https://www.lib.berkeley.edu/doe-library)**" — the bracketed label
  is the phrase the player sees highlighted, the parenthesized part is the exact "url" value from
  that entry, copied verbatim. NEVER invent, guess, or construct a URL yourself — only use a URL
  that is literally present in the report's campus_life_profile/sources data for that exact item.
  If an entry has no "url", reference it as plain bold text (no link) as before. Prefer including
  a few of these real linked mentions per node when the data supports it (courses, faculty pages,
  libraries, clubs, events) — more grounded links make the story feel demonstrably research-based
  rather than merely plausible, so don't limit yourself to just one per story.
- The story must make the selected profile feel different. A PhD story should include advisor,
  research, funding, lab/community, publication or thesis pressure. An undergraduate story should
  include dorm/campus/social adaptation, coursework, clubs, internships, and family budget pressure.
  A CS story should differ from Business, Design, or Finance through projects, labs, interviews,
  networking norms, tools, and local industry conditions.
- Examples:
  * Taking an unpaid networking event may cost money but raise mood/career confidence.
  * Working too many shifts may raise money but reduce health and mood.
  * Joining a student community may raise mood but cost time or money.
  * Ignoring sleep during a CS lab deadline may protect academics short-term but damage health.
  * If report.career_profile.notable_employers/recruiting_events/alumni_outcomes are present, use
    a real named employer or recruiting event for a career-track choice or ending (e.g. an
    interview loop with a named company after attending a named career fair), instead of a vague
    "you get a job" outcome.

[Step 1: Select a Narrative Framework]
Choose the most suitable of the following three, and state your reasoning:
- "convergence": suitable when the report shows an almost unavoidable shared challenge
  (e.g., extremely high cost of living, broadly difficult language environment).
- "diverging": suitable when the report shows multiple equally viable but distinctly
  different lifestyle paths (e.g., integrating locally vs. staying within a diaspora community).
- "turning_point": suitable when the report shows one specific, sharp high-risk factor
  (e.g., strict visa policy, high-pressure culture, notable safety concerns).

[Step 2: Generate Node Content]
- All stories begin with an "opening" node representing arrival.
- Each node's scene_text should be 130-220 words: scene description plus emotional tone,
  not preachy. Produce EXACTLY the ${targetNodeCount} nodes/endings listed in the LINEAR
  STORYLINE rule above (${nodeIdList}, ${endingId}) — no more, no fewer.
- Within scene_text, wrap 2-4 short, genuinely important phrases in **double asterisks**
  (markdown-bold) so the player can skim the long paragraph — e.g. concrete numbers/costs,
  the key decision or risk of the scene, a pivotal place/deadline. Do not over-mark; only the
  handful of phrases that matter most. Apply the same sparing **bold** marking inside "insight".
  A bold phrase written as a real linked citation (see the campus_life_profile "url" rule above)
  counts toward this same 2-4 budget, but if a node naturally has 2-3 real, sourced links worth
  citing (a course + a library + a club, say), it's fine to go up to 5-6 bold phrases that node —
  err toward citing more real sources rather than fewer, since that's what makes the story feel
  demonstrably research-grounded instead of just plausible.
- Each node should include concrete local details: neighborhood/campus/lab/commute/weather/social
  setting, and at least one detail connected to the user's major or grade.
- Must include multiple genuine "challenge" type nodes - the story cannot be entirely positive.
- Challenge nodes should correspond to health/mood/money/school stressors from the research report.
- Do NOT make the story mostly academic. Across the generated nodes, at least half of the
  non-ending scenes must be primarily about life outside coursework/research: housing/rent,
  groceries and budgeting, commute or weather fatigue, loneliness/culture shock, health/sleep,
  visa/admin errands, part-time work, social belonging, safety, or local community routines.
- Academic/coursework/research scenes may be important, but they must not exceed half of the
  non-ending scenes. Interleave them with concrete daily-life challenges so the player feels
  they are living abroad, not only studying.
- In choice design, make at least one choice pair per 3 nodes primarily affect health/mood/money
  rather than school, and ground those tradeoffs in report.student_life_profile, cost_of_living,
  climate, housing, community, visa, and part_time_work when available.
- Ending nodes must have a "tone" field: one of "hopeful", "bittersweet", "challenging".
- Set has_image=true for EVERY node and the ending, so all ${targetNodeCount} chapters have
  a matching illustration.
- For every node and ending, write an image_prompt: 20-40 word English description of scene,
  atmosphere, character state, and visible environment (no detailed facial features, no text).
- EVERY node AND every ending MUST include an "insight" field: a 1-2 sentence English
  educational "field note" (about 20-45 words) explaining WHY this situation or challenge
  realistically happens to study-abroad students with THIS specific country/city/major/grade,
  grounded in the research report (report.visa, report.career, report.cost_of_living,
  report.culture_shock, gameplay_signals, career_profile, etc.). It is shown to the player in a
  side panel while they read the scene, so they learn about real study-abroad life. Write it in a
  factual, encyclopedic "Did you know" tone — NOT part of the story narration, NOT second-person
  ("you"), and do NOT start it with the word "Note:". Example for a job-hunt scene in Sweden:
  "International graduates in Sweden often face a competitive job hunt: top studios such as King and
  DICE recruit selectively, and non-EU students must also secure post-study work authorization,
  which makes late-programme networking events especially decisive." Ground every insight in the
  report — do not invent statistics, named companies, or policies that aren't supported by it.
- Every non-ending node must have EXACTLY 2 "choices", each with "text", a "next_node" that is
  THE SAME single next node in the chain for both choices on that node (see LINEAR STORYLINE rule
  above) — never a different node per choice — and a "recommended" boolean (exactly one of the
  2 choices true, the other false). Ending nodes must not have "choices".

[Output Format]
Output strictly this JSON, no extra text:
{
  "story_id": "string",
  "framework_type": "convergence" | "diverging" | "turning_point",
  "framework_reason": "one sentence",
  "user_profile": { "country": "string", "city": "string", "grade": "string", "major": "string" },
  "initial_stats": { "health": 70, "mood": 70, "money": 70, "school": 70 },
  "nodes": { "<node_id>": { "type": "string", "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "insight": "string", "choices": [{ "text": "string", "next_node": "string", "stat_delta": { "health": number, "mood": number, "money": number, "school": number }, "stat_reason": "string", "recommended": boolean }] } },
  "endings": { "<node_id>": { "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "insight": "string", "tone": "hopeful"|"bittersweet"|"challenging" } }
}`;
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Design Agent did not return valid JSON");
  return match[0];
}

const STAT_KEYS = ["health", "mood", "money", "school"] as const;
function validateStory(doc: StoryDocument): void {
  if (!doc.story_id || !doc.framework_type || !doc.nodes || !doc.endings) {
    throw new Error("Design Agent output missing required top-level fields");
  }
  if (!doc.initial_stats) {
    throw new Error("Design Agent output missing initial_stats");
  }
  for (const stat of STAT_KEYS) {
    if (typeof doc.initial_stats[stat] !== "number") {
      throw new Error(`initial_stats.${stat} must be a number`);
    }
  }
  if (Object.keys(doc.endings).length === 0) {
    throw new Error("Design Agent output has no endings");
  }
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!Array.isArray(node.choices) || node.choices.length === 0) {
      throw new Error(`Node "${id}" must have at least one choice`);
    }
    for (const [index, choice] of node.choices.entries()) {
      if (!choice.stat_delta) {
        throw new Error(`Choice ${index + 1} in node "${id}" is missing stat_delta`);
      }
      for (const stat of STAT_KEYS) {
        if (typeof choice.stat_delta[stat] !== "number") {
          throw new Error(`Choice ${index + 1} in node "${id}" has invalid stat_delta.${stat}`);
        }
      }
      if (!choice.stat_reason) {
        throw new Error(`Choice ${index + 1} in node "${id}" is missing stat_reason`);
      }
    }
  }
  for (const [id, ending] of Object.entries(doc.endings)) {
    if (!["hopeful", "bittersweet", "challenging"].includes(ending.tone)) {
      throw new Error(`Ending "${id}" has invalid tone "${ending.tone}"`);
    }
  }
}

function normalizeStats(doc: StoryDocument): void {
  doc.initial_stats ??= { health: 70, mood: 70, money: 70, school: 70 };
  doc.nodes ??= {};
  doc.endings ??= {};
  for (const node of Object.values(doc.nodes)) {
    // insight is optional — trim if present, leave undefined otherwise so the
    // frontend simply falls back to the persistent story context in the panel.
    if (typeof node.insight === "string") node.insight = node.insight.trim() || undefined;
    for (const choice of node.choices ?? []) {
      choice.stat_delta ??= { health: 0, mood: 0, money: 0, school: 0 };
      choice.stat_delta.school ??= 0;
      choice.stat_reason ??= "No stat rationale provided.";
    }
    // Guarantee exactly one "recommended" choice per node even if the model
    // forgets the field or marks zero/multiple — the UI always needs exactly
    // one starred option to point the (demo) player toward.
    const choices = node.choices ?? [];
    const recommendedCount = choices.filter((choice) => choice.recommended).length;
    if (recommendedCount !== 1) {
      choices.forEach((choice, index) => {
        choice.recommended = index === 0;
      });
    }
  }
  for (const ending of Object.values(doc.endings)) {
    if (typeof ending.insight === "string") ending.insight = ending.insight.trim() || undefined;
  }
}

function stripSceneText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/[`*_#>\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const trimmed = text.slice(0, maxLength);
  const lastSpace = trimmed.lastIndexOf(" ");
  return `${trimmed.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function buildFallbackImagePrompt(
  doc: StoryDocument,
  nodeId: string,
  node: StoryDocument["nodes"][string] | StoryDocument["endings"][string],
): string {
  const profile = doc.user_profile;
  const location = [profile.school, profile.city, profile.country].filter(Boolean).join(", ");
  const role = [profile.grade, profile.major].filter(Boolean).join(" ");
  const kind = "type" in node ? node.type : "ending";
  const cleanScene = stripSceneText(node.scene_text);
  const sceneExcerpt = truncateAtWordBoundary(cleanScene, 170);

  return [
    `Study-abroad ${role || "student"} in ${location || "an international university setting"}`,
    `${kind} scene from ${nodeId}`,
    sceneExcerpt,
    "clear environment, emotional body language, no readable text",
  ].join(", ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkedMarkdownLabel(label: string, url: string): string {
  return `**[${label}](${url})**`;
}

function linkPlainMention(text: string | undefined, label: string, url: string): string | undefined {
  if (!text || !label.trim() || !url.trim() || text.includes(`](${url})`)) return text;

  const escapedLabel = escapeRegExp(label.trim());
  const boldPattern = new RegExp(`\\*\\*(${escapedLabel})\\*\\*`, "i");
  if (boldPattern.test(text)) {
    return text.replace(boldPattern, (_match, visibleLabel: string) => linkedMarkdownLabel(visibleLabel, url));
  }

  const plainPattern = new RegExp(`\\b(${escapedLabel})\\b`, "i");
  return text.replace(plainPattern, (_match, visibleLabel: string) => linkedMarkdownLabel(visibleLabel, url));
}

function sourcedMentionLinks(report: ResearchReport): { label: string; url: string }[] {
  const campus = report.campus_life_profile;
  const links: { label: string; url: string }[] = [];
  const add = (label: string | undefined, url: string | undefined): void => {
    if (!label || !url || links.some((entry) => entry.label === label && entry.url === url)) return;
    links.push({ label, url });
  };

  for (const course of campus?.notable_courses ?? []) {
    add(course.title, course.url);
    if (course.code && course.title) add(`${course.code}: ${course.title}`, course.url);
  }
  for (const faculty of campus?.notable_faculty ?? []) add(faculty.name, faculty.url);
  for (const library of campus?.libraries ?? []) add(library.name, library.url);
  for (const club of campus?.clubs ?? []) add(club.name, club.url);
  for (const event of campus?.events ?? []) add(event.name, event.url);

  return links.sort((a, b) => b.label.length - a.label.length);
}

function linkSourcedMentions(doc: StoryDocument, report: ResearchReport): void {
  const links = sourcedMentionLinks(report);
  if (links.length === 0) return;

  const applyLinks = (text: string | undefined): string | undefined =>
    links.reduce((current, link) => linkPlainMention(current, link.label, link.url), text);

  for (const node of Object.values(doc.nodes)) {
    node.scene_text = applyLinks(node.scene_text) ?? node.scene_text;
    node.insight = applyLinks(node.insight);
    for (const choice of node.choices ?? []) {
      choice.text = applyLinks(choice.text) ?? choice.text;
      choice.stat_reason = applyLinks(choice.stat_reason);
    }
  }
  for (const ending of Object.values(doc.endings)) {
    ending.scene_text = applyLinks(ending.scene_text) ?? ending.scene_text;
    ending.insight = applyLinks(ending.insight);
  }
}

/**
 * Every story chapter should be illustrated. Smaller/cheaper models sometimes
 * forget image prompts on intermediate nodes, so repair the visual plan
 * deterministically before Artist Agent runs.
 */
function ensureImageCoverage(doc: StoryDocument, maxImagesPerStory: number): void {
  const entries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ] as [string, StoryDocument["nodes"][string] | StoryDocument["endings"][string]][];

  if (entries.length === 0 || maxImagesPerStory <= 0) return;

  const desiredImageCount = Math.min(entries.length, maxImagesPerStory);
  const existingImageCount = entries.filter(([, node]) => node.has_image && node.image_prompt).length;
  if (existingImageCount >= desiredImageCount) return;

  let imageCount = existingImageCount;
  for (const [id, node] of entries) {
    if (imageCount >= desiredImageCount) break;
    if (node.has_image && node.image_prompt) continue;

    node.has_image = true;
    node.image_prompt = node.image_prompt || buildFallbackImagePrompt(doc, id, node);
    imageCount++;
  }
}

/**
 * Repairs nodes with no choices in-place: the Design Agent occasionally emits
 * a node under "nodes" that has zero choices (effectively an ending it forgot
 * to move to "endings"). Rather than hard-failing, promote it to an ending
 * with a best-guess tone so the story stays playable.
 */
function repairChoicelessNodes(doc: StoryDocument): void {
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!Array.isArray(node.choices) || node.choices.length === 0) {
      console.warn(`[designAgent] repairing choiceless node: "${id}" promoted from "nodes" to "endings"`);
      const { choices: _choices, type: _type, ...rest } = node as typeof node & { type?: string };
      doc.endings[id] = { ...rest, tone: "bittersweet" };
      delete doc.nodes[id];
    }
  }
}

/**
 * Repairs dangling next_node references in-place: if a choice points to a node
 * id that doesn't exist in nodes/endings, reroute it to a valid existing ending.
 * This trades a small amount of narrative precision for guaranteed playability —
 * important for demo reliability, since LLMs occasionally reference a node id
 * they forgot to define even with correct instructions.
 */
function repairDanglingLinks(doc: StoryDocument): void {
  const allNodeIds = new Set([...Object.keys(doc.nodes), ...Object.keys(doc.endings)]);
  const endingIds = Object.keys(doc.endings);
  if (endingIds.length === 0) return; // nothing to reroute to; validateStory will catch this

  for (const [id, node] of Object.entries(doc.nodes)) {
    for (const choice of node.choices ?? []) {
      if (!allNodeIds.has(choice.next_node)) {
        const fallback = endingIds[Math.floor(Math.random() * endingIds.length)];
        console.warn(
          `[designAgent] repairing dangling link: node "${id}" -> "${choice.next_node}" (missing) rerouted to ending "${fallback}"`,
        );
        choice.next_node = fallback;
      }
    }
  }
}

/**
 * Runs the Design Agent, validates output, and self-corrects on failure by
 * feeding the validation error back to the model (up to MAX_ATTEMPTS total).
 */
const MAX_ATTEMPTS = 4;

export async function runDesignAgent(
  report: ResearchReport,
  storyId: string,
  runtimeConfig?: RuntimeConfig,
  semesters?: number,
): Promise<StoryDocument> {
  const client = getOpenAIClient(runtimeConfig);
  const userInput = `Story ID to use: "${storyId}"\n\nResearch report:\n${JSON.stringify(report, null, 2)}`;
  const resolvedSemesters = Math.max(1, Math.round(semesters ?? 1));
  const targetNodeCount = computeTargetNodeCount(resolvedSemesters);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildDesignSystemPrompt(targetNodeCount, resolvedSemesters) },
    { role: "user", content: userInput },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: runtimeConfig?.models.design ?? config.models.design,
        messages,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      let doc: StoryDocument;
      try {
        doc = JSON.parse(extractJson(raw)) as StoryDocument;
        // Deterministically overwrite user_profile with the actual input
        // profile instead of trusting the LLM's echo: the Design Agent's
        // JSON schema (see buildDesignSystemPrompt below) only asks for
        // country/city/grade/major, so school/department/program the
        // player actually typed (e.g. "UC Berkeley") were silently dropped
        // and AdmissionLetter fell back to a generic "a university in
        // {city}" even when a specific school was given.
        doc.user_profile = {
          country: report.profile?.country ?? report.location.country,
          city: report.profile?.city ?? report.location.city,
          major: report.profile?.major ?? report.major,
          grade: report.profile?.grade ?? report.grade,
          school: report.profile?.school,
          department: report.profile?.department,
          program: report.profile?.program,
          semesters: resolvedSemesters,
        };
        normalizeStats(doc);
        repairChoicelessNodes(doc);
        repairDanglingLinks(doc);
        ensureImageCoverage(doc, runtimeConfig?.features.maxImagesPerStory ?? config.features.maxImagesPerStory);
        linkSourcedMentions(doc, report);
        validateStory(doc);
      } catch (validationErr) {
        const errorMessage = validationErr instanceof Error ? validationErr.message : String(validationErr);
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `Your previous output was invalid: ${errorMessage}\n\nFix the issue and output the corrected, complete, valid JSON again (full structure, not a diff).`,
        });
        throw validationErr;
      }
      return doc;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Design Agent failed after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`);
}
