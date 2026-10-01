import fs from "node:fs/promises";
import path from "node:path";
import { advanceStory, initialPlayState } from "../frontend/src/lib/storyRuntime";
import { LEARNING_POLICY } from "../shared/studyDesign";
import type { StoryDocument } from "../frontend/src/types";

function sample(doc: StoryDocument) {
  let complete = 0, severe = 0, decisions = 0;
  const errors = new Set<string>();
  for (let run = 1; run <= 250; run++) {
    let seed = (20261001 ^ Math.imul(run, 2654435761)) >>> 0;
    let state = initialPlayState(doc);
    let finished = false;
    try {
      for (let step = 0; step < 300; step++) {
        const page = doc.nodes[state.nodeId] ?? doc.endings[state.nodeId];
        if (state.failedStat || page?.failure_recovery || page?.logic_page_role === "failure") { severe++; finished = true; break; }
        if (doc.endings[state.nodeId]) { complete++; finished = true; break; }
        const choices = doc.nodes[state.nodeId]?.choices;
        if (!choices?.length) throw new Error(`No choices at ${state.nodeId}`);
        if (choices.length > 1) { decisions++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; }
        state = advanceStory(doc, state, choices[choices.length === 1 ? 0 : Math.floor(seed / 2 ** 32 * choices.length)]);
      }
      if (!finished) errors.add("step limit");
    } catch (error) { errors.add(String(error)); }
  }
  return { complete, severe, averageDecisions: Number((decisions / 250).toFixed(2)), errors: [...errors] };
}

async function main() {
  const rows = [];
  for (const file of (await fs.readdir("data/stories")).filter((name) => name.endsWith("_final.json"))) {
    const doc = JSON.parse(await fs.readFile(path.join("data/stories", file), "utf8")) as StoryDocument;
    rows.push({ storyId: doc.story_id, logicGraph: Boolean(doc.logic), baseline: sample(doc), learning: sample({ ...doc, learning_policy: LEARNING_POLICY }) });
  }
  await fs.writeFile("docs/learning-audit-data.json", JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ stories: rows.length, runs: rows.length * 500, errors: rows.filter((r) => r.baseline.errors.length || r.learning.errors.length), fullStories: rows.filter((r) => r.logicGraph) }, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
