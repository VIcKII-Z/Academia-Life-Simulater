import { useEffect, useState } from "react";
import type { UserProfile } from "../types";
import {
  findExactUniversity,
  getCitiesForCountry,
  getCountries,
  getUniversitiesForCity,
  searchUniversitiesScoped,
  type UniversityEntry,
} from "../data/universities";
import { searchUniversitiesLive } from "../lib/api";

/**
 * Multi-layer search: country -> city -> university -> degree level ->
 * major -> (optional) department/program. Rather than paginating — each
 * question replacing the previous one full-screen — every answered layer
 * collapses into a compact summary row and stays visible while the next
 * layer pops in right below it. The whole chain builds up on one
 * continuously growing card and is finalized together at the very end
 * (see search_agent_strategy.md's Phase 0 school/department/program
 * targeting for why school-level detail matters).
 */
type StepKey = "country" | "city" | "university" | "degree" | "semesters" | "details";
const STEP_ORDER: StepKey[] = ["country", "city", "university", "degree", "semesters", "details"];

const DEGREE_OPTIONS = ["Undergraduate", "Graduate", "PhD", "Exchange Student"];
const MIN_SEMESTERS = 1;
const MAX_SEMESTERS = 8;

type Answers = {
  country?: string;
  city?: string;
  school?: string;
  grade?: string;
  semesters?: number;
  department?: string;
  program?: string;
};

