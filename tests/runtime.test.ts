import test from "node:test";
import assert from "node:assert/strict";
import { advanceStory, initialPlayState } from "../frontend/src/lib/storyRuntime";
import { applyStatDelta, DEFAULT_STATS } from "../frontend/src/lib/gameplay";
import { applyLogicContentVariant, applyLogicDelta, previewLogicDelta } from "../frontend/src/lib/logicRuntime";
import { storyLanguage, storyLanguageIssues, proseMatchesLanguage } from "../shared/storyLanguage";
import { localizeEntity } from "../frontend/src/lib/entities";
import { assertPublishableStory } from "../backend/src/agents/storyPublication";
import type { StoryDocument as BackendStory } from "../backend/src/types";
import { fullGenerationCachePayload } from "../backend/src/generationCache";
import type { RuntimeConfig } from "../backend/src/types";
import { loadCredentials, saveImageGenerationPreference, loadImageGenerationPreference } from "../frontend/src/lib/storage";
import { buildRuntimeConfig, DEFAULT_MODELS } from "../frontend/src/lib/api";
import type { StoryDocument, Choice, StoryNode } from "../frontend/src/types";
import { inferStudyDuration, resolveStudyDuration, durationLabel, cohortForLanguage, cohortNarrativeRules, LEARNING_POLICY } from "../shared/studyDesign";
import { addStudyMilestones, auditLearningRoutes, learningDesignIssues, remapEvidenceIds } from "../backend/src/agents/learningDesign";
import type { LogicGraphDocument } from "../backend/src/types";

test("degree and destination infer duration, including Scottish undergraduate degrees", () => {
  for (const [country, city, grade, semesters] of [
    ["United States", "Boston", "Undergraduate", 8], ["USA", "Boston", "Taught Master", 4],
    ["United Kingdom", "London", "Undergraduate", 6], ["UK", "Edinburgh", "Undergraduate", 8],
    ["United Kingdom", "London", "Taught Master", 2], ["Germany", "Munich", "Undergraduate", 6],
    ["Germany", "Munich", "Taught Master", 4],
  ] as const) assert.equal(inferStudyDuration({ country, city, grade }).semesters, semesters);
  assert.equal(inferStudyDuration({ country: "Unknown", grade: "Undergraduate" }).basis, "provisional");
});

test("only cited full-time program duration overrides typical duration", () => {
  const profile = { country: "Germany", grade: "Taught Master" };
  const sources = [{ evidence_id: "S02", source_type: "program_official", confidence: "high", url: "https://university.example/program" }];
  const evidence = { months: 18, study_load: "full_time" as const, evidence_ids: ["S02"] };
  assert.equal(resolveStudyDuration(profile, evidence, sources).semesters, 3);
  assert.equal(resolveStudyDuration(profile, evidence, sources).basis, "program");
  assert.equal(resolveStudyDuration(profile, { ...evidence, evidence_ids: ["S99"] }, sources).semesters, 4);
  assert.equal(resolveStudyDuration(profile, { ...evidence, months: NaN }, sources).basis, "typical");
  assert.equal(resolveStudyDuration(profile, evidence, [{ ...sources[0], source_type: "third_party" }]).basis, "typical");
  assert.equal(resolveStudyDuration(profile, { ...evidence, evidence_ids: [] }, sources).basis, "typical");
  assert.doesNotMatch(durationLabel(resolveStudyDuration(profile), "en"), /[\u3400-\u9fff]/);
});

test("program evidence follows URLs across batch-local source id collisions", () => {
  assert.deepEqual(remapEvidenceIds(["S01"], [{ evidence_id: "S01", url: "https://program.example" }], [
    { evidence_id: "S01", url: "https://institution.example" }, { evidence_id: "S07", url: "https://program.example" },
  ]), ["S07"]);
  assert.deepEqual(remapEvidenceIds(["S01"], [{ evidence_id: "S01", url: "a" }, { evidence_id: "S01", url: "b" }], []), []);
});

