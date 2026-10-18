import type { PeerForecastPair } from "@t3tools/contracts";
import { conflictFiles, excerptLabel } from "./integration.logic";

/**
 * The first conflicting hunk, each side under its label. Both texts are teammates' code, so they
 * sit in fenced blocks and are not instructions. Without the hunk the file names say where.
 */
export function ConflictLines({
  pair,
  me,
}: {
  readonly pair: PeerForecastPair;
  readonly me: string | null;
}) {
  const lines = pair.lines;
  if (lines === undefined) {
    return <p className="text-xs text-muted-foreground">Conflict in {conflictFiles(pair)}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">Conflict in {lines.file}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["a", "b"] as const).map((which) => (
          <figure key={which} className="flex min-w-0 flex-col gap-1">
            <figcaption className="text-xs text-muted-foreground">
              {excerptLabel(pair[which], me)}
            </figcaption>
            <pre
              aria-label={`${excerptLabel(pair[which], me)}, teammate text`}
              className="max-h-40 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground"
            >
              {lines[which]}
            </pre>
          </figure>
        ))}
      </div>
    </div>
  );
}
