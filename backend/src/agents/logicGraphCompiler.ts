import type {
  Choice,
  LogicGraphDocument,
  LogicOption,
  LogicPage,
  OutputLanguage,
  ResearchReport,
  StatBlock,
  StoryDocument,
  StoryNode,
} from "../types.js";
import { WARNING_RETURN_SENTINEL } from "./logicGraphAgent.js";

export const RESULT_RETURN_SENTINEL = "__continue_from_result__";

function pageText(page: LogicPage, fallback: string): string {
  const variantNote =
    page.variant_triggers && page.variant_triggers.length > 0
      ? ` Variable-sensitive text marked for later split: ${page.variant_triggers
          .map((trigger) => `${trigger.variables.join("+")} (${trigger.reason})`)
          .join("; ")}`
      : "";
  return page.text?.trim() || `${page.placeholder || fallback}${variantNote}`;
}

function pageInsight(page: LogicPage, outputLanguage: OutputLanguage): string {
  if (page.insight?.trim()) return page.insight.trim();
  if (page.variant_triggers && page.variant_triggers.length > 0) {
    if (outputLanguage === "zh") {
      return `此页面已标记为变量档位文本变体：${page.variant_triggers
        .map((trigger) => trigger.variables.join("+"))
        .join("，")}。运行时会通过显式 if/else 规则选择对应文案。`;
    }
    return `This page is marked for variable-band variants: ${page.variant_triggers
      .map((trigger) => trigger.variables.join("+"))
      .join(", ")}. Runtime will choose variants through explicit if/else rules once content variants are filled.`;
  }
  if (outputLanguage === "zh") return "此页面属于录取后逻辑图，会通过显式节点 ID 和变量守卫推进。";
  return "This page is part of the post-offer logic graph and routes by explicit node IDs and variable guards.";
}

function visibleStatDelta(option: LogicOption): StatBlock {
  const wellbeing = option.delta.wellbeing ?? 0;
  return {
    money: Math.round(option.delta.money ?? 0),
    school: Math.round(option.delta.school ?? 0),
    health: Math.round((option.delta.housing ?? 0) * 0.25 + wellbeing * 0.6 + (option.delta.time ?? 0) * 0.15),
    mood: Math.round(wellbeing * 0.7 + (option.delta.visa ?? 0) * 0.15 + (option.delta.money ?? 0) * 0.15),
  };
}

function zeroDelta(): StatBlock {
  return { health: 0, mood: 0, money: 0, school: 0 };
}

function toChoice(option: LogicOption): Choice {
  return {
    logic_choice_id: option.id,
    text: `${option.id}: ${option.label}`,
    next_node: option.result_page_id,
    stat_delta: visibleStatDelta(option),
    stat_reason: option.rationale,
    logic_delta: option.delta,
    logic_planned_next_node: option.planned_next_id,
  };
}

function continueChoice(id: string, text: string, nextNode: string, outputLanguage: OutputLanguage): Choice {
  return {
    logic_choice_id: id,
    text: `${id}: ${text}`,
    next_node: nextNode,
    stat_delta: zeroDelta(),
    stat_reason:
      outputLanguage === "zh"
        ? "继续按显式 if/else 路由推进。"
        : "Continue through the explicit if/else route.",
    logic_delta: {},
  };
}

function compileDecisionNode(graph: LogicGraphDocument, page: LogicPage, outputLanguage: OutputLanguage): StoryNode {
  const logicNode = graph.nodes[page.id];
  return {
    type: logicNode?.type || "base_node",
    scene_text: pageText(page, `Decision page for ${page.title}.`),
    image_prompt: null,
    has_image: false,
    choices: (logicNode?.options ?? []).map(toChoice),
    insight: pageInsight(page, outputLanguage),
    logic_page_role: "node",
    logic_source_id: page.id,
  };
}

