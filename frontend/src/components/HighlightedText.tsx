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

/**
 * Renders story/insight prose with **bold-marked** key phrases (the Design
 * Agent is prompted to wrap 2-4 important phrases per node this way) turned
 * into styled <mark> spans, so long paragraphs are easier to skim. Falls
 * back to plain text if the model didn't include any markers.
 *
 * When `mapQuery` is given (the story's "City, Country"), any highlighted
 * phrase that looks like a physical place also gets a small clickable map
 * pin that opens Google Maps search for "<phrase>, <mapQuery>" — so players
 * can see where a mentioned spot actually is, right from the scene text.
 */
export default function HighlightedText({ text, mapQuery }: { text?: string; mapQuery?: string }) {
  if (!text) return null;
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
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
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

