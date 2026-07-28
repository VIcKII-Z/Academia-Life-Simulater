import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, RuntimeConfig, StoryDocument } from "../types.js";

interface StoryTopology {
  nodeIds: string[];
  endingIds: string[];
  edgeRules: string[];
  nextByNode: Record<string, string[]>;
}

/** Builds a cost-controlled braided graph: short A/B branches that merge back
 * into shared nodes. This gives the player real story divergence without
 * exploding into a full binary tree. */
function buildBraidedTopology(targetNodeCount: number): StoryTopology {
  const endingIds = ["ending_hopeful", "ending_challenging"];
  const targetStoryNodes = Math.max(4, targetNodeCount - endingIds.length);
  const nodeIds = ["opening"];
  const edgeRules: string[] = [];
  const nextByNode: Record<string, string[]> = {};
  let current = "opening";
  let nodeNumber = 2;

  while (nodeIds.length < targetStoryNodes) {
    const remaining = targetStoryNodes - nodeIds.length;
    if (remaining >= 3) {
      const branchA = `node${nodeNumber}a`;
      const branchB = `node${nodeNumber}b`;
      const merge = `node${nodeNumber + 1}`;
      nodeIds.push(branchA, branchB, merge);
      nextByNode[current] = [branchA, branchB];
      nextByNode[branchA] = [merge];
      nextByNode[branchB] = [merge];
      edgeRules.push(`- "${current}": its two choices MUST split, one to "${branchA}" and one to "${branchB}".`);
      edgeRules.push(`- "${branchA}" and "${branchB}": their choices MUST converge back to "${merge}" (both choices on each branch node point to "${merge}", with different stat_delta).`);
      current = merge;
      nodeNumber += 2;
      continue;
    }

    const next = `node${nodeNumber}`;
    nodeIds.push(next);
    nextByNode[current] = [next];
    edgeRules.push(`- "${current}": both choices point to "${next}" (stat-only choice pair; the story beat continues).`);
    current = next;
    nodeNumber += 1;
  }

  nextByNode[current] = endingIds;
  edgeRules.push(`- "${current}": its two choices MUST split to the endings, one to "ending_hopeful" and one to "ending_challenging".`);

  return { nodeIds, endingIds, edgeRules, nextByNode };
}

/** Minimum semesters is 1. Each additional semester adds a handful of beats,
 * capped so generation cost/time stays bounded while the flow still has room
 * to breathe. */
export function computeTargetNodeCount(semesters?: number): number {
  const s = Math.max(1, Math.round(semesters ?? 1));
  return Math.min(34, 13 + 6 * (s - 1));
}

