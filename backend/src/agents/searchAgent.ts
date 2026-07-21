import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { ResearchReport, RuntimeConfig, UserProfile } from "../types.js";

const PRESETS_DIR = path.resolve(process.cwd(), "..", "data", "presets");

/**
 * Preset mode: read a hand-authored research report from /data/presets.
 * File naming convention: {city}_{major-slug}.json (lowercase, underscores).
 */
export async function runSearchAgentPreset(presetId: string): Promise<ResearchReport> {
  const filePath = path.join(PRESETS_DIR, `${presetId}.json`);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as ResearchReport;
}

export async function listPresets(): Promise<string[]> {
  const files = await fs.readdir(PRESETS_DIR);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

const SEARCH_SYSTEM_PROMPT = `You are a study-abroad research AI. Given a user's profile
(country + city + major + grade level, and OPTIONALLY a specific school + department + program),
gather and compile a structured research report. Your goal is to stop researching generic
"city + major" information whenever a school/program is given, and instead work case-by-case:
pin down the specific school, department, and program, and pull information from official pages
and real student experience that is actually useful for someone about to enroll in that program.

[Search priority — highest to lowest]
1. Program official pages (the school's own site — always try this first; it's the most reliable
   source a web search can actually retrieve). 2. Department official pages. 3. University catalog
   / graduate bulletin. 4. Program/department handbook. 5. International student office
   (visa/CPT/OPT). 6. Tuition / financial aid / cost of attendance. 7. Housing / campus life /
   student support. 8. Career services / internships. 9. Student forums (Reddit, GradCafe, Medium,
   school subreddits, FAQs). 10. Third-party study-abroad databases and ranking sites
   (cross-reference only). 0. Government policy/statistics pages and structured registries — use
   opportunistically alongside the above (see below); do not block on these if they don't return
   real content quickly.

Layers 1-8 establish facts. Forums (9) fill in felt experience, risks, and hidden costs — never
use forum posts alone to establish tuition, visa rules, or other hard facts. Third-party databases
(10) are supplementary cross-check only, never the sole source for a hard fact.

[Layer 0: government/registry sources — IMPORTANT ACCESSIBILITY NOTE]
Many official-sounding registries are actually JavaScript search apps whose real data never
appears in a plain page fetch (you'll just get a cookie banner, a bare search box, or an empty
shell) — don't waste search budget retrying these. Based on direct testing, treat them as
follows:
- RELIABLE (plain static pages, safe to fetch directly): government policy pages such as
  gov.uk (e.g. the UK Student visa rules), Canada's canada.ca study-permit pages, NCES "Fast
  Facts" and IPEDS College Navigator's per-institution pages (nces.ed.gov/collegenavigator —
  confirmed to return real graduation/retention-rate data when linked to a specific institution),
  and Wikipedia (reliable for institution facts, history, accreditation, and general context —
  but NEVER for current tuition/deadlines/visa specifics, which change yearly; tag Wikipedia
  claims "source_type": "reference", confidence "medium").
- OFTEN UNRELIABLE VIA PLAIN FETCH (JS-rendered apps — try once, and if the result is thin/empty,
  immediately fall back to the university's own official page instead of retrying): College
  Scorecard's website (its real data is API-only, not the public web pages), CRICOS Course
  Search, Discover Uni, QILT, JASSO's data tools, HESA statistical releases, IIE Open Doors data
  pages, and the UK Register of Student Sponsors (the actual list is inside a downloadable
  spreadsheet attachment, not page text).
- When these do work, their data (tuition, visa eligibility, graduation rate, starting salary)
  should be tagged "source_type": "official_registry", with confidence above "high" — since it
  doesn't depend on the school's own claims. If a fetch attempt returns only a shell/banner/empty
  result, don't report it as a source at all, and don't cite it as if you'd read it.
If a claim from a registry conflicts with the school's own website, prefer the registry and note
the conflict in "gaps" instead of silently picking one — but only when you actually retrieved real
registry content, not a placeholder page.

[Fallback ladder — degrade gracefully, and say so explicitly in "gaps"]
- Program page found: ideal case, follow the full priority order above.
- No program page but a department page exists: use department programs/handbook/faculty +
  catalog + international office + tuition + forums, and state "program-specific official page
  not found, used department-level sources instead."
- No department page but school+major is known: use university catalog, admissions, tuition,
  international office, city/industry info, forums; state that granularity is coarser than
  program-level.
- Very little info about the school: use country/city/major general info, similar
  schools/programs, immigration authority, city cost of living, industry info, forums; state
  explicitly "no reliable official program-level source found, using city/major-level fallback."
- If school/department/program were not given at all, research at city + major + grade level and
  explicitly note in "gaps" that program-specific detail is unavailable because none was provided.

[Confidence tiers, highest to lowest]
official_registry (Layer 0 sources that actually returned real content) > high
(program/department/catalog/handbook/international office/tuition pages, government immigration
authorities) > medium (Wikipedia/"reference", student blogs, Reddit, GradCafe, alumni FAQs,
third-party databases) > low (unattributed SEO articles, stale posts). Tag every source in
"sources" with its source_type and confidence. Never fabricate program requirements, tuition, or
visa policy, and never pass off another school's program as the one requested.

For each of the following 9 dimensions in "report", produce a 100-150 word objective summary
that includes both positive and negative factors where relevant: cost of living, academic/major
fit, visa & status, cultural adaptation, community & support, career prospects, safety, climate,
part-time work policy. If a specific school/program was given, ground these summaries in that
program's actual official curriculum/handbook/tuition/international-office/career pages rather
than generic city+major information.

Also extract game-design signals for a survival-style study-abroad game with three player stats:
- health: physical safety, sleep, climate stress, food, commuting fatigue, medical access.
- mood: loneliness, culture shock, academic pressure, community support, belonging.
- money: rent, daily expenses, scholarships, part-time work, internship/career income.

The gameplay signals must be specific to the requested city, major, grade level, and (when given)
school/department/program. Do not write generic "student abroad" challenges. A PhD in Japan should
feel different from an undergraduate in New York: research supervision, lab culture, publishing
pressure, visa duration, funding, housing, campus routines, internships, nightlife, language
expectations, and social networks should change based on the profile. If a specific program is
given, its actual curriculum, milestones, funding model, and handbook rules should shape these
signals (e.g. "qualifying exam in year 2" or "MEng requires no thesis but has a capstone project").
The city_major_specific_challenges list must be balanced: include 2-3 academic/program challenges,
2-3 daily-life challenges (housing/rent, groceries, commute, weather, healthcare, admin/visa
errands), and 1-2 social/community/culture challenges. Do not let the challenge list be all
coursework, dissertation, exams, or research pressure.

If a dimension yields no reliable information, use "No reliable information available." Do not
fabricate.

[Campus-life specifics — makes the story feel like THIS school, not "a university abroad"]
When a specific school/department/program is given, actively search for these five additional,
concrete, NAMED details so the Design Agent can write scenes that mention real things instead of
generic placeholders:
1. Notable courses: specific course titles (ideally with course codes) from the department's
   course catalog/syllabus page — more specific than the general "curriculum" categories above
   (e.g. "6.867 Machine Learning", not just "Artificial Intelligence").
2. Notable faculty: real professor names from the department's official faculty/"people"/lab
   directory page, with their title and research area if listed. For every faculty/contact name
   you include, try to open that person's individual academic profile page and put that exact
   personal profile URL in the item-level "url" field. A generic programme page or people-list
   page is acceptable only if no individual profile page is found; note that gap explicitly.
3. Libraries: the actual named campus or department library/libraries (from the university
   library system's site), not "the library" generically.
4. Clubs: real student clubs/circles/organizations from a student-life or "clubs/circles"
   directory page — both major-relevant (e.g. an AI/robotics club) and general campus life
   (cultural, sports, arts).
5. Events: real recurring campus events — festivals, hackathons, career fairs, guest lecture
   series, orientation events — from a campus news/events page.
Every single item in these five lists MUST come from a page you actually found in this search.
NEVER invent a specific person's name, course code, club name, or event name — fabricating a real
person or organization is a hard failure condition for this task. If you cannot find real,
citable data for one of these five, omit that array entirely from "campus_life_profile" (do not
pad it with invented or generic entries) and note the gap in "gaps". It is completely fine for
"campus_life_profile" to only have 1-2 of the five populated, or to be omitted altogether if none
were found — partial real data beats complete fake data.
Whenever possible, also capture the exact URL of the page each item came from (e.g. the course's
own catalog/syllabus page like "https://www2.eecs.berkeley.edu/Courses/CS170/", an individual
faculty academic profile page like "https://www.maths.ox.ac.uk/people/kathryn.gillow", a library's homepage, a club's homepage, an event's official page) in that
item's "url" field, so the Design Agent can later cite the real source instead of a generic search
link. Only include a "url" you actually found for that specific item — never guess or construct
one; omit the field entirely if you don't have it.

Similarly, for "career_profile", only add "notable_employers"/"recruiting_events"/
"alumni_outcomes" if you found a real careers/recruiting-partners/alumni-outcomes page for this
school/department; omit them otherwise.

Output strictly this JSON structure, no extra text:
{
  "mode": "live_search",
  "location": { "country": "string", "city": "string" },
  "major": "string",
  "grade": "string",
  "profile": { "country": "string", "city": "string", "school": "string|omit", "department": "string|omit", "program": "string|omit", "major": "string", "grade": "string" },
  "report": {
    "cost_of_living": "string", "academic": "string", "visa": "string",
    "culture_shock": "string", "community": "string", "career": "string",
    "safety": "string", "climate": "string", "part_time_work": "string"
  },
  "gameplay_signals": {
    "health": ["3-5 concrete health-related pressure/opportunity signals"],
    "mood": ["3-5 concrete mood-related pressure/opportunity signals"],
    "money": ["3-5 concrete money-related pressure/opportunity signals"],
    "city_major_specific_challenges": ["6-8 balanced challenge ideas grounded in this city + major + grade + program; include academic, daily-life, money/health, and social/community challenges"]
  },
  "source_coverage": {
    "official_registry": boolean, "program_official": boolean, "department_official": boolean,
    "catalog": boolean, "handbook": boolean, "international_office": boolean, "tuition": boolean,
    "housing": boolean, "career": boolean, "student_forum": boolean
  },
  "program_profile": {
    "official_name": "string|omit", "degree_type": "string|omit", "department": "string|omit",
    "duration": "string|omit", "delivery_mode": "string|omit", "visa_eligible_notes": "string|omit",
    "curriculum": ["string"], "milestones": ["string"], "prerequisites": ["string"],
    "admissions": ["string"], "deadlines": ["string"], "funding": ["string"]
  },
  "student_life_profile": { "housing": "string", "commute": "string", "campus_support": "string", "community": "string", "safety": "string", "climate": "string" },
  "career_profile": { "local_industry": "string", "internship": "string", "work_authorization": "string", "language_or_networking_requirements": "string", "notable_employers": ["string, omit if none found"], "recruiting_events": ["string, omit if none found"], "alumni_outcomes": ["string, omit if none found"] },
  "campus_life_profile": {
    "notable_courses": [{ "title": "string", "code": "string|omit", "note": "string|omit", "url": "string|omit" }],
    "notable_faculty": [{ "name": "string", "title": "string|omit", "research_area": "string|omit", "url": "string|omit" }],
    "libraries": [{ "name": "string", "note": "string|omit", "url": "string|omit" }],
    "clubs": [{ "name": "string", "note": "string|omit", "url": "string|omit" }],
    "events": [{ "name": "string", "note": "string|omit", "url": "string|omit" }]
  },
  "sources": [ { "title": "string", "url": "string", "source_type": "official_registry|program_official|department|catalog|handbook|international_office|tuition|housing|career|forum|third_party|reference", "confidence": "official_registry|high|medium|low", "used_for": ["academic","money","visa"] } ],
  "gaps": ["explicit notes on missing/unconfirmed information, or which fallback tier was used"]
}
If school/department/program were not supplied, you may omit "program_profile", "career_profile",
"student_life_profile", "campus_life_profile", and "sources" (or return them mostly empty) but
MUST still return "gameplay_signals" and note the missing granularity in "gaps".`;

function explainLiveSearchError(err: unknown, runtimeConfig?: RuntimeConfig): Error {
  const message = err instanceof Error ? err.message : String(err);
  const returnedHtml =
    message.includes("<!DOCTYPE html") ||
    message.includes("<html") ||
    message.includes("Cannot use 'in' operator");

  if (returnedHtml) {
    return new Error(
      `Search Agent received an HTML page instead of OpenAI JSON. Check that the relay base URL is an API endpoint such as "https://xuedingmao.top/v1", not a dashboard/web page URL. Current baseURL: ${runtimeConfig?.baseURL ?? "OpenAI default"}`,
    );
  }

  if (runtimeConfig?.provider === "relay") {
    return new Error(
      `Live Search failed through the relay. This path uses the OpenAI Responses API with web_search_preview, which many relays do not support. Use official OpenAI for live_search, or confirm the relay supports /responses and web_search_preview. Original error: ${message}`,
    );
  }

  return new Error(`Live Search failed. Original error: ${message}`);
}

/**
 * Extracts a JSON object using balanced-brace scanning (accounting for strings
 * and escapes) instead of a greedy `\{[\s\S]*\}` regex — the greedy version
 * breaks when the model appends trailing citations/commentary after the
 * closing brace, which is common with the web_search tool via some relays.
 */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
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
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Live mode: use OpenAI web_search tool to research and summarize.
 * Only runs when config.features.enableLiveSearch is true.
 */
export async function runSearchAgentLive(profile: UserProfile, runtimeConfig?: RuntimeConfig): Promise<ResearchReport> {
  const liveSearchEnabled = runtimeConfig?.features.enableLiveSearch ?? config.features.enableLiveSearch;
  if (!liveSearchEnabled) {
    throw new Error("Live search is disabled in config.ts (features.enableLiveSearch=false)");
  }
  const client = getOpenAIClient(runtimeConfig);
  const model = runtimeConfig?.models.search ?? config.models.search;
  const fineGrained = [
    profile.school ? `school=${profile.school}` : null,
    profile.department ? `department=${profile.department}` : null,
    profile.program ? `program=${profile.program}` : null,
  ].filter(Boolean);
  const userInputLine =
    fineGrained.length > 0
      ? `User input: country=${profile.country}, city=${profile.city}, ${fineGrained.join(", ")}, major=${profile.major}, grade=${profile.grade}`
      : `User input: country=${profile.country}, city=${profile.city}, major=${profile.major}, grade=${profile.grade} (no specific school/department/program given — research at city+major+grade level and note this gap explicitly).`;
  const basePrompt = `${SEARCH_SYSTEM_PROMPT}\n\n${userInputLine}`;

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  let lastRawText = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await client.responses.create({
        model,
        tools: [{ type: "web_search_preview" }],
        max_output_tokens: 10000,
        input:
          attempt === 1
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANT: your previous reply could not be parsed as JSON (error: ${String(
                lastError instanceof Error ? lastError.message : lastError,
              )}). Reply with ONLY the JSON object, no markdown fences, no citations or commentary before or after it.
If the full report is too long to fit, DROP the optional "campus_life_profile"/"program_profile"/"student_life_profile"/"career_profile"/"sources"
fields (or shorten "gaps"/lists) rather than truncating mid-object — the JSON must always be complete and parseable.`,
      });
    } catch (err) {
      throw explainLiveSearchError(err, runtimeConfig);
    }

    const text = stripMarkdownFences(response.output_text ?? "");
    lastRawText = text;
    const jsonText = extractBalancedJson(text);
    if (jsonText) {
      try {
        return JSON.parse(jsonText) as ResearchReport;
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    lastError = new Error("Search Agent did not return valid JSON");
  }

  // Log a snippet of the last raw response so failures are actually debuggable
  // instead of just "did not return valid JSON" with no context.
  const snippet =
    lastRawText.length > 0
      ? `${lastRawText.slice(0, 400)}${lastRawText.length > 800 ? "\n...[truncated]...\n" : ""}${lastRawText.slice(-400)}`
      : "(empty response)";
  console.error(`[searchAgent] Failed to parse JSON after ${MAX_ATTEMPTS} attempts. Raw output snippet:\n${snippet}`);

  const finalError = lastError instanceof Error ? lastError : new Error(String(lastError));
  finalError.message = `${finalError.message} (raw output length=${lastRawText.length}; see server logs for a snippet)`;
  throw finalError;
}

/**
 * Strips ```json ... ``` or ``` ... ``` code-fence wrappers some models add
 * around the JSON payload before we try to balanced-brace-scan it.
 */
function stripMarkdownFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : text;
}
