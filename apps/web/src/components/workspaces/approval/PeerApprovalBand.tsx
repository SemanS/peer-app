import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { Badge } from "../../ui/badge";
import { usePeerThread } from "./usePeerThread";

/**
 * Above an approval in a Peer workspace project: the task the thread is on, and what the team's
 * other agents do that bears on it — an overlap with one of the person's agents, a resource
 * another agent holds — each opening its page. Nothing outside a Peer project.
 */
export function PeerApprovalBand({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}) {
  const peer = usePeerThread(environmentId, threadId);
  const navigate = useNavigate();
  if (peer === null) return null;
  const { task, overlaps, held, project } = peer.signals;
  if (task === undefined && overlaps.length === 0 && held === undefined) return null;
  return (
    <div
      aria-label="Around this approval"
      className="flex min-w-0 flex-wrap items-center gap-1.5 ps-8 pb-2.5 sm:ps-7"
      data-peer-approval-band
    >
      {task === undefined ? null : (
        <Badge
          variant="knowledge"
          size="control"
          render={
            task.context === undefined ? undefined : (
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/context/$workspace/$project/$scope",
                    params: {
                      workspace: project.workspace,
                      project: project.projectId,
                      scope: `task:${task.id}`,
                    },
                  })
                }
              />
            )
          }
        >
          <span className="font-semibold">Task</span>
          <span className="max-w-56 truncate font-normal text-foreground/80">
            {task.key === undefined ? task.title : `${task.key} · ${task.title}`}
          </span>
        </Badge>
      )}
      {overlaps.map((overlap) => (
        <Badge
          key={overlap.id}
          variant="coordination"
          size="control"
          render={
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/overlap/$workspace/$project/$overlap",
                  params: {
                    workspace: project.workspace,
                    project: project.projectId,
                    overlap: overlap.id,
                  },
                })
              }
            />
          }
        >
          <span className="font-semibold">Overlap</span>
          <span className="max-w-64 truncate font-normal text-foreground/80">
            {overlap.with === undefined ? "" : `${overlap.with}’s agent · `}
            {overlap.topic} · See it
          </span>
        </Badge>
      ))}
      {held === undefined ? null : (
        <Badge variant="coordination" size="control">
          <span className="font-semibold">Held</span>
          <span className="max-w-64 truncate font-normal text-foreground/80">{held}</span>
        </Badge>
      )}
    </div>
  );
}
