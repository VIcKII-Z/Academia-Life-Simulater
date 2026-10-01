export type StoryLanguage = "en" | "zh";
type ProsePage = {
  scene_text?: string;
  insight?: string;
  choices?: Array<{ text?: string }>;
  annotation?: { terms?: Array<{ explanation?: string; importance_reason?: string }> };
  failure_recovery?: { title?: string; scene_text?: string; return_choice_text?: string };
};
type LanguageDocument = {
  full_generation?: { output_language?: string };
  nodes?: Record<string, ProsePage>;
  endings?: Record<string, ProsePage>;
  logic_content_variants?: Record<string, Array<{ scene_text?: string; insight?: string }>>;
  glossary_terms?: Array<{ explanation?: string; importance_reason?: string }>;
  reference_profiles?: { institution?: object; program?: object };
};

// Official names, identifiers, source titles and URLs are intentionally not prose.
export function proseMatchesLanguage(text: string, language: StoryLanguage): boolean {
  if (!text.trim()) return true;
  const hasHan = /\p{Script=Han}/u.test(text);
  const englishSentence = /\b[A-Za-z][A-Za-z'’]*(?:[ ,\-]+[A-Za-z][A-Za-z'’]*)+[.!?](?:\s|$|\p{Script=Han})/u.test(text);
  return language === "zh" ? hasHan && !englishSentence : !hasHan;
}

export function storyLanguage(doc: LanguageDocument): StoryLanguage {
  const declared = doc.full_generation?.output_language;
  if (declared === "zh" || declared === "en") return declared;
  const pages = [...Object.values(doc.nodes ?? {}), ...Object.values(doc.endings ?? {})];
  return pages.filter((page) => /\p{Script=Han}/u.test(page.scene_text ?? "")).length > pages.length / 2 ? "zh" : "en";
}

/** Reject untranslated fallbacks before serving or publishing a completed story. */
export function storyLanguageIssues(doc: LanguageDocument, language = storyLanguage(doc)): string[] {
  return storyProseFields(doc).filter(({ text }) => !proseMatchesLanguage(text, language)).map(({ path }) => path.join("."));
}

/** Stable paths let the generator repair only prose without touching routing or facts. */
export function storyProseFields(doc: LanguageDocument): Array<{ path: string[]; text: string }> {
  const fields: Array<{ path: string[]; text: string }> = [];
  const add = (path: string[], text?: unknown) => { if (typeof text === "string" && text.trim()) fields.push({ path, text }); };
  for (const kind of ["nodes", "endings"] as const) for (const [id, page] of Object.entries(doc[kind] ?? {})) {
    const base = [kind, id];
    add([...base, "scene_text"], page.scene_text);
    add([...base, "insight"], page.insight);
    page.choices?.forEach((choice, i) => add([...base, "choices", String(i), "text"], choice.text));
    page.annotation?.terms?.forEach((term, i) => {
      for (const key of ["explanation", "importance_reason"] as const) add([...base, "annotation", "terms", String(i), key], term[key]);
    });
    for (const [key, text] of Object.entries(page.failure_recovery ?? {})) add([...base, "failure_recovery", key], text);
  }
  for (const [id, variants] of Object.entries(doc.logic_content_variants ?? {})) variants.forEach((variant, i) => {
    for (const key of ["scene_text", "insight"] as const) add(["logic_content_variants", id, String(i), key], variant[key]);
  });
  doc.glossary_terms?.forEach((term, i) => {
    for (const key of ["explanation", "importance_reason"] as const) add(["glossary_terms", String(i), key], term[key]);
  });
  for (const kind of ["institution", "program"] as const) {
    const profile = doc.reference_profiles?.[kind] as Record<string, unknown> | undefined;
    const keys = kind === "institution" ? ["institution_type"] : ["duration", "credits", "delivery_mode", "prerequisites", "admissions", "deadlines", "funding", "milestones"];
    for (const key of keys) {
      const value = profile?.[key];
      if (Array.isArray(value)) value.forEach((text, i) => add(["reference_profiles", kind, key, String(i)], text));
      else add(["reference_profiles", kind, key], value);
    }
  }
  return fields;
}
