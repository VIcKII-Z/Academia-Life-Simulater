import fs from "node:fs/promises";
import path from "node:path";
import { advanceStory, initialPlayState } from "../frontend/src/lib/storyRuntime";
import { storyLanguage, storyLanguageIssues } from "../shared/storyLanguage";
import type { StoryDocument } from "../frontend/src/types";

async function main() {
const directory = path.resolve("data/stories");
let randomSeed = 20261001;
const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 2 ** 32; };
const rows = [];
for (const file of (await fs.readdir(directory)).filter((name) => name.endsWith("_final.json"))) {
  const doc = JSON.parse(await fs.readFile(path.join(directory, file), "utf8")) as StoryDocument;
  const ids = new Set([...Object.keys(doc.nodes), ...Object.keys(doc.endings)]);
  const sentinels = new Set([doc.logic?.warning_return_sentinel, doc.logic?.result_return_sentinel]);
  const dangling: string[] = [];
  for (const [id, page] of Object.entries(doc.nodes)) for (const choice of page.choices ?? []) {
    for (const dest of [choice.next_node, choice.logic_planned_next_node].filter(Boolean)) {
      if (!ids.has(dest!) && !sentinels.has(dest as never)) dangling.push(`${id} -> ${dest}`);
    }
  }
  const endings: Record<string, number> = {};
  const routingErrors = new Set<string>();
  let decisions = 0;
  for (let run = 0; run < 250; run++) {
    try {
      let state = initialPlayState(doc);
      let terminated = false;
      for (let step = 0; step < 300; step++) {
        if (doc.endings[state.nodeId] || state.failedStat) {
          const key = state.failedStat ? `stat:${state.failedStat}` : state.nodeId;
          endings[key] = (endings[key] ?? 0) + 1;
          terminated = true; break;
        }
        const page = doc.nodes[state.nodeId];
        if (!page?.choices?.length) throw new Error(`No choices at ${state.nodeId}`);
        if (page.choices.length > 1) decisions++;
        const choice = page.choices[Math.floor(random() * page.choices.length)];
        state = advanceStory(doc, state, choice);
      }
      if (!terminated) routingErrors.add("Step limit reached");
    } catch (error) { routingErrors.add(String(error)); }
  }
  const languageIssues = storyLanguageIssues(doc);
  rows.push({ storyId: doc.story_id, language: storyLanguage(doc), pages: ids.size,
    languageIssueCount: languageIssues.length, languageIssueExamples: languageIssues.slice(0, 8),
    dangling, routingErrors: [...routingErrors], sampledRoutes: 250, averageDecisions: Number((decisions / 250).toFixed(1)), endings });
}
await fs.mkdir("docs", { recursive: true });
await fs.writeFile("docs/project-audit-data.json", JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ stories: rows.length, sampledRoutes: rows.length * 250,
  mixedLanguageStories: rows.filter((row) => row.languageIssueCount).map((row) => ({ id: row.storyId, issues: row.languageIssueCount })),
  structuralProblems: rows.filter((row) => row.dangling.length || row.routingErrors.length).map((row) => ({ id: row.storyId, dangling: row.dangling, errors: row.routingErrors })),
}, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
