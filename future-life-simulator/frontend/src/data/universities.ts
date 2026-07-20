/**
 * Curated offline lookup of well-known study-abroad universities, used to
 * power the QuizFlow's university search step. Selecting an entry
 * auto-fills country + city, so the player never has to separately pick
 * "country" then "city" — the multi-layer search collapses those two steps
 * into one (see search_agent_strategy.md's Phase 0 school/department/program
 * targeting). Deliberately offline/static (no external API call) for
 * reliability during a live demo; free-text fallback covers anything not
 * in this list.
 */
export interface UniversityEntry {
  name: string;
  country: string;
  city: string;
}

export const UNIVERSITIES: UniversityEntry[] = [
  // Japan
  { name: "University of Tokyo", country: "Japan", city: "Tokyo" },
  { name: "Waseda University", country: "Japan", city: "Tokyo" },
  { name: "Keio University", country: "Japan", city: "Tokyo" },
  { name: "Tokyo Institute of Technology", country: "Japan", city: "Tokyo" },
  { name: "Sophia University", country: "Japan", city: "Tokyo" },
  { name: "Kyoto University", country: "Japan", city: "Kyoto" },
  { name: "Osaka University", country: "Japan", city: "Osaka" },
  { name: "Tohoku University", country: "Japan", city: "Sendai" },
  { name: "Hokkaido University", country: "Japan", city: "Sapporo" },
  { name: "Nagoya University", country: "Japan", city: "Nagoya" },
  { name: "Kyushu University", country: "Japan", city: "Fukuoka" },
  { name: "Ritsumeikan Asia Pacific University", country: "Japan", city: "Beppu" },

  // Canada
  { name: "University of Toronto", country: "Canada", city: "Toronto" },
  { name: "University of Waterloo", country: "Canada", city: "Waterloo" },
  { name: "York University", country: "Canada", city: "Toronto" },
  { name: "Toronto Metropolitan University", country: "Canada", city: "Toronto" },
  { name: "McGill University", country: "Canada", city: "Montreal" },
  { name: "Concordia University", country: "Canada", city: "Montreal" },
  { name: "University of British Columbia", country: "Canada", city: "Vancouver" },
  { name: "Simon Fraser University", country: "Canada", city: "Vancouver" },
  { name: "University of Alberta", country: "Canada", city: "Edmonton" },
  { name: "University of Ottawa", country: "Canada", city: "Ottawa" },
  { name: "Queen's University", country: "Canada", city: "Kingston" },
  { name: "University of Calgary", country: "Canada", city: "Calgary" },

  // United States
  { name: "Columbia University", country: "United States", city: "New York" },
  { name: "New York University", country: "United States", city: "New York" },
  { name: "Cornell University", country: "United States", city: "Ithaca" },
  { name: "Cornell Tech", country: "United States", city: "New York" },
  { name: "Massachusetts Institute of Technology", country: "United States", city: "Cambridge" },
  { name: "Harvard University", country: "United States", city: "Cambridge" },
  { name: "Boston University", country: "United States", city: "Boston" },
  { name: "Northeastern University", country: "United States", city: "Boston" },
  { name: "Stanford University", country: "United States", city: "Stanford" },
  { name: "UC Berkeley", country: "United States", city: "Berkeley" },
  { name: "University of Southern California", country: "United States", city: "Los Angeles" },
  { name: "UCLA", country: "United States", city: "Los Angeles" },
  { name: "Carnegie Mellon University", country: "United States", city: "Pittsburgh" },
  { name: "University of Michigan", country: "United States", city: "Ann Arbor" },
  { name: "University of Illinois Urbana-Champaign", country: "United States", city: "Urbana-Champaign" },
  { name: "Georgia Institute of Technology", country: "United States", city: "Atlanta" },
  { name: "University of Washington", country: "United States", city: "Seattle" },

  // United Kingdom
  { name: "University of Oxford", country: "United Kingdom", city: "Oxford" },
  { name: "University of Cambridge", country: "United Kingdom", city: "Cambridge" },
  { name: "Imperial College London", country: "United Kingdom", city: "London" },
  { name: "University College London", country: "United Kingdom", city: "London" },
  { name: "King's College London", country: "United Kingdom", city: "London" },
  { name: "London School of Economics", country: "United Kingdom", city: "London" },
  { name: "University of Edinburgh", country: "United Kingdom", city: "Edinburgh" },
  { name: "University of Manchester", country: "United Kingdom", city: "Manchester" },
  { name: "University of Bristol", country: "United Kingdom", city: "Bristol" },
  { name: "University of Warwick", country: "United Kingdom", city: "Coventry" },
  { name: "University of Glasgow", country: "United Kingdom", city: "Glasgow" },
  { name: "University of Leeds", country: "United Kingdom", city: "Leeds" },

  // Australia
  { name: "University of Melbourne", country: "Australia", city: "Melbourne" },
  { name: "Monash University", country: "Australia", city: "Melbourne" },
  { name: "RMIT University", country: "Australia", city: "Melbourne" },
  { name: "University of Sydney", country: "Australia", city: "Sydney" },
  { name: "UNSW Sydney", country: "Australia", city: "Sydney" },
  { name: "University of Technology Sydney", country: "Australia", city: "Sydney" },
  { name: "University of Queensland", country: "Australia", city: "Brisbane" },
  { name: "Australian National University", country: "Australia", city: "Canberra" },
  { name: "University of Western Australia", country: "Australia", city: "Perth" },
  { name: "University of Adelaide", country: "Australia", city: "Adelaide" },

  // Singapore
  { name: "National University of Singapore", country: "Singapore", city: "Singapore" },
  { name: "Nanyang Technological University", country: "Singapore", city: "Singapore" },
  { name: "Singapore Management University", country: "Singapore", city: "Singapore" },
  { name: "Singapore University of Technology and Design", country: "Singapore", city: "Singapore" },
];

