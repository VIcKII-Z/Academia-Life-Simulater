import type { EndingNode } from "../types";

const TONE_LABEL: Record<string, string> = {
  hopeful: "Hopeful",
  bittersweet: "Bittersweet",
  challenging: "Challenging",
};

const TONE_CLASS: Record<string, string> = {
  hopeful: "toneHopeful",
  bittersweet: "toneBittersweet",
  challenging: "toneChallenging",
};

export default function PostcardEnding({
  ending,
  city,
  country,
  onRestart,
}: {
  ending: EndingNode;
  city: string;
  country: string;
  onRestart: () => void;
}) {
  return (
    <div className="sceneShell">
      {ending.image_url && (
        <figure className="polaroid">
          <span className="tape" />
          <img src={ending.image_url} alt="" />
          <figcaption>{city}, {country}</figcaption>
        </figure>
      )}
      <div className="postcard">
        <div className={`wax-seal ${TONE_CLASS[ending.tone]}`}>{TONE_LABEL[ending.tone]}</div>
        <p className="postmark">Postmarked from {city}</p>
        <h2>Your story, sealed</h2>
        <p>{ending.scene_text}</p>
        <div className="journalButtonRow">
          <button className="journalButton" onClick={onRestart}>
            Dream a new story
          </button>
        </div>
      </div>
    </div>
  );
}
