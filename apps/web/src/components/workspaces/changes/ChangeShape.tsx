import type { ChangeShape } from "@t3tools/client-runtime/peer/changes";

import { cn } from "../../../lib/utils";

/** What each shape says in words, for assistive technology and the legend. */
export const SHAPE_WORDS: Readonly<Record<ChangeShape, string>> = {
  dot: "An agent works in it now",
  ring: "Change, nobody in it",
  diamond: "Landed, immutable",
  cross: "Conflict stored in the change",
};

const SHAPE_COLOR: Readonly<Record<ChangeShape, string>> = {
  dot: "text-info-foreground",
  ring: "text-muted-foreground",
  diamond: "text-muted-foreground",
  cross: "text-destructive-foreground",
};

/** A shape drawn around (x, y) inside an svg, in jj log's alphabet. */
export function ShapeAt({
  shape,
  x,
  y,
  className,
}: {
  readonly shape: ChangeShape;
  readonly x: number;
  readonly y: number;
  readonly className?: string;
}) {
  const tone = cn(SHAPE_COLOR[shape], className);
  switch (shape) {
    case "dot":
      return <circle cx={x} cy={y} r={6.5} className={cn("fill-current", tone)} />;
    case "ring":
      return (
        <circle
          cx={x}
          cy={y}
          r={6}
          strokeWidth={2.25}
          className={cn("fill-background stroke-current", tone)}
        />
      );
    case "diamond":
      return (
        <path
          d={`M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z`}
          className={cn("fill-current", tone)}
        />
      );
    case "cross":
      return (
        <path
          d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`}
          fill="none"
          strokeWidth={2.75}
          strokeLinecap="round"
          className={cn("stroke-current", tone)}
        />
      );
  }
}

/** The same shape on its own, for the legend and a task's stack. */
export function ShapeIcon({
  shape,
  className,
}: {
  readonly shape: ChangeShape;
  readonly className?: string;
}) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn("size-4 shrink-0", className)}>
      <ShapeAt shape={shape} x={10} y={10} />
    </svg>
  );
}
