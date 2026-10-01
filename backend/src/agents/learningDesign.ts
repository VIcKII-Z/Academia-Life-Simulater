import { cohortForLanguage, isLearningStory, MAX_SEVERE_ROUTE_PROBABILITY } from "../../../shared/studyDesign.js";
import type { LogicGraphDocument, StoryDocument } from "../types.js";

/** Keep source ids attached to their own batch when the merged catalog is renumbered. */
export function remapEvidenceIds(ids: string[], original: Array<{ evidence_id?: string; url: string }>, merged: Array<{ evidence_id?: string; url: string }>): string[] {
  return ids.flatMap((id) => {
    const matches = original.filter((source) => source.evidence_id === id);
    if (matches.length !== 1) return [];
    const target = merged.find((source) => source.url === matches[0].url);
    return target?.evidence_id ? [target.evidence_id] : [];
  });
}

/** A distinct learning milestone for every half-year after first-semester orientation. */
export function addStudyMilestones(graph: LogicGraphDocument, semesters: number): void {
  const first = graph.nodes.N06_program_study;
  if (first) first.title = `Study stage 1 of ${semesters}: STEM learning, belonging and academic support`;
  if (graph.pages.N06_program_study && first) graph.pages.N06_program_study.title = first.title;
  let anchor = "N09_disruption_deadline";
  for (let semester = 2; semester <= semesters; semester++) {
    const id = `N_study_stage_${String(semester).padStart(2, "0")}`;
    const title = `Study stage ${semester} of ${semesters}: ${semester === semesters ? "degree completion project and next steps" : semester % 2 === 0 ? "STEM project, feedback and peer collaboration" : "specialization, mentoring and growing independence"}`;
    if (!graph.nodes[id]) {
      graph.nodes[id] = {
        id, title, type: "base_node", stage: "study", is_special: false,
        variables_read: ["school", "wellbeing", "academic_network"],
        variables_written: ["school", "wellbeing", "academic_network"],
        facts_used: ["This half-year story stage is a pacing device, not an official academic calendar. Use only researched program milestones; show a distinct attainable success, relationship development and a support option."],
        variant_triggers: [], options: [],
      };
      graph.pages[id] = { id, role: "node", owner_node_id: id, title, placeholder: title, variant_triggers: [] };
    }
    if (!graph.main_node_order.includes(id)) {
      const index = graph.main_node_order.indexOf(anchor);
      if (index < 0) throw new Error(`Missing timeline anchor ${anchor}`);
      graph.main_node_order.splice(index + 1, 0, id);
    }
    anchor = id;
  }
}

export function learningDesignIssues(doc: StoryDocument, language: "en" | "zh"): string[] {
  if (!isLearningStory(doc)) return [];
  const issues: string[] = [];
  const cohort = cohortForLanguage(language);
  if (doc.protagonist?.id !== cohort.id || doc.protagonist?.homeCountry !== cohort.homeCountry || doc.protagonist?.language !== language || doc.protagonist?.gender !== "woman") issues.push("Protagonist cohort does not match output language.");
  const duration = doc.study_duration;
  if (!duration || duration.semesters !== Math.ceil(duration.months / 6) || duration.semesters !== doc.user_profile.semesters) issues.push("Duration and story profile disagree.");
  const decisions = Object.values(doc.nodes).filter((node) => node.logic_page_role === "node");
  let failureOptions = 0;
  for (const node of decisions) {
    const failures = node.choices.filter((choice) => {
      const target = doc.nodes[choice.next_node] ?? doc.endings[choice.next_node];
      const planned = choice.logic_planned_next_node ? doc.nodes[choice.logic_planned_next_node] ?? doc.endings[choice.logic_planned_next_node] : undefined;
      return target?.failure_recovery || planned?.failure_recovery || target?.logic_page_role === "failure" || planned?.logic_page_role === "failure";
    });
    failureOptions += failures.length;
    if (node.choices.length - failures.length < 2) issues.push("A decision offers fewer than two continuing routes.");
    for (const choice of failures) {
      const target = doc.nodes[choice.next_node] ?? doc.endings[choice.next_node];
      if (!target?.annotation?.evidence_ids.length) issues.push("An explicit severe consequence lacks cited evidence.");
    }
  }
  const choices = decisions.reduce((sum, node) => sum + node.choices.length, 0);
  if (choices && failureOptions / choices > 0.1) issues.push("More than 10% of decision options lead directly to a severe consequence.");
  if (duration) for (let stage = 2; stage <= duration.semesters; stage++) {
    if (!doc.nodes[`N_study_stage_${String(stage).padStart(2, "0")}`]) issues.push(`Missing study stage ${stage}.`);
  }
  const routeAudit = auditLearningRoutes(doc);
  issues.push(...routeAudit.badExamples);
  if (routeAudit.severeProbability > MAX_SEVERE_ROUTE_PROBABILITY) issues.push("Severe-consequence probability exceeds 20% under uniform random choices.");
  return issues;
}

