import { config } from "../config/config.js";
import { getOpenAIClient, getRuntimeModel } from "./openaiClient.js";
import type {
  LogicEnding,
  LogicGraphDocument,
  LogicNode,
  LogicNodeType,
  LogicOption,
  LogicOptionKind,
  LogicPage,
  LogicVariableDefinition,
  ResearchReport,
  RuntimeConfig,
  Tone,
} from "../types.js";

const WARNING_RETURN_SENTINEL = "__return_from_warning__";

const BASE_VARIABLES: LogicVariableDefinition[] = [
  {
    id: "money",
    label: "Money",
    initial: 70,
    is_base: true,
    rationale: "Cash buffer determines deposits, housing, proof of funds, and whether the offer remains feasible.",
    affects_nodes: ["N02_accept_deposit", "N03_money", "N05_housing_arrival", "N11_graduation_window", "N12_exit"],
    warning_page_id: "W_money_bad",
    failure_page_id: "E_money_critical",
  },
  {
    id: "time",
    label: "Time",
    initial: 70,
    is_base: true,
    rationale: "Deadline buffer controls offer acceptance, visa timing, registration, and post-study work windows.",
    affects_nodes: ["N02_accept_deposit", "N04_visa_departure", "N06_registration_courses", "N11_graduation_window"],
    warning_page_id: "W_time_bad",
    failure_page_id: "E_time_critical",
  },
  {
    id: "visa",
    label: "Visa",
    initial: 70,
    is_base: true,
    rationale: "Immigration readiness decides whether the student can enter, enroll, work, and remain after graduation.",
    affects_nodes: ["N04_visa_departure", "N06_registration_courses", "N10_career", "N11_graduation_window", "N12_exit"],
    warning_page_id: "W_visa_bad",
    failure_page_id: "E_visa_critical",
  },
  {
    id: "housing",
    label: "Housing",
    initial: 70,
    is_base: true,
    rationale: "Housing security changes arrival risk, commute fatigue, money pressure, and emotional stability.",
    affects_nodes: ["N05_housing_arrival", "N06_registration_courses", "N07_first_term", "N08_support_risk"],
    warning_page_id: "W_housing_bad",
    failure_page_id: "E_housing_critical",
  },
  {
    id: "school",
    label: "School",
    initial: 70,
    is_base: true,
    rationale: "Academic progress determines whether the student can pass courses, reach the milestone, and graduate.",
    affects_nodes: ["N06_registration_courses", "N07_first_term", "N09_milestone", "N11_graduation_window", "N12_exit"],
    warning_page_id: "W_school_bad",
    failure_page_id: "E_school_critical",
  },
  {
    id: "wellbeing",
    label: "Wellbeing",
    initial: 70,
    is_base: true,
    rationale: "Physical and emotional resilience affects the ability to survive pressure without needing to pause.",
    affects_nodes: ["N05_housing_arrival", "N07_first_term", "N08_support_risk", "N09_milestone", "N12_exit"],
    warning_page_id: "W_wellbeing_bad",
    failure_page_id: "E_wellbeing_critical",
  },
];

const REQUIRED_OPTION_KINDS: LogicOptionKind[] = ["normal", "positive_extreme", "negative_extreme"];

