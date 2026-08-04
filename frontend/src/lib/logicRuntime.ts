import type { EndingNode, StoryDocument, StoryLogicRuntimeVariable, StoryNode } from "../types";

export type LogicVars = Record<string, number>;
export type LogicWarningsSeen = Record<string, boolean>;
export type LogicBand = "good" | "mid" | "bad" | "critical";

export function initLogicVars(story: StoryDocument): LogicVars {
  const vars: LogicVars = {};
  for (const variable of story.logic?.variables ?? []) {
    vars[variable.id] = clampLogicValue(variable.initial);
  }
  return vars;
}

export function clampLogicValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

export function applyLogicDelta(vars: LogicVars, delta?: Record<string, number>): LogicVars {
  if (!delta) return vars;
  const next = { ...vars };
  for (const [key, change] of Object.entries(delta)) {
    next[key] = clampLogicValue((next[key] ?? 70) + change);
  }
  return next;
}

export function logicBand(value: number): LogicBand {
  if (value <= 15) return "critical";
  if (value <= 45) return "bad";
  if (value <= 75) return "mid";
  return "good";
}

export function findCriticalVariable(vars: LogicVars, variables: StoryLogicRuntimeVariable[]): StoryLogicRuntimeVariable | null {
  return variables.find((variable) => logicBand(vars[variable.id] ?? variable.initial) === "critical") ?? null;
}

export function findNewBadVariable(
  previous: LogicVars,
  next: LogicVars,
  variables: StoryLogicRuntimeVariable[],
  warningsSeen: LogicWarningsSeen,
): StoryLogicRuntimeVariable | null {
  return (
    variables.find((variable) => {
      if (warningsSeen[variable.id]) return false;
      const after = logicBand(next[variable.id] ?? variable.initial);
      // Warn every variable that is in the bad band exactly once. This is
      // intentionally not limited to "newly crossed this click": one choice can
      // push multiple variables into bad, and the UI can only show one warning
      // interruption at a time. The next routed choice will catch the remaining
      // bad-but-unwarned variable instead of losing it forever.
      return after === "bad";
    }) ?? null
  );
}

export function applyLogicContentVariant<T extends StoryNode | EndingNode>(
  story: StoryDocument,
  nodeId: string,
  node: T,
  vars: LogicVars,
): T {
  const variants = story.logic_content_variants?.[nodeId];
  if (!variants || variants.length === 0) return node;

  for (const variant of variants) {
    let matches = true;
    for (const [variableId, expectedBand] of Object.entries(variant.conditions)) {
      const definition = story.logic?.variables.find((variable) => variable.id === variableId);
      const value = vars[variableId] ?? definition?.initial ?? 70;
      if (logicBand(value) !== expectedBand) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return {
        ...node,
        scene_text: variant.scene_text || node.scene_text,
        insight: variant.insight || node.insight,
      };
    }
  }

  return node;
}
