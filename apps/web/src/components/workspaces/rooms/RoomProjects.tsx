import { CheckIcon } from "lucide-react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { ProjectMark } from "../signals";
import type { RoomProjectChip } from "./sharedRoom.logic";

function ChipBody({ project }: { readonly project: RoomProjectChip }) {
  return (
    <>
      <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3.5" />
      <span className="min-w-0 truncate">{project.name}</span>
      {project.folder ? <span className="text-muted-foreground">local</span> : null}
      {project.marked ? (
        <>
          <CheckIcon aria-hidden />
          <span className="sr-only">marked</span>
        </>
      ) : null}
    </>
  );
}

/**
 * The composer's `In` row: every project the room's agent works in, marked, so what a message sets
 * in motion stays in view from the first word on. Before a room starts `onToggle` lets a person
 * leave one out; a running room's projects are settled, as its agent's checkouts are.
 */
export function RoomProjects({
  projects,
  onToggle,
}: {
  readonly projects: ReadonlyArray<RoomProjectChip>;
  readonly onToggle?: (key: string) => void;
}) {
  const away = projects.filter((project) => project.away !== undefined);
  return (
    <>
      <div role="group" aria-label="Projects" className="flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs text-muted-foreground">In</span>
        {projects.map((project) =>
          onToggle === undefined ? (
            <Badge key={project.key} variant="outline" size="control">
              <ChipBody project={project} />
            </Badge>
          ) : (
            <Button
              key={project.key}
              type="button"
              size="compact"
              variant={project.marked ? "outline" : "ghost-muted"}
              aria-pressed={project.marked}
              disabled={project.away !== undefined}
              onClick={() => onToggle(project.key)}
            >
              <ChipBody project={project} />
            </Button>
          ),
        )}
      </div>
      {away.map((project) => (
        <p key={project.key} className="text-xs text-muted-foreground">
          {project.name}: {project.away}
        </p>
      ))}
    </>
  );
}