test("cohort is fixed by language, not the study destination", () => {
  assert.equal(cohortForLanguage("zh").homeCountry, "China");
  assert.equal(cohortForLanguage("en").homeCountry, "Sri Lanka");
  assert.equal(cohortForLanguage("en").homeCurrency, "LKR");
  assert.match(cohortNarrativeRules("en", "Undergraduate"), /Do not infer poverty/);
});

test("learning mode shows guidance at critical and continues without inventing restored resources", () => {
  const doc = fixture(); doc.learning_policy = LEARNING_POLICY;
  doc.nodes.A.choices[0].logic_delta = { money: -70 };
  let state = initialPlayState(doc);
  const preview = previewLogicDelta(state.logicVars, doc.nodes.A.choices[0].logic_delta, doc.logic!.variables, {}, true);
  assert.equal(preview.criticalVariables.length, 0); assert.equal(preview.warningVariables[0].id, "money");
  state = advanceStory(doc, state, doc.nodes.A.choices[0]);
  assert.equal(state.nodeId, "W"); assert.equal(state.logicVars.money, 0);
  state = advanceStory(doc, state, doc.nodes.W.choices[0]);
  state = advanceStory(doc, state, doc.nodes.R.choices[0]);
  state = advanceStory(doc, state, doc.nodes.B.choices[0]);
  assert.equal(state.nodeId, "E"); assert.equal(state.logicVars.money, 0);
});

test("learning mode preserves explicit severe consequences and their retry checkpoints", () => {
  const doc = fixture(); doc.learning_policy = LEARNING_POLICY;
  doc.nodes.A.choices[0].logic_planned_next_node = "F";
  let state = advanceStory(doc, initialPlayState(doc), doc.nodes.A.choices[0]);
  state = advanceStory(doc, state, doc.nodes.W.choices[0]);
  state = advanceStory(doc, state, doc.nodes.R.choices[0]);
  assert.equal(state.nodeId, "F"); assert.equal(state.failureCheckpoint?.nodeId, "A");
});

test("learning mode also prevents legacy stat-only game overs", () => {
  const doc = fixture(); delete doc.logic; doc.learning_policy = LEARNING_POLICY;
  doc.nodes.A.choices[0] = { text: "Explore", next_node: "E", stat_delta: { health: -100, money: -100, school: -100, mood: -100 } };
  const state = advanceStory(doc, initialPlayState(doc), doc.nodes.A.choices[0]);
  assert.equal(state.failedStat, null); assert.equal(state.nodeId, "E");
});

test("automatic semester milestones precede career and are idempotent", () => {
  const graph = { nodes: {}, pages: {}, main_node_order: ["N09_disruption_deadline", "N10_career_internship"] } as unknown as LogicGraphDocument;
  addStudyMilestones(graph, 8); addStudyMilestones(graph, 8);
  assert.equal(Object.keys(graph.nodes).length, 7);
  assert.deepEqual(graph.main_node_order.slice(-2), ["N_study_stage_08", "N10_career_internship"]);
});

test("route auditing counts large branching journeys without expanding each history", () => {
  const doc = fixture(); doc.learning_policy = LEARNING_POLICY;
  doc.nodes = {}; doc.logic!.start_node_id = "D0"; doc.logic!.variables = [];
  for (let index = 0; index < 20; index++) doc.nodes[`D${index}`] = {
    ...page(Array.from({ length: 3 }, (_, option) => ({ text: `Option ${option}`, next_node: index === 19 ? "E" : `D${index + 1}` }))), logic_page_role: "node",
  };
  const result = auditLearningRoutes(doc as BackendStory);
  assert.equal(result.terminalPaths, 3 ** 20); assert.equal(result.badCount, 0);
  doc.nodes.D19.choices[0].next_node = "D0";
  assert.match(auditLearningRoutes(doc as BackendStory).badExamples.join(), /cycle/);
  doc.nodes.D19.choices[0].next_node = "missing";
  assert.match(auditLearningRoutes(doc as BackendStory).badExamples.join(), /Missing/);
});

