import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, StoryDocument } from "../types.js";

const DESIGN_SYSTEM_PROMPT = `You are a story design AI responsible for transforming a
study-abroad research report into the skeleton of an interactive text-adventure game.

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
- Each node's scene_text should be 80-150 words: scene description plus emotional tone,
  not preachy. Produce ${config.story.minNodes}-${config.story.maxNodes} total nodes/endings.
- Must include at least one genuine "challenge" type node - the story cannot be entirely positive.
- Ending nodes must have a "tone" field: one of "hopeful", "bittersweet", "challenging".
- Set has_image=true only on moments worth seeing (opening, key emotional turns, endings);
  aim for roughly 3-4 image nodes total across nodes+endings, no more.
- If has_image is true, write an image_prompt: 20-40 word English description of scene,
  atmosphere, and character state (no detailed facial features). If has_image is false,
  image_prompt must be null.
- Every non-ending node must have 1-2 "choices", each with "text" and "next_node" pointing
  to a key that exists in "nodes" or "endings". Ending nodes must not have "choices".

[Output Format]
Output strictly this JSON, no extra text:
{
  "story_id": "string",
  "framework_type": "convergence" | "diverging" | "turning_point",
  "framework_reason": "one sentence",
  "user_profile": { "country": "string", "city": "string", "grade": "string", "major": "string" },
  "nodes": { "<node_id>": { "type": "string", "scene_text": "string", "image_prompt": "string|null", "has_image": boolean, "choices": [{ "text": "string", "next_node": "string" }] } },
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
  if (Object.keys(doc.endings).length === 0) {
    throw new Error("Design Agent output has no endings");
  }
  for (const [id, ending] of Object.entries(doc.endings)) {
    if (!["hopeful", "bittersweet", "challenging"].includes(ending.tone)) {
      throw new Error(`Ending "${id}" has invalid tone "${ending.tone}"`);
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

export async function runDesignAgent(report: ResearchReport, storyId: string): Promise<StoryDocument> {
  const client = getOpenAIClient();
  const userInput = `Story ID to use: "${storyId}"\n\nResearch report:\n${JSON.stringify(report, null, 2)}`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: DESIGN_SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: config.models.design,
        messages,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      let doc: StoryDocument;
      try {
        doc = JSON.parse(extractJson(raw)) as StoryDocument;
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