/** Scores never change routes in learning mode. Count paths over the explicit
 * graph with memoization instead of expanding 3^N full state histories. Warning
 * pages are one-time detours returning to exactly the interrupted destination. */
export function auditLearningRoutes(doc: StoryDocument) {
  type Counts = { endings: Record<string, number>; depth: number; severeProbability: number };
  const errors = new Set<string>();
  const memo = new Map<string, Counts>();
  const active = new Set<string>();
  function walk(id: string, planned?: string): Counts {
    const key = JSON.stringify([id, planned]);
    if (active.has(key)) { errors.add(`Route cycle at ${id}`); return { endings: {}, depth: 0, severeProbability: 1 }; }
    const cached = memo.get(key);
    if (cached) return cached;
    const page = doc.nodes[id] ?? doc.endings[id];
    if (doc.endings[id] || page?.failure_recovery || page?.logic_page_role === "failure") return { endings: { [id]: 1 }, depth: 0, severeProbability: page?.failure_recovery || page?.logic_page_role === "failure" ? 1 : 0 };
    const node = doc.nodes[id];
    if (!node?.choices.length) { errors.add(`Missing page or choices at ${id}`); return { endings: {}, depth: 0, severeProbability: 1 }; }
    if (node.logic_page_role === "node" && node.choices.length !== 3) errors.add(`Expected three options at ${id}`);
    active.add(key);
    const result: Counts = { endings: {}, depth: 0, severeProbability: 0 };
    for (const choice of node.choices) {
      let next = choice.next_node;
      let nextPlanned = choice.logic_planned_next_node ?? planned;
      if (next === doc.logic?.result_return_sentinel) {
        if (!planned) { errors.add(`Missing result return at ${id}`); continue; }
        next = planned; nextPlanned = undefined;
      }
      if (next === doc.logic?.warning_return_sentinel) { errors.add(`Warning entered without an interrupt at ${id}`); continue; }
      const child = walk(next, nextPlanned);
      result.severeProbability += child.severeProbability / node.choices.length;
      for (const [ending, count] of Object.entries(child.endings)) result.endings[ending] = (result.endings[ending] ?? 0) + count;
      result.depth = Math.max(result.depth, child.depth + 1);
    }
    active.delete(key);
    memo.set(key, result);
    return result;
  }
  for (const variable of doc.logic?.variables ?? []) {
    const warning = doc.nodes[variable.warning_page_id];
    if (warning?.choices.length !== 1 || warning.choices[0].next_node !== doc.logic?.warning_return_sentinel) errors.add(`Invalid warning return for ${variable.id}`);
  }
  const paths = walk(doc.logic?.start_node_id ?? "");
  const terminalPaths = Object.values(paths.endings).reduce((sum, value) => sum + value, 0);
  const failureEndings = Object.entries(paths.endings).reduce((sum, [id, count]) => {
    const page = doc.nodes[id] ?? doc.endings[id];
    return sum + (page?.failure_recovery || page?.logic_page_role === "failure" ? count : 0);
  }, 0);
  return { terminalPaths, naturalEndings: terminalPaths - failureEndings, failureEndings,
    maxDepth: paths.depth + (doc.logic?.variables.length ?? 0), badCount: errors.size,
    badExamples: [...errors].slice(0, 20), endingCounts: paths.endings, severeProbability: paths.severeProbability };
}