/** Case-insensitive substring match on name (and country, so typing
 * "Japan" surfaces its universities too), capped to keep the dropdown short. */
export function searchUniversities(query: string, limit = 6): UniversityEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return UNIVERSITIES.filter(
    (u) => u.name.toLowerCase().includes(q) || u.country.toLowerCase().includes(q) || u.city.toLowerCase().includes(q),
  ).slice(0, limit);
}

/** Exact (case-insensitive) name match, used to decide whether a typed
 * entry needs the manual country/city fallback fields. */
export function findExactUniversity(name: string): UniversityEntry | undefined {
  const q = name.trim().toLowerCase();
  return UNIVERSITIES.find((u) => u.name.toLowerCase() === q);
}

/** Unique countries covered by the curated list, in the order they first
 * appear (roughly popularity for study-abroad). Powers the multi-layer
 * search's first "Country" step. */
export function getCountries(): string[] {
  return Array.from(new Set(UNIVERSITIES.map((u) => u.country)));
}

/** Unique cities within a given (curated) country, powering the "City"
 * step once a country is chosen. */
export function getCitiesForCountry(country: string): string[] {
  const q = country.trim().toLowerCase();
  return Array.from(new Set(UNIVERSITIES.filter((u) => u.country.toLowerCase() === q).map((u) => u.city)));
}

/** University search strictly scoped to an already-known country (used
 * once the multi-layer search has drilled down that far) — a real
 * multi-layer search means each layer's options must live inside the
 * previous layer, so this deliberately does NOT fall back to the full
 * (unscoped) list when the country isn't in our curated data or has no
 * matches; callers should rely on the live worldwide search (scoped by
 * country server-side) for those cases instead. Matches within the chosen
 * city are sorted first. Requires a non-empty query, consistent with the
 * unscoped searchUniversities(), so an empty search box doesn't dump every
 * university in the country. */
export function searchUniversitiesScoped(query: string, country: string, city: string, limit = 6): UniversityEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const countryLower = country.trim().toLowerCase();
  const cityLower = city.trim().toLowerCase();
  // Strictly scoped to the chosen city (not just sorted first) — a real
  // multi-layer search means university options must live inside the
  // previously chosen city, not just the country.
  const inScope = UNIVERSITIES.filter(
    (u) => u.country.toLowerCase() === countryLower && (!cityLower || u.city.toLowerCase() === cityLower),
  );
  return inScope.filter((u) => u.name.toLowerCase().includes(q) || u.city.toLowerCase().includes(q)).slice(0, limit);
}

/** All curated universities within an already-chosen country+city, used to
 * populate UniversityStep's default suggestion list before the player
 * types anything — same "pick from what's actually there" pattern as
 * getCitiesForCountry(). */
export function getUniversitiesForCity(country: string, city: string, limit = 8): UniversityEntry[] {
  const countryLower = country.trim().toLowerCase();
  const cityLower = city.trim().toLowerCase();
  return UNIVERSITIES.filter(
    (u) => u.country.toLowerCase() === countryLower && u.city.toLowerCase() === cityLower,
  ).slice(0, limit);
}
