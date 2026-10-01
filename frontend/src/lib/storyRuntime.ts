import { isLearningStory } from "../../../shared/studyDesign";
import type { Choice, StatBlock, StoryDocument } from "../types";
import { applyStatDelta, DEFAULT_STATS, getFailedStat } from "./gameplay";
import { applyLogicDelta, findCriticalVariable, findNewBadVariable, initLogicVars, type LogicVars, type LogicWarningsSeen } from "./logicRuntime";

export interface Checkpoint {
  nodeId: string;
  logicVars: LogicVars;
  logicWarningsSeen: LogicWarningsSeen;
  warningReturnNodeId: string | null;
  resultReturnNodeId: string | null;
  stats: StatBlock;
}

export interface PlayState extends Checkpoint {
  failureCheckpoint: Checkpoint | null;
  failedStat: keyof StatBlock | null;
}

export function initialPlayState(story: StoryDocument): PlayState {
  const nodeId = story.logic?.start_node_id ?? Object.keys(story.nodes)[0];
  if (!nodeId || !story.nodes[nodeId]) throw new Error("Missing story start node");
  return {
    nodeId, logicVars: initLogicVars(story), logicWarningsSeen: {},
    warningReturnNodeId: null, resultReturnNodeId: null,
    stats: applyStatDelta(story.initial_stats ?? DEFAULT_STATS),
    failureCheckpoint: null, failedStat: null,
  };
}

/** One transition per decision. Interstitial return buttons never reapply deltas. */
export function advanceStory(story: StoryDocument, state: PlayState, choice: Choice): PlayState {
  const current = story.nodes[state.nodeId];
  if (!current?.choices.includes(choice) || state.failedStat) return state;
  const next = { ...state };
  const go = (id: string | null): PlayState => {
    if (!id || !(story.nodes[id] ?? story.endings[id])) throw new Error("Missing story destination");
    return { ...next, nodeId: id };
  };
  if (story.logic && choice.next_node === story.logic.warning_return_sentinel) {
    next.warningReturnNodeId = null;
    return go(state.warningReturnNodeId);
  }
  if (story.logic && choice.next_node === story.logic.result_return_sentinel) {
    next.resultReturnNodeId = null;
    return go(state.resultReturnNodeId);
  }
  next.stats = applyStatDelta(state.stats, choice.stat_delta);
  if (!story.logic) {
    next.failedStat = isLearningStory(story) ? null : getFailedStat(next.stats);
    return next.failedStat ? next : go(choice.next_node);
  }
  // Snapshot before the decision, including all pending return destinations.
  const { failureCheckpoint: _old, failedStat: _failed, ...checkpoint } = state;
  const target = story.nodes[choice.next_node] ?? story.endings[choice.next_node];
  const planned = choice.logic_planned_next_node
    ? story.nodes[choice.logic_planned_next_node] ?? story.endings[choice.logic_planned_next_node]
    : undefined;
  next.failureCheckpoint = target?.failure_recovery || planned?.failure_recovery ? checkpoint : null;
  next.resultReturnNodeId = choice.logic_planned_next_node ?? state.resultReturnNodeId;
  next.logicVars = applyLogicDelta(state.logicVars, choice.logic_delta);
  const critical = findCriticalVariable(next.logicVars, story.logic.variables);
  if (critical && !isLearningStory(story)) {
    next.failureCheckpoint = checkpoint;
    return go(critical.failure_page_id);
  }
  const warning = findNewBadVariable(state.logicVars, next.logicVars, story.logic.variables, state.logicWarningsSeen, isLearningStory(story));
  if (warning) {
    next.logicWarningsSeen = { ...state.logicWarningsSeen, [warning.id]: true };
    next.warningReturnNodeId = choice.next_node;
    return go(warning.warning_page_id);
  }
  return go(choice.next_node);
}