test("publication design gate rejects mismatched cohorts and missing semester chapters", () => {
  const doc = fixture() as BackendStory; doc.learning_policy = LEARNING_POLICY;
  doc.study_duration = inferStudyDuration({ country: "United States", grade: "Undergraduate" });
  doc.user_profile.semesters = 8; doc.protagonist = cohortForLanguage("en");
  const issues = learningDesignIssues(doc, "zh");
  assert.ok(issues.some((issue) => issue.includes("cohort")));
  assert.ok(issues.some((issue) => issue.includes("stage 8")));
});

test("severe-route probability uses choice weights and counts result-page setbacks", () => {
  const doc = fixture() as BackendStory; doc.learning_policy = LEARNING_POLICY;
  doc.logic!.variables = [];
  doc.nodes.A = { ...page([
    { text: "Complete", next_node: "E" },
    { text: "Other complete route", next_node: "E" },
    { text: "Optional case", next_node: "B" },
  ]), logic_page_role: "node" };
  doc.nodes.B = { ...page([
    { text: "Continue", next_node: "E" },
    { text: "Continue another way", next_node: "E" },
    { text: "Severe case", next_node: "R" },
  ]), logic_page_role: "node" };
  doc.nodes.R.failure_recovery = doc.endings.F.failure_recovery;
  assert.equal(auditLearningRoutes(doc).severeProbability, 1 / 9);
  doc.nodes.A.choices[2].next_node = "R";
  assert.equal(auditLearningRoutes(doc).severeProbability, 1 / 3);
  assert.ok(learningDesignIssues(doc, "en").some((issue) => issue.includes("20%")));
});

test("learning mode does not show cached critical variants that assume automatic failure", () => {
  const doc = fixture(); doc.learning_policy = LEARNING_POLICY;
  doc.logic_content_variants = { A: [{ variant_id: "old", conditions: { money: "critical" }, scene_text: "The journey is over." }] };
  assert.equal(applyLogicContentVariant(doc, "A", doc.nodes.A, { money: 0 }).scene_text, "A scene.");
});

const page = (choices: Choice[] = []): StoryNode => ({ type: "base", scene_text: "A scene.", image_prompt: null, has_image: false, choices });
function fixture(): StoryDocument {
  return {
    story_id: "test", framework_type: "turning_point", framework_reason: "Test",
    user_profile: { country: "Japan", city: "Tokyo", grade: "Graduate", major: "Computing" },
    nodes: {
      A: page([{ text: "Borrow time: pay for support", next_node: "R", logic_delta: { money: -30 }, logic_planned_next_node: "B" }]),
      R: page([{ text: "Continue", next_node: "__continue_from_result__", logic_delta: { money: -30 } }]),
      W: page([{ text: "Understood", next_node: "__return_from_warning__", logic_delta: { money: -30 } }]),
      B: page([{ text: "Finish", next_node: "E", logic_delta: { money: -30 } }]),
    },
    endings: {
      E: { scene_text: "Done.", tone: "hopeful", image_prompt: null, has_image: false },
      F: { scene_text: "Out of funds.", tone: "challenging", image_prompt: null, has_image: false, failure_recovery: { title: "Rewind", scene_text: "Back to {previous_node}", return_choice_text: "Retry" } },
    },
    logic: { flow_version: "post_offer_v1", start_node_id: "A", variables: [{ id: "money", label: "Funds", initial: 70, warning_page_id: "W", failure_page_id: "F" }], warning_return_sentinel: "__return_from_warning__", result_return_sentinel: "__continue_from_result__" },
  };
}

