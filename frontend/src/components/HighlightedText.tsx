/** Loose heuristic for "this bold phrase names a physical place" — used to
 * decide which highlighted phrases get a little Google Maps pin next to
 * them. Deliberately keyword-based (no backend/schema change needed) so it
 * works on every cached story: catches things like "International Village"
 * or "Downtown Crossing" while leaving non-place phrases (arrival windows,
 * policy names, etc.) alone. */
const PLACE_KEYWORDS =
  /\b(Village|Square|Street|St\.|Ave(nue)?|Hall|Center|Centre|Park|Crossing|Building|Campus|Library|Station|Bridge|District|Airport|Museum|Stadium|Plaza|Market|Road|Rd\.|Dormitory|Dorm|Hostel|Terminal)\b/i;

function isPlaceLike(phrase: string): boolean {
  return PLACE_KEYWORDS.test(phrase);
}

/** Loose heuristic for "this bold phrase names a specific course" — mirrors
 * isPlaceLike above but for course codes/titles (e.g. "CS 188: Introduction
 * to Artificial Intelligence", "6.867 Machine Learning", "MATH 54"), which
 * the Design Agent weaves in verbatim from the Search Agent's
 * campus_life_profile.notable_courses when available. Matches a typical
 * department-code + number pattern so it works for any real course name
 * without needing a schema change to mark them explicitly. */
const COURSE_CODE_PATTERN = /\b[A-Z]{2,6}[\s.-]?\d{1,4}[A-Z]?\b|\b\d{1,2}\.\d{2,4}\b/;

function isCourseLike(phrase: string): boolean {
  return COURSE_CODE_PATTERN.test(phrase);
}

/** Matches the markdown link syntax the Design Agent is prompted to use
 * *inside* a bold-marked phrase when it has a real, research-grounded URL for
 * that course/faculty page/library/club/event — e.g.
 * "**[CS 170: Efficient Algorithms](https://www2.eecs.berkeley.edu/Courses/CS170/)**".
 * Preferred over the isCourseLike/isPlaceLike guesses below whenever present,
 * since it points at the actual source page instead of a generic search. */
const MARKDOWN_LINK_PATTERN = /^\[(.+)\]\((https?:\/\/[^\s)]+)\)$/;

/**
 * Renders story/insight prose with **bold-marked** key phrases (the Design
 * Agent is prompted to wrap 2-4 important phrases per node this way) turned
 * into styled <mark> spans, so long paragraphs are easier to skim. Falls
 * back to plain text if the model didn't include any markers.
 *
 * A bold phrase can also carry a real link the Design Agent sourced from the
 * Search Agent's research — written as **[label](https://...)** — in which
 * case a small link icon opens that exact page (a real course/faculty/
 * library/club/event page) instead of a generic search.
 *
 * When `mapQuery` is given (the story's "City, Country") and a phrase has no
 * real link but looks like a physical place, it instead gets a small
 * clickable map pin that opens Google Maps search for "<phrase>, <mapQuery>".
 *
 * When `schoolQuery` is given and a phrase has no real link but looks like a
 * course code/title, it falls back to a web search for "<phrase> <schoolQuery>
 * course" — same pattern as the map pin, just pointed at a best-effort search
 * instead of a location, for older content generated before real links were
 * threaded through.
 */
export default function HighlightedText({
  text,
  mapQuery,
  schoolQuery,
}: {
  text?: string;
  mapQuery?: string;
  schoolQuery?: string;
}) {
  if (!text) return null;
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 !== 1) return <span key={index}>{part}</span>;

        const linkMatch = part.match(MARKDOWN_LINK_PATTERN);
        if (linkMatch) {
          const [, label, url] = linkMatch;
          return (
            <mark className="textHighlight" key={index}>
              {label}
              <a
                className="textHighlightMapLink"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                aria-label={`Open ${label}`}
                title={url}
              >
                <img src="/stickers/link.svg" alt="" />
              </a>
            </mark>
          );
        }

        return (
          <mark className="textHighlight" key={index}>
            {part}
            {mapQuery && isPlaceLike(part) && (
              <a
                className="textHighlightMapLink"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${part}, ${mapQuery}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                aria-label={`Open ${part} in Google Maps`}
                title={`Open ${part} in Google Maps`}
              >
                <img src="/stickers/address.svg" alt="" />
              </a>
            )}
            {schoolQuery && !isPlaceLike(part) && isCourseLike(part) && (
              <a
                className="textHighlightMapLink"
                href={`https://www.google.com/search?q=${encodeURIComponent(`${part} ${schoolQuery} course`)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                aria-label={`Look up ${part}`}
                title={`Look up ${part}`}
              >
                <img src="/stickers/link.svg" alt="" />
              </a>
            )}
          </mark>
        );
      })}
    </>
  );
}