function buildLogicGraphSystemPrompt(outputLanguage: RuntimeConfig["outputLanguage"] = "en"): string {
  const languageRule =
    outputLanguage === "zh"
      ? "Write player-facing titles, labels, placeholders, rationale, and condition summaries in Simplified Chinese. Keep JSON keys, ids, variable ids, enum values, and routing ids unchanged in English."
      : "Write player-facing titles, labels, placeholders, rationale, and condition summaries in English. Keep JSON keys, ids, variable ids, enum values, and routing ids unchanged.";
  return `You are the Logic Graph Planner for a post-offer study-abroad decision simulator.

Your job is NOT to write polished story prose. Your job is to generate a complete variable-gated
branch graph that can later be compiled into deterministic if/else runtime logic.

[Product direction]
- The game starts AFTER the student has an offer. Do not simulate applications, essays,
  recommendation letters, admission competition, or application-round strategy.
- Supported degree tracks only: undergraduate and taught/coursework master.
- Mark nodes that can easily change the ending as special_nodes.
- After research, you may adapt the fixed node list, add supplemental nodes, and propose/accept
  supplemental variables when facts make them matter.

[Output Language]
- ${languageRule}

[Base variables]
Always include these base variables exactly: money, time, visa, housing, school, wellbeing.
Each variable is numeric 0-100 and maps to four bands:
- good: 76-100
- mid: 46-75
- bad: 16-45
- critical: 0-15
At runtime, if a variable enters bad for the first time, a warning page interrupts once and then
returns to the interrupted option chain. If a variable reaches critical, the current chain stops
and routes to that variable's failure page.

[Graph semantics]
- Every playable node MUST have exactly three options:
  1. kind="normal": realistic moderate action.
  2. kind="positive_extreme": good-direction but extreme action, with tradeoffs.
  3. kind="negative_extreme": bad-direction extreme action.
- Every option MUST have a unique id, a result_page_id, a planned_next_id, a route_decision, delta,
  rationale, and label.
- The result page is the option-after page placeholder. It then returns to planned_next_id unless
  variable warning/failure logic interrupts first.
- Decide by real-world semantics whether an option returns to the next main node, enters a parallel
  branch node, or enters an ending. Do not use fixed depth limits; use factual consequences.
- Two different options may point to the same result page or ending if the semantics genuinely match.
- All graph routing must be explicit IDs. No vector matching, semantic page search, or fuzzy routing
  may be required at runtime.
- Every option chain from the start must be able to reach an ending.

[Text variant marking]
Do not write final prose yet. Mark pages whose text should later split by variable bands or
combinations. Examples:
- money changes housing-page text.
- visa + time changes visa-page urgency.
- school + wellbeing changes academic-pressure text.
Only mark combinations when the combination changes the real meaning, not for every possible
cartesian product.

[Output]
Output strict JSON only. Use this structure:
{
  "flow_version": "post_offer_v1",
  "story_id": "string",
  "degree_track": "undergraduate|master_taught",
  "base_variables": [
    {
      "id": "money",
      "label": "Money",
      "initial": 70,
      "is_base": true,
      "rationale": "string",
      "affects_nodes": ["N03_money"],
      "warning_page_id": "W_money_bad",
      "failure_page_id": "E_money_critical"
    }
  ],
  "suggested_variables": [],
  "accepted_supplemental_variables": [],
  "main_node_order": ["N01_offer_check", "N02_accept_deposit"],
  "special_nodes": [{ "node_id": "N03_money", "reason": "string", "ending_impact": "string" }],
  "research_adjustments": [{ "node_id": "N03_money", "adjustment": "string", "facts_used": ["string"] }],
  "nodes": {
    "N03_money": {
      "id": "N03_money",
      "type": "special_node|base_node|branch_node",
      "title": "string",
      "stage": "offer_prearrival|study|post_graduation",
      "is_special": true,
      "why_special": "string",
      "variables_read": ["money", "visa"],
      "variables_written": ["money", "visa"],
      "facts_used": ["string"],
      "variant_triggers": [{ "variables": ["money"], "reason": "string", "combinations": ["money=bad"] }],
      "options": [
        {
          "id": "N03_O1",
          "kind": "normal|positive_extreme|negative_extreme",
          "label": "string",
          "result_page_id": "R_N03_O1",
          "planned_next_id": "N04_visa_departure",
          "route_decision": "return_to_next_main_node|enter_parallel_branch_node|enter_ending",
          "delta": { "money": -8, "time": -3, "visa": 8, "housing": 0, "school": 0, "wellbeing": 2 },
          "state_set": { "funding_status": "ready" },
          "rationale": "string",
          "facts_used": ["string"]
        }
      ]
    }
  },
  "pages": {
    "N03_money": {
      "id": "N03_money",
      "role": "node|result|warning|failure|ending",
      "owner_node_id": "N03_money",
      "title": "string",
      "placeholder": "string",
      "variant_triggers": [{ "variables": ["money"], "reason": "string" }]
    },
    "R_N03_O1": {
      "id": "R_N03_O1",
      "role": "result",
      "owner_node_id": "N03_money",
      "title": "Option result",
      "placeholder": "Option-after page placeholder."
    }
  },
  "endings": {
    "E_local_progress": { "id": "E_local_progress", "title": "string", "tone": "hopeful|bittersweet|challenging", "condition_summary": "string" }
  },
  "gaps": []
}`;
}

function stripMarkdownFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : text;
}

function extractJson(text: string): string {
  const stripped = stripMarkdownFences(text);
  const start = stripped.indexOf("{");
  if (start === -1) throw new Error("Logic Graph Agent did not return JSON");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const char = stripped[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  throw new Error("Logic Graph Agent returned incomplete JSON");
}

function allVariables(graph: LogicGraphDocument): LogicVariableDefinition[] {
  const merged = new Map<string, LogicVariableDefinition>();
  for (const variable of BASE_VARIABLES) merged.set(variable.id, { ...variable });
  for (const variable of graph.base_variables ?? []) merged.set(variable.id, { ...variable, is_base: true });
  for (const variable of graph.accepted_supplemental_variables ?? []) merged.set(variable.id, variable);
  return [...merged.values()];
}

function normalizeVariable(variable: LogicVariableDefinition): LogicVariableDefinition {
  const id = variable.id.trim();
  return {
    ...variable,
    id,
    label: variable.label?.trim() || id,
    initial: Number.isFinite(variable.initial) ? Math.max(0, Math.min(100, Math.round(variable.initial))) : 70,
    warning_page_id: variable.warning_page_id?.trim() || `W_${id}_bad`,
    failure_page_id: variable.failure_page_id?.trim() || `E_${id}_critical`,
    affects_nodes: Array.isArray(variable.affects_nodes) ? variable.affects_nodes : [],
    rationale: variable.rationale?.trim() || "Variable affects post-offer route feasibility.",
  };
}

function ensurePage(graph: LogicGraphDocument, page: LogicPage): void {
  graph.pages[page.id] ??= page;
}

function ensureEnding(graph: LogicGraphDocument, ending: LogicEnding): void {
  graph.endings[ending.id] ??= ending;
}

function normalizeLogicGraph(graph: LogicGraphDocument, storyId: string, report: ResearchReport): LogicGraphDocument {
  graph.flow_version = "post_offer_v1";
  graph.story_id = storyId;
  graph.degree_track =
    graph.degree_track === "undergraduate" || graph.degree_track === "master_taught"
      ? graph.degree_track
      : /undergrad|bachelor/i.test(report.grade)
        ? "undergraduate"
        : "master_taught";
  graph.base_variables = allVariables(graph).filter((variable) => BASE_VARIABLES.some((base) => base.id === variable.id)).map(normalizeVariable);
  graph.accepted_supplemental_variables = (graph.accepted_supplemental_variables ?? [])
    .filter((variable) => !BASE_VARIABLES.some((base) => base.id === variable.id))
    .map(normalizeVariable);
  graph.suggested_variables ??= [];
  graph.research_adjustments ??= [];
  graph.special_nodes ??= [];
  graph.pages ??= {};
  graph.nodes ??= {};
  graph.endings ??= {};
  graph.gaps ??= [];

  for (const variable of allVariables(graph).map(normalizeVariable)) {
    ensurePage(graph, {
      id: variable.warning_page_id,
      role: "warning",
      title: `${variable.label} warning`,
      placeholder: `${variable.label} has fallen into the bad band for the first time. Warn once, explain the risk, then return to the interrupted option chain.`,
      variant_triggers: [{ variables: [variable.id], reason: `${variable.label} warning page reflects bad-band status.` }],
    });
    ensureEnding(graph, {
      id: variable.failure_page_id,
      title: `${variable.label} failure`,
      tone: "challenging",
      condition_summary: `${variable.label} reached the critical band, stopping the current plan chain.`,
    });
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    node.id ||= nodeId;
    node.options ??= [];
    ensurePage(graph, {
      id: node.id,
      role: "node",
      owner_node_id: node.id,
      title: node.title || node.id,
      placeholder: `Main decision page for ${node.title || node.id}.`,
      variant_triggers: node.variant_triggers,
    });
    for (const option of node.options) {
      ensurePage(graph, {
        id: option.result_page_id,
        role: "result",
        owner_node_id: node.id,
        title: `${node.title || node.id}: ${option.kind}`,
        placeholder: `Option-after page placeholder for ${option.id}: ${option.label}`,
      });
    }
  }

  return graph;
}

function nodeExists(graph: LogicGraphDocument, id: string): boolean {
  return Boolean(graph.nodes[id] || graph.endings[id]);
}

function validateOptionSet(node: LogicNode, seenOptionIds: Set<string>): void {
  if (!Array.isArray(node.options) || node.options.length !== 3) {
    throw new Error(`Node "${node.id}" must have exactly 3 options`);
  }
  const kinds = new Set(node.options.map((option) => option.kind));
  for (const required of REQUIRED_OPTION_KINDS) {
    if (!kinds.has(required)) throw new Error(`Node "${node.id}" missing ${required} option`);
  }
  for (const option of node.options) {
    if (!option.id?.trim()) throw new Error(`Node "${node.id}" has an option without id`);
    if (seenOptionIds.has(option.id)) throw new Error(`Duplicate option id "${option.id}"`);
    seenOptionIds.add(option.id);
    if (!option.result_page_id?.trim()) throw new Error(`Option "${option.id}" missing result_page_id`);
    if (!option.planned_next_id?.trim()) throw new Error(`Option "${option.id}" missing planned_next_id`);
    if (!option.route_decision) throw new Error(`Option "${option.id}" missing route_decision`);
    if (!option.delta || typeof option.delta !== "object") throw new Error(`Option "${option.id}" missing delta`);
  }
}

function canReachEnding(graph: LogicGraphDocument, startId: string, visited = new Set<string>()): boolean {
  if (graph.endings[startId]) return true;
  const node = graph.nodes[startId];
  if (!node || visited.has(startId)) return false;
  visited.add(startId);
  return node.options.some((option) => canReachEnding(graph, option.planned_next_id, new Set(visited)));
}

export function validateLogicGraph(graph: LogicGraphDocument): void {
  if (graph.flow_version !== "post_offer_v1") throw new Error("Logic graph flow_version must be post_offer_v1");
  if (!graph.story_id) throw new Error("Logic graph missing story_id");
  if (!Array.isArray(graph.main_node_order) || graph.main_node_order.length === 0) {
    throw new Error("Logic graph must include main_node_order");
  }
  if (!graph.nodes || Object.keys(graph.nodes).length === 0) throw new Error("Logic graph must include nodes");
  if (!graph.pages || Object.keys(graph.pages).length === 0) throw new Error("Logic graph must include pages");
  if (!graph.endings || Object.keys(graph.endings).length === 0) throw new Error("Logic graph must include endings");

  const variables = allVariables(graph).map(normalizeVariable);
  const variableIds = new Set(variables.map((variable) => variable.id));
  for (const base of BASE_VARIABLES) {
    if (!variableIds.has(base.id)) throw new Error(`Missing base variable "${base.id}"`);
  }
  for (const variable of variables) {
    if (!graph.pages[variable.warning_page_id]) throw new Error(`Missing warning page "${variable.warning_page_id}"`);
    if (!graph.endings[variable.failure_page_id]) throw new Error(`Missing failure ending "${variable.failure_page_id}"`);
  }

  for (const nodeId of graph.main_node_order) {
    if (!graph.nodes[nodeId]) throw new Error(`main_node_order references missing node "${nodeId}"`);
  }

  const seenOptionIds = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (!["base_node", "special_node", "branch_node"].includes(node.type)) {
      throw new Error(`Node "${node.id}" has invalid type "${node.type}"`);
    }
    validateOptionSet(node, seenOptionIds);
    if (!graph.pages[node.id]) throw new Error(`Node "${node.id}" missing page with same id`);
    for (const option of node.options) {
      if (!graph.pages[option.result_page_id]) throw new Error(`Option "${option.id}" result page "${option.result_page_id}" missing`);
      if (!nodeExists(graph, option.planned_next_id)) {
        throw new Error(`Option "${option.id}" planned_next_id "${option.planned_next_id}" is missing`);
      }
      if (!canReachEnding(graph, option.planned_next_id)) {
        throw new Error(`Option "${option.id}" chain from "${option.planned_next_id}" cannot reach an ending`);
      }
    }
  }

  for (const special of graph.special_nodes ?? []) {
    const node = graph.nodes[special.node_id];
    if (!node) throw new Error(`special_nodes references missing node "${special.node_id}"`);
    if (!node.is_special && node.type !== "special_node") throw new Error(`Special node "${special.node_id}" is not marked special`);
    const hasEndingImpact = node.options.some(
      (option) =>
        option.route_decision !== "return_to_next_main_node" ||
        graph.endings[option.planned_next_id] ||
        Math.min(...Object.values(option.delta ?? {})) <= -20,
    );
    if (!hasEndingImpact) throw new Error(`Special node "${special.node_id}" has no high-impact option`);
  }
}

