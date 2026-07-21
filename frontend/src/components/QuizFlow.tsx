import { useEffect, useState } from "react";
import type { UserProfile } from "../types";
import {
  getCitiesForCountry,
  getCountries,
  getUniversitiesForCity,
  searchUniversitiesScoped,
  type UniversityEntry,
} from "../data/universities";
import { fetchCountries, searchCitiesLive, searchUniversitiesLive } from "../lib/api";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
              <DoneRow key={key} label={doneLabel(key, t)} value={doneValue(key, answers, t)} onEdit={() => goToStep(index)} />
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
                  title={t("quiz.degree.title")}
                  subtitle={t("quiz.degree.subtitle")}
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

function doneLabel(key: StepKey, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (key) {
    case "country":
      return t("quiz.done.country");
    case "city":
      return t("quiz.done.city");
    case "university":
      return t("quiz.done.university");
    case "degree":
      return t("quiz.done.degree");
    case "semesters":
      return t("quiz.done.semesters");
    default:
      return "";
  }
}

function doneValue(key: StepKey, answers: Answers, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (key) {
    case "country":
      return answers.country ?? "";
    case "city":
      return answers.city ?? "";
    case "university":
      return answers.school ?? "";
    case "degree":
      return answers.grade ? t(`degree.${answers.grade}`) : "";
    case "semesters":
      return answers.semesters
        ? `${answers.semesters} ${t(answers.semesters === 1 ? "quiz.semesters.labelOne" : "quiz.semesters.labelMany")}`
        : "";
    default:
      return "";
  }
}

/** A collapsed, already-answered layer. Stays visible above the active
 * step (instead of being replaced by it) so the whole multi-layer chain
 * builds up on one page; "Edit" reopens it (and clears everything after). */
function DoneRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="quizStepDone">
      <span className="quizStepDoneText">
        <span className="quizStepDoneLabel">{label}:</span>
        <span className="quizStepDoneValue">{value}</span>
      </span>
      <button className="quizStepEdit" onClick={onEdit}>
        {t("common.edit")}
      </button>
    </div>
  );
}

/** Layer 1: pick a country — search-only, no manual free-text submission.
 * Two tiers, same pattern as City/University steps:
 * 1. Curated countries (frontend/src/data/universities.ts) as instant
 *    quick-pick chips — the countries our offline university data covers.
 * 2. A full real-world country list fetched once from the backend
 *    (`/api/countries`), filtered locally as the player types — covers
 *    every country, not just our curated eight. The player must click an
 *    actual suggestion; the text input only narrows the search. */