test("warning -> result -> planned destination preserves state and charges only once", () => {
  const doc = fixture();
  let state = advanceStory(doc, initialPlayState(doc), doc.nodes.A.choices[0]);
  assert.equal(state.nodeId, "W"); assert.equal(state.logicVars.money, 40);
  state = advanceStory(doc, state, doc.nodes.W.choices[0]);
  assert.equal(state.nodeId, "R"); assert.equal(state.logicVars.money, 40);
  state = advanceStory(doc, state, doc.nodes.R.choices[0]);
  assert.equal(state.nodeId, "B"); assert.equal(state.logicVars.money, 40);
  assert.equal(state.resultReturnNodeId, null);
});
test("critical failure wins over ending and its checkpoint permits a different decision", () => {
  const doc = fixture();
  doc.nodes.A.choices[0].logic_delta = { money: -60 };
  const before = initialPlayState(doc);
  const failed = advanceStory(doc, before, doc.nodes.A.choices[0]);
  assert.equal(failed.nodeId, "F");
  assert.equal(failed.failureCheckpoint?.logicVars.money, 70);
  assert.equal(failed.failureCheckpoint?.nodeId, "A");
  assert.equal(failed.failureCheckpoint?.resultReturnNodeId, null);
  assert.deepEqual(before.logicVars, { money: 70 });
});
test("recoverable failure after warning and result preserves the original decision checkpoint", () => {
  const doc = fixture();
  doc.nodes.A.choices[0].logic_planned_next_node = "F";
  let state = advanceStory(doc, initialPlayState(doc), doc.nodes.A.choices[0]);
  state = advanceStory(doc, state, doc.nodes.W.choices[0]);
  state = advanceStory(doc, state, doc.nodes.R.choices[0]);
  assert.equal(state.nodeId, "F"); assert.equal(state.failureCheckpoint?.nodeId, "A");
  assert.equal(state.failureCheckpoint?.logicVars.money, 70);
});
test("legacy stat exhaustion prevents taking an otherwise hopeful ending", () => {
  const doc = fixture(); delete doc.logic;
  doc.nodes.A.choices[0] = { text: "Spend everything", next_node: "E", stat_delta: { health: 0, mood: 0, money: -100, school: 0 } };
  const state = advanceStory(doc, initialPlayState(doc), doc.nodes.A.choices[0]);
  assert.equal(state.failedStat, "money"); assert.equal(state.stats.money, 0); assert.equal(state.nodeId, "A");
});
test("missing return destination fails explicitly instead of silently restarting", () => {
  const doc = fixture(); const state = { ...initialPlayState(doc), nodeId: "R" };
  assert.throws(() => advanceStory(doc, state, doc.nodes.R.choices[0]), /destination/);
});
test("a stale choice cannot apply a second delta on the next page", () => {
  const doc = fixture(); const choice = doc.nodes.A.choices[0];
  const state = advanceStory(doc, initialPlayState(doc), choice);
  assert.equal(advanceStory(doc, state, choice), state);
});
test("risk preview agrees with runtime at warning and critical boundaries", () => {
  for (const loss of [-24, -25, -54, -55]) {
    const doc = fixture(); doc.nodes.A.choices[0].logic_delta = { money: loss };
    const state = initialPlayState(doc);
    const preview = previewLogicDelta(state.logicVars, { money: loss }, doc.logic!.variables, {});
    const next = advanceStory(doc, state, doc.nodes.A.choices[0]);
    assert.equal(next.nodeId === "F", preview.criticalVariables.length > 0);
    assert.equal(next.nodeId === "W", preview.warningVariables.length > 0);
  }
});
test("invalid numerical data cannot poison stats or invent runtime variables", () => {
  assert.deepEqual(applyLogicDelta({ money: 70 }, { money: NaN, fake: -100 }), { money: 70 });
  assert.equal(applyStatDelta({ ...DEFAULT_STATS, school: NaN }).school, 70);
});
test("matching variants keep routing and choices unchanged", () => {
  const doc = fixture(); doc.logic_content_variants = { A: [{ variant_id: "low", conditions: { money: "bad" }, scene_text: "Funds are low." }] };
  const rendered = applyLogicContentVariant(doc, "A", doc.nodes.A, { money: 40 });
  assert.equal(rendered.scene_text, "Funds are low."); assert.equal(rendered.choices, doc.nodes.A.choices);
});
test("language checks inspect nested choices, variants and explanations, not just metadata", () => {
  const doc = fixture(); assert.deepEqual(storyLanguageIssues(doc, "en"), []);
  doc.nodes.A.choices[0].text = "支付费用";
  assert.ok(storyLanguageIssues(doc, "en").includes("nodes.A.choices.0.text"));
  doc.full_generation = { output_language: "zh" };
  assert.ok(storyLanguageIssues(doc).length > 0);
  assert.equal(proseMatchesLanguage("你走进 NUS 图书馆。", "zh"), true);
  assert.equal(proseMatchesLanguage("The deadline passed.", "zh"), false);
  assert.equal(proseMatchesLanguage("Money collapse. 资金不足。", "zh"), false);
});
test("legacy language detection uses prose when metadata is missing", () => {
  assert.equal(storyLanguage({ nodes: { A: { scene_text: "开始故事。" } } }), "zh");
  assert.equal(storyLanguage(fixture()), "en");
});
test("localized entity display retains canonical lookup identity", () => {
  assert.equal(localizeEntity("Japan", "zh"), "日本");
  assert.equal(localizeEntity("University of Tokyo", "zh"), "东京大学");
  assert.equal(localizeEntity("Japan", "en"), "Japan");
});

