import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * Wraps a floating panel (Field Notes, the scene-text card) so it gently
 * bobs in place on its own, and can also be picked up by its drag handle
 * and dropped anywhere on screen. Drag offset and the idle bob animation
 * live on two separate nested elements so they compose instead of one
 * fighting the other for the `transform` property.
 */
export default function Floaty({
  children,
  driftDuration = 6,
  driftDelay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds per up/down drift cycle — vary per panel so they don't move in lockstep. */
  driftDuration?: number;
  driftDelay?: number;
  className?: string;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function onHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy });
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div
      className={`floaty${className ? ` ${className}` : ""}${dragging ? " floaty--dragging" : ""}`}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className="floatyDrift"
        style={{ animationDuration: `${driftDuration}s`, animationDelay: `${driftDelay}s` }}
      >
        <button
          type="button"
          className="floatyHandle"
          aria-label="Drag to move this panel"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <span />
          <span />
          <span />
        </button>
        {children}
      </div>
    </div>
  );
}