function makeOption(
  nodeId: string,
  optionIndex: number,
  kind: LogicOptionKind,
  label: string,
  plannedNextId: string,
  delta: Record<string, number>,
  routeDecision: LogicOption["route_decision"] = "return_to_next_main_node",
): LogicOption {
  const suffix = ["O1", "O2", "O3"][optionIndex] ?? `O${optionIndex + 1}`;
  return {
    id: `${nodeId}_${suffix}`,
    kind,
    label,
    result_page_id: `R_${nodeId}_${suffix}`,
    planned_next_id: plannedNextId,
    route_decision: routeDecision,
    delta,
    rationale: `${kind} choice changes variables and then routes by explicit planned_next_id.`,
  };
}

function fallbackNode(
  id: string,
  type: LogicNodeType,
  title: string,
  stage: LogicNode["stage"],
  nextId: string,
  special = false,
): LogicNode {
  const negativeNext = special ? `B_${id}_risk` : nextId;
  return {
    id,
    type,
    title,
    stage,
    is_special: special,
    why_special: special ? `${title} can materially alter feasibility or ending eligibility.` : undefined,
    variables_read: ["money", "time", "visa", "housing", "school", "wellbeing"],
    variables_written: ["money", "time", "visa", "housing", "school", "wellbeing"],
    variant_triggers: [
      { variables: ["money"], reason: `${title} reads differently when money is good, mid, bad, or critical.` },
      { variables: ["time"], reason: `${title} urgency changes as deadline buffer changes.` },
    ],
    options: [
      makeOption(id, 0, "normal", "Choose the steady realistic action and keep the plan moving.", nextId, {
        money: -4,
        time: -4,
        visa: 3,
        housing: 2,
        school: 3,
        wellbeing: 1,
      }),
      makeOption(id, 1, "positive_extreme", "Over-invest to remove uncertainty quickly, accepting a sharper tradeoff elsewhere.", nextId, {
        money: -12,
        time: -8,
        visa: 8,
        housing: 5,
        school: 6,
        wellbeing: -3,
      }),
      makeOption(id, 2, "negative_extreme", "Delay the hard part and hope the situation stays manageable.", negativeNext, {
        money: 3,
        time: -14,
        visa: -8,
        housing: -6,
        school: -6,
        wellbeing: -8,
      }, special ? "enter_parallel_branch_node" : "return_to_next_main_node"),
    ],
  };
}

