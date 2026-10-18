import type { ChangeShape } from "@t3tools/client-runtime/peer/changes";

import { SHAPE_WORDS, ShapeIcon } from "./ChangeShape";

const ORDER: ReadonlyArray<ChangeShape> = ["dot", "ring", "diamond", "cross"];

/** What the shapes mean, and where another computer's data comes from. */
export function Legend() {
  return (
    <section aria-label="Legend" className="flex flex-col gap-2 border-t border-border pt-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-foreground">
        {ORDER.map((shape) => (
          <li key={shape} className="flex items-center gap-1.5">
            <ShapeIcon shape={shape} />
            {SHAPE_WORDS[shape]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Shapes follow jj log. Changes on other computers come from the Hub: ids, parents, files and
        state. Their code shows once it is pushed or shared.
      </p>
    </section>
  );
}