test("publication rejects structural errors even when the language is valid", () => {
  assert.throws(() => assertPublishableStory(fixture() as BackendStory, ["Missing ending"], "en"), /validation failed/);
  assert.doesNotThrow(() => assertPublishableStory(fixture() as BackendStory, [], "en"));
});

test("publication rejects a mixed-language result with otherwise valid routing", () => {
  const doc = fixture(); doc.nodes.R.scene_text = "选择已生效。";
  assert.throws(() => assertPublishableStory(doc as BackendStory, [], "en"), /untranslated/);
});

test("cache distinguishes actual text model and live research but excludes keys", () => {
  const runtime: RuntimeConfig = { provider: "openai", apiKey: "test-only", models: { search: "search", design: "text", image: "image" }, features: { enableLiveSearch: true, enableImageGeneration: false, maxImagesPerStory: 0 } };
  const payload = fullGenerationCachePayload(undefined, runtime, "model-a", "test");
  assert.notDeepEqual(payload, fullGenerationCachePayload(undefined, runtime, "model-b", "test"));
  assert.notDeepEqual(payload, fullGenerationCachePayload(undefined, { ...runtime, features: { ...runtime.features, enableLiveSearch: false } }, "model-a", "test"));
  assert.deepEqual(payload, fullGenerationCachePayload(undefined, { ...runtime, apiKey: "another-test-key" }, "model-a", "test"));
});

test("blocked browser storage does not prevent startup or session preferences", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
  try {
    assert.equal(loadCredentials().provider, "relay");
    saveImageGenerationPreference(false);
    assert.equal(loadImageGenerationPreference(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as unknown as Record<string, unknown>).localStorage;
  }
});

test("official provider does not receive the relay-only default text model", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => key === "fls.provider" ? "openai" : null } });
  try {
    const runtime = buildRuntimeConfig();
    assert.equal(runtime.services?.text?.provider, "openai");
    assert.equal(runtime.services?.text?.model, DEFAULT_MODELS.search);
    assert.equal(buildRuntimeConfig({ design: "explicit-choice" }).services?.text?.model, "explicit-choice");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as unknown as Record<string, unknown>).localStorage;
  }
});