function CountryStep({ onSubmit }: { onSubmit: (country: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [allCountries, setAllCountries] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchCountries().then((countries) => {
      if (!cancelled) setAllCountries(countries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const curatedCountries = getCountries();
  const query = draft.trim().toLowerCase();
  const filteredCurated = query
    ? curatedCountries.filter((country) => country.toLowerCase().includes(query))
    : curatedCountries;

  const curatedLower = new Set(curatedCountries.map((c) => c.toLowerCase()));
  const filteredOthers = query
    ? allCountries.filter((country) => country.toLowerCase().includes(query) && !curatedLower.has(country.toLowerCase()))
    : [];

  return (
    <div className="quizStepActive">
      <h2>{t("quiz.country.title")}</h2>
      <p>{t("quiz.country.subtitle")}</p>
      <input
        className="journalInput"
        placeholder={t("quiz.country.placeholder")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoFocus
      />
      <div className="quizChips">
        {filteredCurated.map((country) => (
          <button key={country} className="quizChip" onClick={() => onSubmit(country)}>
            {country}
          </button>
        ))}
      </div>
      {filteredOthers.length > 0 && (
        <div className="universitySuggestions">
          {filteredOthers.slice(0, 8).map((country) => (
            <button key={country} className="universitySuggestion" onClick={() => onSubmit(country)}>
              <span className="universitySuggestionName">{country}</span>
            </button>
          ))}
        </div>
      )}
      {filteredCurated.length === 0 && filteredOthers.length === 0 && query.length > 0 && (
        <p className="journalHint">
          {allCountries.length > 0 ? t("quiz.country.noMatch") : t("common.loadingCountries")}
        </p>
      )}
    </div>
  );
}

/** Layer 2: pick a city within the chosen country — search-only, no
 * manual free-text submission. Two tiers:
 * 1. Curated cities for this country (frontend/src/data/universities.ts)
 *    shown as instant quick-pick chips — popular study-abroad cities that
 *    already have hand-authored university entries.
 * 2. A debounced live search against a real worldwide city API (proxied
 *    through the backend, scoped by country) — covers any real city, e.g.
 *    "Santa Barbara"/"Santa Cruz"/"Santa Fe", which the tiny curated list
 *    never had at all.
 * The player must click an actual suggestion (curated chip or live
 * result); the text input is for narrowing the search only, so every
 * chosen city is a real, backend-verified place. */
function CityStep({ country, onBack, onSubmit }: { country: string; onBack: () => void; onSubmit: (city: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [liveResults, setLiveResults] = useState<string[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const curatedCities = getCitiesForCountry(country);

  const query = draft.trim().toLowerCase();
  const filteredCurated = query ? curatedCities.filter((city) => city.toLowerCase().includes(query)) : curatedCities;

  useEffect(() => {
    setLiveResults([]);
    if (query.length < 2) {
      setLiveLoading(false);
      return;
    }
    setLiveLoading(true);
    const timer = window.setTimeout(async () => {
      const results = await searchCitiesLive(country, draft.trim());
      // Don't repeat cities already shown as curated chips.
      const curatedLower = new Set(curatedCities.map((c) => c.toLowerCase()));
      setLiveResults(results.filter((city) => !curatedLower.has(city.toLowerCase())));
      setLiveLoading(false);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, country]);

  return (
    <div className="quizStepActive">
      <h2>{t("quiz.city.title")}</h2>
      <p>{t("quiz.city.subtitle", { country })}</p>

      <input
        className="journalInput"
        placeholder={t("quiz.city.placeholder")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoFocus
      />

      <div className="quizChips">
        {filteredCurated.map((city) => (
          <button key={city} className="quizChip" onClick={() => onSubmit(city)}>
            {city}
          </button>
        ))}
      </div>

      {liveLoading && <p className="journalHint">{t("quiz.city.loading")}</p>}

      {liveResults.length > 0 && (
        <div className="universitySuggestions">
          {liveResults.map((city) => (
            <button key={city} className="universitySuggestion" onClick={() => onSubmit(city)}>
              <span className="universitySuggestionName">{city}</span>
              <span className="universitySuggestionMeta">{country}</span>
            </button>
          ))}
        </div>
      )}

      {filteredCurated.length === 0 && liveResults.length === 0 && !liveLoading && query.length > 0 && (
        <p className="journalHint">{t("quiz.city.noMatch", { country })}</p>
      )}
    </div>
  );
}

/** Layer 3: search for the university, scoped to the already-chosen
 * country/city — search-only, no manual free-text submission. Two tiers:
 * 1. Local curated offline list (src/data/universities.ts), scoped/sorted
 *    by the chosen country+city — instant.
 * 2. If there's no local match, a debounced live search against the free
 *    Hipolabs University API (proxied through the backend, scoped by
 *    country) — covers essentially any real university worldwide.
 * The player must click an actual suggestion; the text input only
 * narrows the search, so every chosen university is real/verified. */
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
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [liveResults, setLiveResults] = useState<{ name: string; country: string }[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  // Before the player types anything, show what's actually in this city as
  // a default pick list (matching the city-step dropdown pattern); once
  // they type, narrow to a scoped text search within the same country+city.
  const localMatches: UniversityEntry[] =
    query.trim().length > 0 ? searchUniversitiesScoped(query, country, city) : getUniversitiesForCity(country, city);
  const hasLocalMatch = localMatches.length > 0;

  useEffect(() => {
    setLiveResults([]);
    if (hasLocalMatch || query.trim().length < 2) {
      setLiveLoading(false);
      return;
    }
    setLiveLoading(true);
    const timer = window.setTimeout(async () => {
      const results = await searchUniversitiesLive(query.trim(), country, city);
      setLiveResults(results);
      setLiveLoading(false);
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hasLocalMatch, country, city]);

  return (
    <div className="quizStepActive">
      <h2>{t("quiz.university.title")}</h2>
      <p>
        {t("quiz.university.subtitle", { location: `${city ? `${city}, ` : ""}${country}` })}
      </p>

      <input
        className="journalInput"
        placeholder={t("quiz.university.placeholder")}
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

      {!hasLocalMatch && liveLoading && <p className="journalHint">{t("quiz.university.loading")}</p>}

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

      {!hasLocalMatch && !liveLoading && liveResults.length === 0 && query.trim().length > 0 && (
        <p className="journalHint">{t("quiz.university.noMatch")}</p>
      )}
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
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  return (
    <div className="quizStepActive">
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div className="quizChips">
        {options.map((option) => (
          <button key={option} className="quizChip" onClick={() => onSubmit(option)}>
            {t(`degree.${option}`)}
          </button>
        ))}
      </div>
      <input
        className="journalInput"
        placeholder={t("quiz.customPlaceholder")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim()) onSubmit(draft.trim());
        }}
      />
      <div className="journalButtonRow">
        <button className="journalButton" disabled={!draft.trim()} onClick={() => onSubmit(draft.trim())}>
          {t("common.next")}
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
  const { t } = useI18n();
  const [value, setValue] = useState(() => Math.min(MAX_SEMESTERS, Math.max(MIN_SEMESTERS, initial)));
  const percent = ((value - MIN_SEMESTERS) / (MAX_SEMESTERS - MIN_SEMESTERS)) * 100;

  return (
    <div className="quizStepActive">
      <h2>{t("quiz.semesters.title")}</h2>

      <div className="semesterSlider">
        <div className="semesterSliderReadout">
          <span className="semesterSliderValue">{value}</span>
          <span className="semesterSliderLabel">{t(value === 1 ? "quiz.semesters.labelOne" : "quiz.semesters.labelMany")}</span>
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
          aria-label={t("quiz.semesters.aria")}
        />
        <div className="semesterSliderTicks">
          {Array.from({ length: MAX_SEMESTERS - MIN_SEMESTERS + 1 }, (_, index) => MIN_SEMESTERS + index).map((tick) => (
            <span key={tick} className={tick === value ? "active" : ""}>
              {tick}
            </span>
          ))}
        </div>
        <p className="semesterSliderHint">{semesterHint(value, t)}</p>
      </div>

      <div className="journalButtonRow">
        <button className="journalButton" onClick={() => onSubmit(value)}>
          {t("common.next")}
        </button>
      </div>
    </div>
  );
}

function semesterHint(value: number, t: (key: string) => string): string {
  if (value <= 2) return t("quiz.semesters.hintShort");
  if (value <= 4) return t("quiz.semesters.hintMedium");
  if (value <= 6) return t("quiz.semesters.hintLong");
  return t("quiz.semesters.hintSaga");
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
  const { t } = useI18n();
  const [department, setDepartment] = useState("");
  const [program, setProgram] = useState("");

  return (
    <div className="quizStepActive">
      <h2>{t("quiz.details.title")}</h2>
      <p>{t("quiz.details.subtitle")}</p>

      <div className="quizDetailFields">
        <label>
          {t("quiz.details.department")}
          <input
            className="journalInput"
            placeholder={t("quiz.details.departmentPlaceholder")}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          />
        </label>
        <label>
          {t("quiz.details.program")}
          <input
            className="journalInput"
            placeholder={t("quiz.details.programPlaceholder")}
            value={program}
            onChange={(event) => setProgram(event.target.value)}
          />
        </label>
      </div>

      <div className="journalButtonRow">
        <button className="journalButton secondary" onClick={onSkip}>
          {t("common.skip")}
        </button>
        <button className="journalButton" onClick={() => onSubmit({ department, program })}>
          {t("quiz.details.begin")}
        </button>
      </div>
    </div>
  );
}
