/**
 * Tiny floating stickers that visually connect a choice to the stat bar
 * reacting to it: when a stat goes up, its sticker flies from the choice the
 * player just clicked up into the top app bar; when a stat goes down, that
 * same sticker instead drops out of the bar and tumbles away. Purely
 * decorative/self-cleaning — each entry removes itself via onAnimationEnd.
 */
export interface StatFlyer {
  id: string;
  icon: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  kind: "gain" | "loss";
}

export default function StatFlyers({
  flyers,
  onDone,
}: {
  flyers: StatFlyer[];
  onDone: (id: string) => void;
}) {
  if (flyers.length === 0) return null;
  return (
    <div className="statFlyerField" aria-hidden="true">
      {flyers.map((flyer) => (
        <img
          key={flyer.id}
          className={`statFlyer statFlyer--${flyer.kind}`}
          src={flyer.icon}
          alt=""
          style={
            {
              left: `${flyer.x}px`,
              top: `${flyer.y}px`,
              "--dx": `${flyer.dx}px`,
              "--dy": `${flyer.dy}px`,
            } as React.CSSProperties
          }
          onAnimationEnd={() => onDone(flyer.id)}
        />
      ))}
    </div>
  );
}
