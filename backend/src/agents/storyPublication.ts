import { storyLanguageIssues } from "../../../shared/storyLanguage.js";
import type { StoryDocument } from "../types.js";
import { learningDesignIssues } from "./learningDesign.js";

export function assertPublishableStory(doc: StoryDocument, issues: string[], language: "en" | "zh"): void {
  const untranslated = storyLanguageIssues(doc, language);
  const designIssues = learningDesignIssues(doc, language);
  if (issues.length || untranslated.length || designIssues.length) {
    throw new Error(`Story validation failed: ${issues.length + designIssues.length} content/routing/design issue(s), ${untranslated.length} untranslated field(s). See 09_validation_report.json.`);
  }
}