function compileResultNode(graph: LogicGraphDocument, page: LogicPage, outputLanguage: OutputLanguage): StoryNode {
  const options = Object.values(graph.nodes)
    .flatMap((node) => node.options)
    .filter((option) => option.result_page_id === page.id);
  const label =
    options.length > 1
      ? outputLanguage === "zh"
        ? `继续进入后续路线（共享结果：${options.map((option) => option.id).join(", ")}）`
        : `Continue to the next route (shared result: ${options.map((option) => option.id).join(", ")})`
      : outputLanguage === "zh"
        ? "继续进入后续路线"
        : "Continue to the next route";
  return {
    type: "result",
    scene_text: pageText(page, `Result page for ${page.title}.`),
    image_prompt: null,
    has_image: false,
    choices: [continueChoice("C1_continue", label, RESULT_RETURN_SENTINEL, outputLanguage)],
    insight: pageInsight(page, outputLanguage),
    logic_page_role: "result",
    logic_source_id: page.id,
  };
}

function compileWarningNode(page: LogicPage, outputLanguage: OutputLanguage): StoryNode {
  return {
    type: "warning",
    scene_text: pageText(page, `Warning page for ${page.title}.`),
    image_prompt: null,
    has_image: false,
    choices: [
      continueChoice(
        "C1_warning_return",
        outputLanguage === "zh" ? "知道了，回到刚才被打断的路线" : "Understood, return to the interrupted route",
        WARNING_RETURN_SENTINEL,
        outputLanguage,
      ),
    ],
    insight: pageInsight(page, outputLanguage),
    logic_page_role: "warning",
    logic_source_id: page.id,
  };
}

export function compileLogicGraphToStoryDocument(
  graph: LogicGraphDocument,
  report: ResearchReport,
  storyId: string,
  outputLanguage: OutputLanguage = "en",
): StoryDocument {
  const nodes: StoryDocument["nodes"] = {};

  for (const page of Object.values(graph.pages)) {
    if (page.role === "node") {
      nodes[page.id] = compileDecisionNode(graph, page, outputLanguage);
    } else if (page.role === "result") {
      nodes[page.id] = compileResultNode(graph, page, outputLanguage);
    } else if (page.role === "warning") {
      nodes[page.id] = compileWarningNode(page, outputLanguage);
    }
  }

  const endings: StoryDocument["endings"] = {};
  for (const ending of Object.values(graph.endings)) {
    endings[ending.id] = {
      scene_text: `${ending.title}. ${ending.condition_summary}`,
      image_prompt: null,
      has_image: false,
      tone: ending.tone,
      insight:
        outputLanguage === "zh"
          ? "此结局由图状态、变量和节点 ID 的显式 if/else 条件选择。"
          : "This ending is selected by explicit if/else conditions over graph state, variables, and node IDs.",
      logic_page_role: ending.id.includes("_critical") ? "failure" : "ending",
      logic_source_id: ending.id,
    };
  }

  return {
    story_id: storyId,
    framework_type: "turning_point",
    framework_reason:
      outputLanguage === "zh"
        ? "录取后路线使用变量门控分支图：选择改变变量，变量档位触发警告或失败，页面通过显式 if/else ID 路由。"
        : "Post-offer route uses a variable-gated branch graph: choices change variables, variable bands trigger warnings or failure, and pages route through explicit if/else IDs.",
    user_profile: {
      country: report.profile?.country ?? report.location.country,
      city: report.profile?.city ?? report.location.city,
      major: report.profile?.major ?? report.major,
      grade: graph.degree_track === "undergraduate" ? "Undergraduate" : "Taught Master",
      school: report.profile?.school,
      department: report.profile?.department,
      program: report.profile?.program,
      semesters: 1,
    },
    initial_stats: {
      health: graph.base_variables.find((variable) => variable.id === "wellbeing")?.initial ?? 70,
      mood: graph.base_variables.find((variable) => variable.id === "wellbeing")?.initial ?? 70,
      money: graph.base_variables.find((variable) => variable.id === "money")?.initial ?? 70,
      school: graph.base_variables.find((variable) => variable.id === "school")?.initial ?? 70,
    },
    nodes,
    endings,
    sources: report.sources,
    logic: {
      flow_version: "post_offer_v1",
      start_node_id: graph.main_node_order[0],
      variables: [...graph.base_variables, ...(graph.accepted_supplemental_variables ?? [])].map((variable) => ({
        id: variable.id,
        label: variable.label,
        initial: variable.initial,
        warning_page_id: variable.warning_page_id,
        failure_page_id: variable.failure_page_id,
      })),
      warning_return_sentinel: WARNING_RETURN_SENTINEL,
      result_return_sentinel: RESULT_RETURN_SENTINEL,
    },
  };
}
