import type { PeerSettingsLine } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";

import { lineKeys, lineWhere } from "./reviewChanges.logic";

/**
 * A revision's or proposal's changes in words, one line each: what it is about, then `from → to`
 * with the new value in front. Lines of the scope the list is of (`scopeName`) drop its name;
 * without one every line names its scope.
 */
export function ChangeLines({
  lines,
  scopeName,
}: {
  readonly lines: ReadonlyArray<PeerSettingsLine>;
  readonly scopeName?: string | undefined;
}) {
  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {lineKeys(lines).map(({ key, line }) => (
        <li key={key} className="min-w-0 break-words">
          <span className="text-muted-foreground">
            {scopeName === undefined
              ? `${line.scope.name} · ${line.label}`
              : lineWhere(line, scopeName)}
            :{" "}
          </span>
          <span className="text-muted-foreground">{line.from}</span>{" "}
          <ArrowRightIcon aria-hidden className="inline size-3 text-muted-foreground/70" />{" "}
          <span className="font-medium text-foreground">{line.to}</span>
        </li>
      ))}
    </ul>
  );
}