export default function QuizFlow({ onComplete }: { onComplete: (profile: UserProfile) => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [activeIndex, setActiveIndex] = useState(0);

  /** Jump back to (and re-open) an earlier step, clearing it and every
   * step after it since later answers may depend on it (e.g. changing the
   * country invalidates any city/university already chosen). */
  function goToStep(index: number) {
    const keysToKeep = STEP_ORDER.slice(0, index);
    setAnswers((current) => {
      const next: Answers = {};
      for (const key of keysToKeep) {
        const value = (current as Record<string, string | undefined>)[mapStepKeyToAnswerKey(key)];
        if (value !== undefined) (next as Record<string, string | undefined>)[mapStepKeyToAnswerKey(key)] = value;
      }
      return next;
    });
    setActiveIndex(index);
  }

  function advance(patch: Partial<Answers>) {
    setAnswers((current) => ({ ...current, ...patch }));
    setActiveIndex((index) => index + 1);
  }

  function finish(details: { department: string; program: string }) {
    const trimmed = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value && value.trim().length > 0),
    );
    onComplete({
      country: answers.country ?? "",
      city: answers.city ?? "",
      grade: answers.grade ?? "",
      // No separate "major" step anymore — the program/department layer
      // (when given) already captures the field of study; fall back to
      // whichever of those is present so downstream agents/UI that still
      // read `major` (search prompt, loading copy) have something to show.
      major: trimmed.program ?? trimmed.department ?? "",
      school: answers.school,
      semesters: answers.semesters ?? 1,
      ...trimmed,
    });
  }

  return (
    <div className="journalCard">
      <div className="quizStack">
        {STEP_ORDER.map((key, index) => {
          if (index > activeIndex) return null;
          if (index < activeIndex) {
            return (
              <DoneRow key={key} label={doneLabel(key)} value={doneValue(key, answers)} onEdit={() => goToStep(index)} />
            );
          }
          // The active (currently open) step.
          switch (key) {
            case "country":
              return <CountryStep key={key} onSubmit={(country) => advance({ country })} />;
            case "city":
              return (
                <CityStep
                  key={key}
                  country={answers.country ?? ""}
                  onBack={() => goToStep(index - 1)}
                  onSubmit={(city) => advance({ city })}
                />
              );
            case "university":
              return (
                <UniversityStep
                  key={key}
                  country={answers.country ?? ""}
                  city={answers.city ?? ""}
                  onBack={() => goToStep(index - 1)}
                  onSubmit={(school) => advance({ school })}
                />
              );
            case "degree":
              return (
                <ChipStep
                  key={key}
                  title="What stage of student would you be?"
                  subtitle="Just so we can picture the right chapter of your journey."
                  options={DEGREE_OPTIONS}
                  onBack={() => goToStep(index - 1)}
                  onSubmit={(grade) => advance({ grade })}
                />
              );
            case "semesters":
              return (
                <SemesterStep
                  key={key}
                  initial={answers.semesters ?? 2}
                  onBack={() => goToStep(index - 1)}
                  onSubmit={(semesters) => advance({ semesters })}
                />
              );
            case "details":
              return <DetailsStep key={key} onBack={() => goToStep(index - 1)} onSkip={() => finish({ department: "", program: "" })} onSubmit={finish} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

function mapStepKeyToAnswerKey(key: StepKey): keyof Answers {
  if (key === "university") return "school";
  if (key === "degree") return "grade";
  return key as keyof Answers;
}

function doneLabel(key: StepKey): string {
  switch (key) {
    case "country":
      return "Country";
    case "city":
      return "City";
    case "university":
      return "University";
    case "degree":
      return "Level";
    case "semesters":
      return "Length of stay";
    default:
      return "";
  }
}

function doneValue(key: StepKey, answers: Answers): string {
  switch (key) {
    case "country":
      return answers.country ?? "";
    case "city":
      return answers.city ?? "";
    case "university":
      return answers.school ?? "";
    case "degree":
      return answers.grade ?? "";
    case "semesters":
      return answers.semesters ? `${answers.semesters} semester${answers.semesters === 1 ? "" : "s"}` : "";
    default:
      return "";
  }
}

/** A collapsed, already-answered layer. Stays visible above the active
 * step (instead of being replaced by it) so the whole multi-layer chain
 * builds up on one page; "Edit" reopens it (and clears everything after). */
function DoneRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="quizStepDone">
      <span className="quizStepDoneText">
        <span className="quizStepDoneLabel">{label}:</span>
        <span className="quizStepDoneValue">{value}</span>
      </span>
      <button className="quizStepEdit" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

/** Layer 1: pick (or type) a country. */
function CountryStep({ onSubmit }: { onSubmit: (country: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="quizStepActive">
      <h2>Where in the world?</h2>
      <p>Pick a country to start narrowing down your future.</p>
      <div className="quizChips">
        {getCountries().map((country) => (
          <button key={country} className="quizChip" onClick={() => onSubmit(country)}>
            {country}
          </button>
        ))}
      </div>
      <input
        className="journalInput"
        placeholder="Or type another country..."
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim()) onSubmit(draft.trim());
        }}
      />
      <div className="journalButtonRow">
        <button className="journalButton" disabled={!draft.trim()} onClick={() => onSubmit(draft.trim())}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Layer 2: pick a city within the chosen country. When we have curated
 * cities for the country, this is a dropdown/search-select only — the
 * player filters by typing but must click a real suggestion, no free-text
 * submit, so the city always stays within the chosen country. Falls back
 * to manual free-text entry only when the country isn't in our curated
 * data at all (no cities to search against). */
function CityStep({ country, onBack, onSubmit }: { country: string; onBack: () => void; onSubmit: (city: string) => void }) {
  const [draft, setDraft] = useState("");
  const curatedCities = getCitiesForCountry(country);
  const hasCuratedData = curatedCities.length > 0;

  const query = draft.trim().toLowerCase();
  const filteredCities = query ? curatedCities.filter((city) => city.toLowerCase().includes(query)) : curatedCities;

  return (
    <div className="quizStepActive">
      <h2>Which city?</h2>
      <p>
        {hasCuratedData
          ? `Search cities in ${country} — pick one from the list.`
          : `Type the city in ${country}.`}
      </p>

      {hasCuratedData ? (
        <>
          <input
            className="journalInput"
            placeholder="Search cities..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <div className="quizChips">
            {filteredCities.map((city) => (
              <button key={city} className="quizChip" onClick={() => onSubmit(city)}>
                {city}
              </button>
            ))}
            {filteredCities.length === 0 && <p className="journalHint">No matching city in {country}.</p>}
          </div>
        </>
      ) : (
        <input
          className="journalInput"
          placeholder="e.g. Shanghai"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) onSubmit(draft.trim());
          }}
        />
      )}

      <div className="journalButtonRow">
        {!hasCuratedData && (
          <button className="journalButton" disabled={!draft.trim()} onClick={() => onSubmit(draft.trim())}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}

/** Layer 3: search for the university, scoped to the already-chosen
 * country/city. Three tiers, cheapest/fastest first:
 * 1. Local curated offline list (src/data/universities.ts), scoped/sorted
 *    by the chosen country+city — instant.
 * 2. If there's no local match, a debounced live search against the free
 *    Hipolabs University API (proxied through the backend, scoped by
 *    country) — covers essentially any real university worldwide.
 * 3. A manual free-text entry, always available, so the flow is never
 *    blocked even if the exact name isn't in either source. */
function UniversityStep({
  country,
  city,
  onBack,
  onSubmit,
}: {
  country: string;
  city: string;
  onBack: () => void;
  onSubmit: (school: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [liveResults, setLiveResults] = useState<{ name: string; country: string }[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  // Before the player types anything, show what's actually in this city as
  // a default pick list (matching the city-step dropdown pattern); once
  // they type, narrow to a scoped text search within the same country+city.
  const localMatches: UniversityEntry[] =
    query.trim().length > 0 ? searchUniversitiesScoped(query, country, city) : getUniversitiesForCity(country, city);
  const exact = query.trim().length > 0 ? findExactUniversity(query) : undefined;
  const hasLocalMatch = localMatches.length > 0 || Boolean(exact);

  useEffect(() => {
    setLiveResults([]);
    if (hasLocalMatch || query.trim().length < 3) {
      setLiveLoading(false);
      return;
    }
    setLiveLoading(true);
    const timer = window.setTimeout(async () => {
      const results = await searchUniversitiesLive(query.trim(), country);
      setLiveResults(results);
      setLiveLoading(false);
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hasLocalMatch, country]);

  return (
    <div className="quizStepActive">
      <h2>Which university?</h2>
      <p>
        Search universities in {city ? `${city}, ` : ""}
        {country}, or type the exact name.
      </p>

      <input
        className="journalInput"
        placeholder="Type a university name..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />

      {localMatches.length > 0 && (
        <div className="universitySuggestions">
          {localMatches.map((entry) => (
            <button key={entry.name} className="universitySuggestion" onClick={() => onSubmit(entry.name)}>
              <span className="universitySuggestionName">{entry.name}</span>
              <span className="universitySuggestionMeta">
                {entry.city}, {entry.country}
              </span>
            </button>
          ))}
        </div>
      )}

      {!hasLocalMatch && liveLoading && <p className="journalHint">Searching universities worldwide...</p>}

      {!hasLocalMatch && liveResults.length > 0 && (
        <div className="universitySuggestions">
          {liveResults.map((entry) => (
            <button key={`${entry.name}-${entry.country}`} className="universitySuggestion" onClick={() => onSubmit(entry.name)}>
              <span className="universitySuggestionName">{entry.name}</span>
              <span className="universitySuggestionMeta">{entry.country}</span>
            </button>
          ))}
        </div>
      )}

      <p className="journalHint">Can't find it in the list? You can type the exact name and continue directly.</p>

      <div className="journalButtonRow">
        <button className="journalButton" disabled={!query.trim()} onClick={() => onSubmit(query.trim())}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Shared chip-picker step, used for both the degree-level and major
 * layers — pick a suggestion or type a custom answer. */
function ChipStep({
  title,
  subtitle,
  options,
  onBack,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  options: string[];
  onBack: () => void;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="quizStepActive">
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div className="quizChips">
        {options.map((option) => (
          <button key={option} className="quizChip" onClick={() => onSubmit(option)}>
            {option}
          </button>
        ))}
      </div>
      <input
        className="journalInput"
        placeholder="Or write your own..."
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim()) onSubmit(draft.trim());
        }}
      />
      <div className="journalButtonRow">
        <button className="journalButton" disabled={!draft.trim()} onClick={() => onSubmit(draft.trim())}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Layer 5: how long the stay lasts, picked with a single slider (1-8
 * semesters) instead of a row of 8 chips — a drag gesture reads faster than
 * scanning/tapping eight options, and the live "N semesters" readout plus a
 * short blurb per length keeps the choice's story impact (longer stay =
 * longer, differently-shaped journey and ending) visible while dragging. */
function SemesterStep({
  initial,
  onBack,
  onSubmit,
}: {
  initial: number;
  onBack: () => void;
  onSubmit: (value: number) => void;
}) {
  const [value, setValue] = useState(() => Math.min(MAX_SEMESTERS, Math.max(MIN_SEMESTERS, initial)));
  const percent = ((value - MIN_SEMESTERS) / (MAX_SEMESTERS - MIN_SEMESTERS)) * 100;

  return (
    <div className="quizStepActive">
      <h2>How many semesters is your stay?</h2>
      <p>
        This sets how long your story runs — more semesters means a longer journey with a different kind
        of ending, not just a longer version of the same one.
      </p>

      <div className="semesterSlider">
        <div className="semesterSliderReadout">
          <span className="semesterSliderValue">{value}</span>
          <span className="semesterSliderLabel">semester{value === 1 ? "" : "s"}</span>
        </div>
        <input
          className="semesterSliderInput"
          type="range"
          min={MIN_SEMESTERS}
          max={MAX_SEMESTERS}
          step={1}
          value={value}
          onChange={(event) => setValue(Number.parseInt(event.target.value, 10))}
          style={{ ["--semester-fill" as string]: `${percent}%` }}
          aria-label="Number of semesters"
        />
        <div className="semesterSliderTicks">
          {Array.from({ length: MAX_SEMESTERS - MIN_SEMESTERS + 1 }, (_, index) => MIN_SEMESTERS + index).map((tick) => (
            <span key={tick} className={tick === value ? "active" : ""}>
              {tick}
            </span>
          ))}
        </div>
        <p className="semesterSliderHint">{semesterHint(value)}</p>
      </div>

      <div className="journalButtonRow">
        <button className="journalButton" onClick={() => onSubmit(value)}>
          Next
        </button>
      </div>
    </div>
  );
}

function semesterHint(value: number): string {
  if (value <= 2) return "A short, focused stay — one or two chapters, tightly wound toward a single ending.";
  if (value <= 4) return "A full year or two abroad — enough time for real routines and relationships to form.";
  if (value <= 6) return "A long-haul journey — your story branches further, with more room to specialize.";
  return "A multi-year saga — the longest, richest version of your story, with an ending shaped by years abroad.";
}

/** Final layer: optional department/program refinement, then finalize
 * everything together (see search_agent_strategy.md — a specific
 * department/program lets the Search Agent research that exact case
 * instead of a generic school-level overview). Entirely skippable. */
function DetailsStep({
  onBack,
  onSkip,
  onSubmit,
}: {
  onBack: () => void;
  onSkip: () => void;
  onSubmit: (details: { department: string; program: string }) => void;
}) {
  const [department, setDepartment] = useState("");
  const [program, setProgram] = useState("");

  return (
    <div className="quizStepActive">
      <h2>Know the exact department or program?</h2>
      <p>
        Optional — give us a specific department or program and we'll research that exact case
        instead of a generic school-level overview. Leave blank to skip.
      </p>

      <div className="quizDetailFields">
        <label>
          Department
          <input
            className="journalInput"
            placeholder="e.g. Graduate School of Information Science"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          />
        </label>
        <label>
          Program
          <input
            className="journalInput"
            placeholder="e.g. MS in Computer Science"
            value={program}
            onChange={(event) => setProgram(event.target.value)}
          />
        </label>
      </div>

      <div className="journalButtonRow">
        <button className="journalButton secondary" onClick={onSkip}>
          Skip
        </button>
        <button className="journalButton" onClick={() => onSubmit({ department, program })}>
          Begin my story
        </button>
      </div>
    </div>
  );
}