function fallbackBranch(branchId: string, title: string, nextId: string, failureEndingId: string): LogicNode {
  return {
    id: branchId,
    type: "branch_node",
    title,
    stage: "offer_prearrival",
    is_special: true,
    why_special: "This branch exists because an extreme choice created a new concrete risk.",
    variables_read: ["money", "time", "visa", "wellbeing"],
    variables_written: ["money", "time", "visa", "wellbeing"],
    variant_triggers: [{ variables: ["time", "visa"], reason: "This recovery branch changes depending on urgency and visa readiness." }],
    options: [
      makeOption(branchId, 0, "normal", "Stabilize the risk with a practical recovery step.", nextId, {
        money: -5,
        time: -6,
        visa: 6,
        housing: 2,
        school: 2,
        wellbeing: 1,
      }),
      makeOption(branchId, 1, "positive_extreme", "Ask for direct institutional help and spend extra effort to recover quickly.", nextId, {
        money: -10,
        time: -8,
        visa: 10,
        housing: 4,
        school: 4,
        wellbeing: 3,
      }),
      makeOption(branchId, 2, "negative_extreme", "Keep gambling on the delay until the route is no longer viable.", failureEndingId, {
        money: 2,
        time: -25,
        visa: -18,
        housing: -8,
        school: -10,
        wellbeing: -12,
      }, "enter_ending"),
    ],
  };
}