function buildDesignSystemPrompt(targetNodeCount: number, semesters: number): string {
  const topology = buildBraidedTopology(targetNodeCount);
  const { nodeIds, endingIds, edgeRules } = topology;
  const nodeIdList = nodeIds.map((id) => `"${id}"`).join(", ");
  const endingIdList = endingIds.map((id) => `"${id}"`).join(", ");
  const topologyRuleText = edgeRules.join("\n");

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

[Graph Structure Rules]
- BRAIDED TWO-PATH STORY, NOT A FULL BINARY TREE: produce EXACTLY ${targetNodeCount} total
  nodes/endings, no more and no fewer: ${nodeIdList} under "nodes" (${nodeIds.length} non-ending
  nodes), and ${endingIdList} under "endings" (${endingIds.length} endings).
- Use this exact graph topology. Do not add, remove, rename, or reorder node ids:
${topologyRuleText}
- Some choice pairs are TRUE STORY choices: their two choices point to two different next_node
  values, creating A/B branch scenes that later merge. Other choice pairs are STAT-ONLY choices:
  both choices point to the same next_node and only change health/mood/money/school.
- Keep divergence compact. Branch nodes should feel meaningfully different for one scene, then
  naturally rejoin at the merge node. Do not create two completely separate storylines.

[Stat Balance Rules]
- Do not label one choice as the "correct" or recommended option. Let both options feel playable,
  with different tradeoffs and consequences.
- Choice text should be richer than a button label: write 12-22 words that include the concrete
  action and the implied tradeoff, e.g. "Skip the mixer and protect tomorrow's lab prep, even if
  the evening feels lonely." Avoid vague two-word options.
- Every non-ending choice MUST include:
  "stat_delta": { "health": number, "mood": number, "money": number, "school": number }
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
  not preachy. Produce EXACTLY the ${targetNodeCount} nodes/endings listed in the graph topology
  above (${nodeIdList}, ${endingIdList}) — no more, no fewer.
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
- Set has_image=true only for visual anchor scenes: opening, merge scenes, major location changes,
  high-emotion branch scenes, and endings. Similar adjacent branch nodes may share a visual, so
  not every node needs its own generated image. Aim for roughly 50-70% of nodes/endings to have
  has_image=true.
- For nodes/endings with has_image=true, write an image_prompt: 20-40 word English description of
  scene, atmosphere, character state, and visible environment (no detailed facial features, no
  text). For nodes that can reuse a nearby visual, set has_image=false and image_prompt=null.
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
- Every non-ending node must have EXACTLY 2 "choices", each with "text", a "next_node" that follows
  the exact graph topology above. Ending nodes must not have "choices".

[Output Format]
Output strictly this JSON, no extra text:
{
  "story_id": "string",
  "framework_type": "convergence" | "diverging" | "turning_point",
  "framework_reason": "one sentence",
  "user_profile": { "country": "string", "city": "string", "grade": "string", "major": "string" },
  "initial_stats": { "health": 70, "mood": 70, "money": 70, "school": 70 },
  "nodes": { "<node_id>": { "type": "string", "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "insight": "string", "choices": [{ "text": "string", "next_node": "string", "stat_delta": { "health": number, "mood": number, "money": number, "school": number }, "stat_reason": "string" }] } },
  "endings": { "<node_id>": { "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "insight": "string", "tone": "hopeful"|"bittersweet"|"challenging" } }
}`;
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Design Agent did not return valid JSON");
  return match[0];
}

const STAT_KEYS = ["health", "mood", "money", "school"] as const;

function sameSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((item) => actualSet.has(item));
}

function validateTopology(doc: StoryDocument, topology: StoryTopology): void {
  const actualNodeIds = Object.keys(doc.nodes);
  const actualEndingIds = Object.keys(doc.endings);
  if (!sameSet(actualNodeIds, topology.nodeIds)) {
    throw new Error(`Story node ids must be exactly: ${topology.nodeIds.join(", ")}`);
  }
  if (!sameSet(actualEndingIds, topology.endingIds)) {
    throw new Error(`Ending ids must be exactly: ${topology.endingIds.join(", ")}`);
  }

  for (const [nodeId, expectedNext] of Object.entries(topology.nextByNode)) {
    const node = doc.nodes[nodeId];
    if (!node) throw new Error(`Missing node "${nodeId}" required by topology`);
    if (!Array.isArray(node.choices) || node.choices.length !== 2) {
      throw new Error(`Node "${nodeId}" must have exactly 2 choices`);
    }
    const actualNext = node.choices.map((choice) => choice.next_node);
    if (expectedNext.length === 1 && actualNext.some((next) => next !== expectedNext[0])) {
      throw new Error(`Node "${nodeId}" choices must both point to "${expectedNext[0]}"`);
    }
    if (expectedNext.length > 1 && !sameSet(actualNext, expectedNext)) {
      throw new Error(`Node "${nodeId}" choices must split to exactly: ${expectedNext.join(", ")}`);
    }
  }
}

function validateStory(doc: StoryDocument, topology: StoryTopology): void {
  if (!doc.story_id || !doc.framework_type || !doc.nodes || !doc.endings) {
    throw new Error("Design Agent output missing required top-level fields");
  }
  validateTopology(doc, topology);
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
  }
  for (const ending of Object.values(doc.endings)) {
    if (typeof ending.insight === "string") ending.insight = ending.insight.trim() || undefined;
  }
}

function cloneStoryNode(node: StoryDocument["nodes"][string] | undefined, fallbackText: string): StoryDocument["nodes"][string] {
  return {
    type: node?.type || "challenge",
    scene_text: node?.scene_text || fallbackText,
    image_prompt: node?.image_prompt ?? null,
    has_image: Boolean(node?.has_image && node?.image_prompt),
    insight: node?.insight,
    choices: Array.isArray(node?.choices) ? node.choices.map((choice) => ({ ...choice })) : [],
  };
}

function cloneEndingNode(
  node: StoryDocument["endings"][string] | StoryDocument["nodes"][string] | undefined,
  tone: "hopeful" | "challenging",
): StoryDocument["endings"][string] {
  return {
    scene_text:
      node?.scene_text ||
      (tone === "hopeful"
        ? "The semester closes with a steadier rhythm: the city feels less distant, campus feels more familiar, and the choices you made become a small map for what comes next."
        : "The semester closes with hard lessons: the city is still demanding, but the experience leaves you clearer about your limits, needs, and next choices."),
    image_prompt: node?.image_prompt ?? null,
    has_image: Boolean(node?.has_image && node?.image_prompt),
    insight: node?.insight,
    tone,
  };
}

function defaultChoice(text: string, nextNode: string): StoryDocument["nodes"][string]["choices"][number] {
  return {
    text,
    next_node: nextNode,
    stat_delta: { health: 0, mood: 0, money: 0, school: 0 },
    stat_reason: "This choice changes the route without enough model-provided stat detail.",
  };
}

/**
 * The model writes the actual scenes, but exact graph IDs are a mechanical
 * requirement. Coerce whatever valid-ish story it produced into the braided
 * topology so a good story does not fail just because a long exact ID list was
 * hard for the model to follow.
 */
function coerceToBraidedTopology(doc: StoryDocument, topology: StoryTopology): void {
  const sourceNodes = Object.values(doc.nodes ?? {});
  const sourceEndings = Object.values(doc.endings ?? {});
  const fallbackNode = sourceNodes[sourceNodes.length - 1];
  const nextNodes: StoryDocument["nodes"] = {};

  for (const [index, nodeId] of topology.nodeIds.entries()) {
    const node = cloneStoryNode(sourceNodes[index] ?? fallbackNode, `A study-abroad scene continues at ${nodeId}.`);
    const expectedNext = topology.nextByNode[nodeId] ?? topology.endingIds;
    const existingChoices = node.choices.length > 0 ? node.choices : [
      defaultChoice("Take the steadier option.", expectedNext[0]),
      defaultChoice("Take the riskier option.", expectedNext[expectedNext.length - 1] ?? expectedNext[0]),
    ];
    node.choices = [existingChoices[0], existingChoices[1] ?? existingChoices[0]].map((choice, choiceIndex) => ({
      ...choice,
      next_node: expectedNext.length === 1 ? expectedNext[0] : expectedNext[choiceIndex],
      stat_delta: choice.stat_delta ?? { health: 0, mood: 0, money: 0, school: 0 },
      stat_reason: choice.stat_reason || "No stat rationale provided.",
    }));
    nextNodes[nodeId] = node;
  }

  const hopefulSource = sourceEndings.find((ending) => ending.tone === "hopeful") ?? sourceEndings[0] ?? sourceNodes[sourceNodes.length - 1];
  const challengingSource =
    sourceEndings.find((ending) => ending.tone === "challenging") ??
    sourceEndings.find((ending) => ending.tone === "bittersweet") ??
    sourceEndings[1] ??
    sourceNodes[sourceNodes.length - 1];

  doc.nodes = nextNodes;
  doc.endings = {
    ending_hopeful: cloneEndingNode(hopefulSource, "hopeful"),
    ending_challenging: cloneEndingNode(challengingSource, "challenging"),
  };
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
 * Keeps the visual plan cost-controlled. The model may over-eagerly mark every
 * chapter for image generation; trim that back to visual anchors and ensure at
 * least a few anchors exist for reuse.
 */
function ensureImageReusePlan(doc: StoryDocument, maxImagesPerStory: number): void {
  const entries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ] as [string, StoryDocument["nodes"][string] | StoryDocument["endings"][string]][];

  if (entries.length === 0 || maxImagesPerStory <= 0) return;

  const desiredImageCount = Math.min(entries.length, maxImagesPerStory, Math.max(1, Math.ceil(entries.length * 0.65)));
  let anchors = entries.filter(([, node]) => node.has_image && node.image_prompt);
  if (anchors.length > desiredImageCount) {
    const keepIds = new Set<string>();
    const step = (anchors.length - 1) / Math.max(1, desiredImageCount - 1);
    for (let i = 0; i < desiredImageCount; i++) keepIds.add(anchors[Math.round(i * step)][0]);
    for (const [id, node] of anchors) {
      if (keepIds.has(id)) continue;
      node.has_image = false;
      node.image_prompt = null;
    }
    anchors = entries.filter(([, node]) => node.has_image && node.image_prompt);
  }

  const minimumAnchorCount = Math.min(desiredImageCount, Math.max(1, Math.ceil(entries.length / 3)));
  if (anchors.length >= minimumAnchorCount) return;

  const anchorIds = new Set(anchors.map(([id]) => id));
  const step = (entries.length - 1) / Math.max(1, minimumAnchorCount - 1);
  for (let i = 0; i < minimumAnchorCount; i++) {
    const [id, node] = entries[Math.round(i * step)];
    if (anchorIds.has(id)) continue;
    if (node.has_image && node.image_prompt) continue;

    node.has_image = true;
    node.image_prompt = node.image_prompt || buildFallbackImagePrompt(doc, id, node);
    anchorIds.add(id);
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
  const topology = buildBraidedTopology(targetNodeCount);

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
        coerceToBraidedTopology(doc, topology);
        normalizeStats(doc);
        repairChoicelessNodes(doc);
        repairDanglingLinks(doc);
        ensureImageReusePlan(doc, runtimeConfig?.features.maxImagesPerStory ?? config.features.maxImagesPerStory);
        linkSourcedMentions(doc, report);
        validateStory(doc, topology);
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
