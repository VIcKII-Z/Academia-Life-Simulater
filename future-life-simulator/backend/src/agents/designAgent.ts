import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, RuntimeConfig, StoryDocument } from "../types.js";

const DESIGN_SYSTEM_PROMPT = `You are a story design AI responsible for transforming a
study-abroad research report into the skeleton of an interactive survival text-adventure game.

[Core Game System]
The player has three visible stats:
- health: physical wellbeing, sleep, safety, food, fatigue, climate stress.
- mood: loneliness, motivation, belonging, culture shock, academic confidence.
- money: rent, food, transport, tuition pressure, part-time work, internships.

Initial stats should usually be { "health": 70, "mood": 70, "money": 70 }.
The frontend ends the game immediately if any stat reaches 0 or below. Therefore, choices must
create meaningful pressure without being random punishment.

[Stat Balance Rules]
- TEMP MODE — LINEAR STORYLINE, NO BRANCHING TREE: produce EXACTLY ${config.story.minNodes} total
  nodes/endings forming a SINGLE linear chain with EXACTLY these node ids, in this exact order and
  count, no more and no fewer: "opening", "node2", "node3", "node4", "node5", "node6", "node7",
  "node8", "node9" under "nodes" (9 nodes), and exactly one "ending" under "endings" (1 ending) —
  ${config.story.minNodes} total. "opening" -> "node2" -> "node3" -> ... -> "node9" -> "ending".
  Every non-ending node has 1-2 choices as usual (still meaningful, still carrying stat_delta), but
  ALL choices on a given node MUST point to the SAME "next_node" — the one next node in the
  sequence above. This keeps player agency over consequences (different choices, different
  stat_delta) without ever branching the visited-node path itself. Do not add, remove, rename, or
  reorder any node id, and do not create alternate paths or additional endings.
- Every non-ending choice MUST include:
  "stat_delta": { "health": number, "mood": number, "money": number }
  "stat_reason": "short explanation grounded in the report"
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
  not preachy. Produce EXACTLY the ${config.story.minNodes} nodes/endings listed in the LINEAR
  STORYLINE rule above (opening, node2..node9, ending) — no more, no fewer.
- Each node should include concrete local details: neighborhood/campus/lab/commute/weather/social
  setting, and at least one detail connected to the user's major or grade.
- Must include multiple genuine "challenge" type nodes - the story cannot be entirely positive.
- Challenge nodes should correspond to health/mood/money stressors from the research report.
- Ending nodes must have a "tone" field: one of "hopeful", "bittersweet", "challenging".
- Set has_image=true on most visually meaningful moments: opening, city arrival, housing/commute,
  academic/work scene, social/community scene, major challenge, and the ending.
  Aim for 6-8 image nodes total across nodes+endings (out of exactly ${config.story.minNodes} total).
- If has_image is true, write an image_prompt: 20-40 word English description of scene,
  atmosphere, and character state (no detailed facial features). If has_image is false,
  image_prompt must be null.
- Every non-ending node must have 1-2 "choices", each with "text" and a "next_node" that is THE
  SAME single next node in the chain for every choice on that node (see LINEAR STORYLINE rule
  above) — never a different node per choice. Ending nodes must not have "choices".

[Output Format]
Output strictly this JSON, no extra text:
{
  "story_id": "string",
  "framework_type": "convergence" | "diverging" | "turning_point",
  "framework_reason": "one sentence",
  "user_profile": { "country": "string", "city": "string", "grade": "string", "major": "string" },
  "initial_stats": { "health": 70, "mood": 70, "money": 70 },
  "nodes": { "<node_id>": { "type": "string", "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "choices": [{ "text": "string", "next_node": "string", "stat_delta": { "health": number, "mood": number, "money": number }, "stat_reason": "string" }] } },
  "endings": { "<node_id>": { "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "tone": "hopeful"|"bittersweet"|"challenging" } }
}`;

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Design Agent did not return valid JSON");
  return match[0];
}

function validateStory(doc: StoryDocument): void {
  if (!doc.story_id || !doc.framework_type || !doc.nodes || !doc.endings) {
    throw new Error("Design Agent output missing required top-level fields");
  }
  if (!doc.initial_stats) {
    throw new Error("Design Agent output missing initial_stats");
  }
  for (const stat of ["health", "mood", "money"] as const) {
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
      for (const stat of ["health", "mood", "money"] as const) {
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
  doc.initial_stats ??= { health: 70, mood: 70, money: 70 };
  doc.nodes ??= {};
  doc.endings ??= {};
  for (const node of Object.values(doc.nodes)) {
    for (const choice of node.choices ?? []) {
      choice.stat_delta ??= { health: 0, mood: 0, money: 0 };
      choice.stat_reason ??= "No stat rationale provided.";
    }
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
): Promise<StoryDocument> {
  const client = getOpenAIClient(runtimeConfig);
  const userInput = `Story ID to use: "${storyId}"\n\nResearch report:\n${JSON.stringify(report, null, 2)}`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: DESIGN_SYSTEM_PROMPT },
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
        normalizeStats(doc);
        repairChoicelessNodes(doc);
        repairDanglingLinks(doc);
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