function fallbackEnding(id: string, title: string, tone: Tone, conditionSummary: string): LogicEnding {
  return { id, title, tone, condition_summary: conditionSummary };
}

function addNodeAndPages(graph: LogicGraphDocument, node: LogicNode): void {
  graph.nodes[node.id] = node;
  graph.pages[node.id] = {
    id: node.id,
    role: "node",
    owner_node_id: node.id,
    title: node.title,
    placeholder: `Decision page placeholder for ${node.title}.`,
    variant_triggers: node.variant_triggers,
  };
  for (const option of node.options) {
    graph.pages[option.result_page_id] = {
      id: option.result_page_id,
      role: "result",
      owner_node_id: node.id,
      title: `${node.title}: ${option.kind}`,
      placeholder: `Option-after page placeholder for ${option.id}.`,
      variant_triggers: [
        { variables: Object.keys(option.delta).filter((key) => option.delta[key] !== 0), reason: "Result text should reflect variables changed by this option." },
      ],
    };
  }
}

export function buildFallbackLogicGraph(report: ResearchReport, storyId: string): LogicGraphDocument {
  const main = [
    ["N01_offer_check", "Offer check", "offer_prearrival", true],
    ["N02_accept_deposit", "Accept, deposit, and defer", "offer_prearrival", true],
    ["N03_money", "Money and proof of funds", "offer_prearrival", true],
    ["N04_visa_departure", "Visa and departure", "offer_prearrival", true],
    ["N05_housing_arrival", "Housing and arrival", "offer_prearrival", false],
    ["N06_registration_courses", "Registration and course enrollment", "study", false],
    ["N07_first_term", "First-term pressure", "study", false],
    ["N08_support_risk", "Support and risk", "study", false],
    ["N09_milestone", "Key academic milestone", "study", true],
    ["N10_career", "Career preparation", "study", false],
    ["N11_graduation_window", "Graduation and post-study window", "post_graduation", true],
    ["N12_exit", "Exit decision", "post_graduation", true],
  ] as const;
  const graph: LogicGraphDocument = {
    flow_version: "post_offer_v1",
    story_id: storyId,
    degree_track: /undergrad|bachelor/i.test(report.grade) ? "undergraduate" : "master_taught",
    base_variables: BASE_VARIABLES,
    suggested_variables: [],
    accepted_supplemental_variables: [
      {
        id: "career",
        label: "Career",
        initial: 60,
        is_base: false,
        rationale: "Career readiness affects the final local-job, return-home, or third-country exit.",
        affects_nodes: ["N10_career", "N11_graduation_window", "N12_exit"],
        warning_page_id: "W_career_bad",
        failure_page_id: "E_career_critical",
      },
    ],
    main_node_order: main.map(([id]) => id),
    special_nodes: main
      .filter(([, , , special]) => special)
      .map(([nodeId, title]) => ({
        node_id: nodeId,
        reason: `${title} can redirect the route or materially change ending eligibility.`,
        ending_impact: "Can lead to defer, pause, failure, return-home, or local-progress endings.",
      })),
    research_adjustments: [
      {
        node_id: "N01_offer_check",
        adjustment: "Start from the offer and admitted-student workflow instead of application prep.",
      },
    ],
    nodes: {},
    pages: {},
    endings: {
      E_local_progress: fallbackEnding("E_local_progress", "Local progress", "hopeful", "Graduated with enough status and preparation to attempt local work."),
      E_defer_pause: fallbackEnding("E_defer_pause", "Defer or pause", "bittersweet", "A high-impact risk made immediate enrollment or completion unrealistic."),
      E_return_home: fallbackEnding("E_return_home", "Return home with clearer constraints", "bittersweet", "The route closes locally but preserves a viable return-home plan."),
    },
    gaps: ["Fallback graph used because model logic graph generation failed or was unavailable."],
  };

  for (const variable of allVariables(graph)) {
    graph.pages[variable.warning_page_id] = {
      id: variable.warning_page_id,
      role: "warning",
      title: `${variable.label} is under pressure`,
      placeholder: `${variable.label} has entered the bad band. Warn the player once and return to the interrupted chain.`,
      variant_triggers: [{ variables: [variable.id], reason: `${variable.label} is bad but not critical.` }],
    };
    graph.endings[variable.failure_page_id] = fallbackEnding(
      variable.failure_page_id,
      `${variable.label} critical failure`,
      "challenging",
      `${variable.label} reached critical and stops the current planning chain.`,
    );
  }

  for (let index = 0; index < main.length; index++) {
    const [id, title, stage, special] = main[index];
    const nextId = index === main.length - 1 ? "E_local_progress" : main[index + 1][0];
    addNodeAndPages(graph, fallbackNode(id, special ? "special_node" : "base_node", title, stage, nextId, special));
    if (special) {
      addNodeAndPages(graph, fallbackBranch(`B_${id}_risk`, `${title} risk branch`, nextId, "E_defer_pause"));
    }
  }

  return normalizeLogicGraph(graph, storyId, report);
}

