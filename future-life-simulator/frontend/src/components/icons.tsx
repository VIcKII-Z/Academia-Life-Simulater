/* Small hand-drawn line icons in the journal's ink/gold palette.
   Kept as inline SVG (not imported bitmap assets) so they stay crisp at
   small sizes and inherit `currentColor`, matching the vintage postcard look. */

export function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 20.5s-7.6-4.6-10-9.2C.5 8.2 2 4.5 5.6 4.1c2-.2 3.7.8 4.9 2.6 1.2-1.8 2.9-2.8 4.9-2.6 3.6.4 5.1 4.1 3.6 7.2-2.4 4.6-10 9.2-10 9.2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunFaceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="5.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5M18.4 18.4l-1.5-1.5M7.1 7.1 5.6 5.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M9.6 12.6c.5 1 1.4 1.6 2.4 1.6s1.9-.6 2.4-1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10.1" cy="10.6" r="0.5" fill="currentColor" />
      <circle cx="13.9" cy="10.6" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function CoinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="12" rx="8.4" ry="8.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.4 15.2c.4.8 1.3 1.3 2.4 1.3 1.7 0 2.8-1 2.8-2.2 0-1.4-1.2-1.9-2.8-2.3-1.6-.4-2.6-.9-2.6-2.2 0-1.2 1.1-2.1 2.6-2.1 1 0 1.9.4 2.4 1.2"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 6.4v1.1M12 16.5v1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function CompassRoseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M12 5.2 14 12l-2 6.8L10 12z" fill="currentColor" opacity="0.85" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** A weathered signpost arrow used on the fork-in-the-road choice cards. */
export function PathArrowIcon({
  direction,
  className,
}: {
  direction: "left" | "right" | "straight";
  className?: string;
}) {
  const rotation = direction === "left" ? -38 : direction === "right" ? 38 : 0;
  return (
    <svg
      className={className}
      viewBox="0 0 40 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M2 12h32" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M25 4.5 34 12l-9 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
