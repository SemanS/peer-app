import type { ReactNode } from "react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { OwnerMapSummary } from "./team.logic";
import { SectionNote } from "./TeamParts";

/**
 * The owner map at a glance, read-only for everyone: who owns each area and each path pattern, with
 * the patterns where the owner decides, and who changed it last. A lead or an admin opens it to
 * edit; everybody else opens it to read the same.
 */
export function OwnerMapCard({
  summary,
  canManage,
  onOpen,
}: {
  readonly summary: OwnerMapSummary;
  /** The person edits the map: leads and the workspace's admins. */
  readonly canManage: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <section aria-label="Owner map" className="flex flex-col gap-2.5">
      <PeerSectionLabel after={<SectionNote>{summary.card}</SectionNote>}>
        Owner map
      </PeerSectionLabel>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        <MapGroup
          label="Areas"
          empty={summary.areas.length === 0 ? "The project has no areas." : undefined}
        >
          {summary.areas.map((area) => (
            <li key={area.name} className="flex items-center gap-2.5 px-4 py-1.5 text-sm">
              <span className="min-w-0 flex-1 break-words text-foreground">
                {area.name}
                {area.stale ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · not an area of this project any more
                  </span>
                ) : null}
              </span>
              <span className="text-foreground">{area.owner ?? "No owner"}</span>
            </li>
          ))}
        </MapGroup>
        <MapGroup
          label="Paths"
          empty={summary.paths.length === 0 ? "No path has an owner." : undefined}
        >
          {summary.paths.map((path) => (
            <li
              key={path.pattern}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 basis-40 font-mono text-xs break-all text-foreground">
                {path.pattern}
              </span>
              <span className="text-foreground">{path.owner ?? "No owner"}</span>
              {path.decides ? (
                <Badge variant="warning" size="lg">
                  Owner decides
                </Badge>
              ) : null}
            </li>
          ))}
        </MapGroup>
        <div className="px-4 py-2.5">
          <Button size="xs" variant="outline" onClick={onOpen}>
            {canManage ? "Edit owner map" : "See the owner map"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** A group of the map under its small heading; a line where it holds nothing. */
function MapGroup({
  label,
  empty,
  children,
}: {
  readonly label: string;
  readonly empty: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col py-1.5 first:pt-2.5">
      <h3 className="px-4 pb-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {empty === undefined ? (
        <ul className="flex flex-col">{children}</ul>
      ) : (
        <p className="px-4 py-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