const MAX_ATTEMPTS = 5;

export async function runLogicGraphAgent(
  report: ResearchReport,
  storyId: string,
  runtimeConfig?: RuntimeConfig,
): Promise<LogicGraphDocument> {
  const client = getOpenAIClient(runtimeConfig, "text");
  const outputLanguage = runtimeConfig?.outputLanguage ?? "en";
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildLogicGraphSystemPrompt(outputLanguage) },
    {
      role: "user",
      content: `Story ID: "${storyId}"\n\nResearch report:\n${JSON.stringify(report, null, 2)}`,
    },
  ];

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: getRuntimeModel(runtimeConfig, "text"),
        messages,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const graph = normalizeLogicGraph(JSON.parse(extractJson(raw)) as LogicGraphDocument, storyId, report);
      validateLogicGraph(graph);
      return graph;
    } catch (err) {
      lastError = err;
      messages.push({
        role: "user",
        content: `The previous logic graph was invalid: ${err instanceof Error ? err.message : String(err)}

Repair the graph and output the complete corrected JSON again, not a diff. Preserve existing node/option ids where possible. Remember:
- every playable node exactly 3 options: normal, positive_extreme, negative_extreme
- every option has result_page_id and planned_next_id
- every option chain reaches an ending
- base variables money/time/visa/housing/school/wellbeing must exist
- runtime must be explicit if/else over ids and variables only
- preserve the requested output language for all player-facing text (${outputLanguage === "zh" ? "Simplified Chinese" : "English"}).`,
      });
    }
  }

  console.warn(`[logicGraphAgent] Falling back to deterministic graph after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`);
  const fallback = buildFallbackLogicGraph(report, storyId);
  validateLogicGraph(fallback);
  return fallback;
}

export { WARNING_RETURN_SENTINEL };
