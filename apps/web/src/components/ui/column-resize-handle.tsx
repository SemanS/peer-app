import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const KEY_STEP = 16;

/**
 * The line between two side-by-side panes, dragged to share the width out. `onDrag` gets the pointer's
 * travel since the drag began, so the owner writes widths straight to the DOM and keeps a pane's
 * contents from rendering again on every move; `onCommit` is where it remembers the result.
 */
export function ColumnResizeHandle({
  label,
  onStart,
  onDrag,
  onCommit,
  onReset,
}: {
  readonly label: string;
  readonly onStart: () => void;
  readonly onDrag: (travel: number) => void;
  readonly onCommit: () => void;
  /** A double click goes back to the default widths. */
  readonly onReset: () => void;
}) {
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    moved: boolean;
  } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, moved: false };
    onStart();
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current.moved = true;
    onDrag(event.clientX - drag.current.startX);
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const { moved } = drag.current;
    drag.current = null;
    // A click, and each half of a double click, must not pin the default widths as chosen ones.
    if (moved) onCommit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onStart();
    onDrag(event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP);
    onCommit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className="relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border transition-colors outline-none before:absolute before:inset-y-0 before:-inset-x-1 hover:bg-primary focus-visible:bg-primary active:bg-primary"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}
