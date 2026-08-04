import { buildFallbackLogicGraph, validateLogicGraph } from "../src/agents/logicGraphAgent.ts";
import { compileLogicGraphToStoryDocument } from "../src/agents/logicGraphCompiler.ts";

type Band = "good" | "mid" | "bad" | "critical";
type Vars = Record<string, number>;
type Strategy = "normal" | "positive" | "negative" | "mixed" | "random";

const report = {
  mode: "preset",
  location: { country: "Japan", city: "Tokyo" },
  major: "Data Science",
  grade: "Taught Master",
  profile: {
    country: "China",
    city: "Tokyo",
    school: "Demo University",
    department: "School of Informatics",
    program: "MSc Data Science",
    major: "Data Science",
    grade: "Taught Master",
  },
  report: {
    cost_of_living: "Tokyo cost pressure demo.",
    academic: "Coursework master demo.",
    visa: "Student visa demo.",
    culture_shock: "Culture shock demo.",
    community: "Support demo.",
    career: "Career demo.",
    safety: "Safety demo.",
    climate: "Climate demo.",
    part_time_work: "Part-time work demo.",
  },
};

const graph = buildFallbackLogicGraph(report, "pure_sim_demo");
validateLogicGraph(graph);
const story = compileLogicGraphToStoryDocument(graph, report, "pure_sim_demo");

function band(value: number): Band {
  if (value <= 15) return "critical";
  if (value <= 45) return "bad";
  if (value <= 75) return "mid";
  return "good";
}

function initVars(): Vars {
  const vars: Vars = {};
  for (const variable of story.logic?.variables ?? []) vars[variable.id] = variable.initial;
  return vars;
}

function applyDelta(vars: Vars, delta?: Record<string, number>): Vars {
  const next = { ...vars };
  for (const [key, change] of Object.entries(delta ?? {})) {
    next[key] = Math.max(0, Math.min(100, Math.round((next[key] ?? 70) + change)));
  }
  return next;
}

function choose(nodeId: string, strategy: Strategy, step: number) {
  const node = story.nodes[nodeId];
  const choices = node?.choices ?? [];
  if (strategy === "normal") return choices.find((choice) => choice.text.includes("_O1:")) ?? choices[0];
  if (strategy === "positive") return choices.find((choice) => choice.text.includes("_O2:")) ?? choices[1] ?? choices[0];
  if (strategy === "negative") return choices.find((choice) => choice.text.includes("_O3:")) ?? choices[2] ?? choices[0];
  if (strategy === "mixed") {
    const pattern: Strategy[] = ["normal", "positive", "normal", "negative", "normal", "positive", "normal", "normal"];
    return choose(nodeId, pattern[step % pattern.length], step);
  }
  return choices[Math.floor(Math.random() * choices.length)];
}

function varsLine(vars: Vars): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${band(value)}(${value})`)
    .join(" ");
}

function simulate(strategy: Strategy, maxSteps = 260) {
  const logic = story.logic;
  if (!logic) throw new Error("Compiled story is missing logic runtime data.");

  let current = logic.start_node_id;
  let vars = initVars();
  const warningsSeen: Record<string, boolean> = {};
  let warningReturn: string | null = null;
  let resultReturn: string | null = null;
  const trace: string[] = [];
  let choices = 0;
  let warnings = 0;
  let resultPages = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (story.endings[current]) return { strategy, ending: current, choices, warnings, resultPages, vars, trace };
    const node = story.nodes[current];
    if (!node) return { strategy, ending: `MISSING_${current}`, choices, warnings, resultPages, vars, trace };
    const choice = choose(current, strategy, choices);
    if (!choice) return { strategy, ending: `NO_CHOICE_${current}`, choices, warnings, resultPages, vars, trace };

    if (choice.next_node === logic.warning_return_sentinel) {
      current = warningReturn ?? logic.start_node_id;
      warningReturn = null;
      trace.push(`warning_return -> ${current}`);
      continue;
    }

    if (choice.next_node === logic.result_return_sentinel) {
      current = resultReturn ?? logic.start_node_id;
      resultReturn = null;
      trace.push(`result_continue -> ${current}`);
      continue;
    }

    const previous = { ...vars };
    if (Object.keys(choice.logic_delta ?? {}).length > 0) {
      choices++;
      resultReturn = choice.logic_planned_next_node ?? null;
      vars = applyDelta(vars, choice.logic_delta);
      trace.push(`${current} -- ${choice.text.split(":")[0]} -> ${choice.next_node} | ${varsLine(vars)}`);
    } else {
      if (node.logic_page_role === "result") resultPages++;
      trace.push(`${current} -> ${choice.next_node}`);
    }

    const critical = logic.variables.find((variable) => band(vars[variable.id] ?? variable.initial) === "critical");
    if (critical) {
      trace.push(`CRITICAL ${critical.id} -> ${critical.failure_page_id}`);
      current = critical.failure_page_id;
      continue;
    }

    const newlyBad = logic.variables.find((variable) => {
      if (warningsSeen[variable.id]) return false;
      const after = band(vars[variable.id] ?? variable.initial);
      return after === "bad";
    });
    if (newlyBad) {
      warningsSeen[newlyBad.id] = true;
      warnings++;
      warningReturn = choice.next_node;
      trace.push(`WARNING ${newlyBad.id} -> ${newlyBad.warning_page_id} then ${warningReturn}`);
      current = newlyBad.warning_page_id;
      continue;
    }

    current = choice.next_node;
  }

  return { strategy, ending: "MAX_STEPS", choices, warnings, resultPages, vars, trace };
}

for (const strategy of ["normal", "positive", "negative", "mixed"] as Strategy[]) {
  const run = simulate(strategy);
  console.log(`\n=== ${run.strategy} ===`);
  console.log("ending", run.ending, "choices", run.choices, "warnings", run.warnings, "resultPages", run.resultPages);
  console.log(
    "vars",
    Object.fromEntries(Object.entries(run.vars).map(([key, value]) => [key, `${value}/${band(value)}`])),
  );
  console.log("trace sample");
  console.log(run.trace.slice(0, 18).join("\n"));
  if (run.trace.length > 18) console.log(`... ${run.trace.length - 18} more`);
}

const endings: Record<string, number> = {};
const warningCounts: number[] = [];
const lengths: number[] = [];
for (let i = 0; i < 200; i++) {
  const run = simulate("random");
  endings[run.ending] = (endings[run.ending] ?? 0) + 1;
  warningCounts.push(run.warnings);
  lengths.push(run.choices);
}

console.log("\n=== random x200 ===");
console.log("endings", endings);
console.log(
  "avgChoices",
  (lengths.reduce((sum, value) => sum + value, 0) / lengths.length).toFixed(1),
  "avgWarnings",
  (warningCounts.reduce((sum, value) => sum + value, 0) / warningCounts.length).toFixed(1),
);
console.log("pages", {
  nodes: Object.keys(story.nodes).length,
  endings: Object.keys(story.endings).length,
  start: story.logic?.start_node_id,
  variables: story.logic?.variables.map((variable) => variable.id),
});
