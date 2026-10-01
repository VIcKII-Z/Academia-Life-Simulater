import { shouldWarn, isLearningStory } from "../../../shared/studyDesign";
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
    if (!Number.isFinite(change) || !(key in vars)) continue;
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
  learning = false,
): StoryLogicRuntimeVariable | null {
  return (
    variables.find((variable) => {
      if (warningsSeen[variable.id]) return false;
      // Learning mode also offers guidance for a direct jump into critical.
      return shouldWarn(previous[variable.id] ?? variable.initial, next[variable.id] ?? variable.initial, false, learning);
    }) ?? null
  );
}

export type ChoiceRiskPreview = {
  nextVars: LogicVars;
  criticalVariables: StoryLogicRuntimeVariable[];
  warningVariables: StoryLogicRuntimeVariable[];
  approachingVariables: StoryLogicRuntimeVariable[];
};

/** Uses the exact same thresholds and ordering as the click runtime, but does
 * not mutate state. The choice card can therefore warn before a click without
 * maintaining a second, subtly different rules engine. */
export function previewLogicDelta(
  current: LogicVars,
  delta: Record<string, number> | undefined,
  variables: StoryLogicRuntimeVariable[],
  warningsSeen: LogicWarningsSeen,
  learning = false,
): ChoiceRiskPreview {
  const nextVars = applyLogicDelta(current, delta);
  const changedDownward = new Set(Object.entries(delta ?? {}).filter(([, change]) => change < 0).map(([id]) => id));
  return {
    nextVars,
    criticalVariables: learning ? [] : variables.filter((variable) => logicBand(nextVars[variable.id] ?? variable.initial) === "critical"),
    warningVariables: variables.filter((variable) => {
      if (warningsSeen[variable.id]) return false;
      return shouldWarn(current[variable.id] ?? variable.initial, nextVars[variable.id] ?? variable.initial, false, learning);
    }),
    approachingVariables: variables.filter((variable) => {
      if (!changedDownward.has(variable.id)) return false;
      const afterValue = nextVars[variable.id] ?? variable.initial;
      const after = logicBand(afterValue);
      return (after === "mid" && afterValue <= 55) || ((after === "bad" || (learning && after === "critical")) && Boolean(warningsSeen[variable.id]));
    }),
  };
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
    // Historical critical-band prose assumes automatic failure. Keep the base
    // scene in learning mode; explicit consequence pages still apply.
    if (isLearningStory(story) && Object.values(variant.conditions).includes("critical")) continue;
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
