import type { EnvironmentId, PeerRoomDiff } from "@t3tools/contracts";

import { Button } from "../../ui/button";
import FileBrowserPanel from "../../files/FileBrowserPanel";

const openNothing = () => {};

/**
 * The project's files in this computer's checkout of the task's work. A row dragged to the
 * conversation, or added from its menu, goes into the draft as a path; a click opens nothing.
 */
export function RoomFiles({
  environmentId,
  diff,
  error,
  projectName,
  canPost,
  onRefresh,
  onAdd,
}: {
  readonly environmentId: EnvironmentId;
  /** Names the folder, since the diff's read is what looks for the checkout. */
  readonly diff: PeerRoomDiff | null;
  readonly error: string | null;
  readonly projectName: string;
  readonly canPost: boolean;
  readonly onRefresh: () => void;
  readonly onAdd: (path: string) => void;
}) {
  if (diff?.folder === undefined) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-5 sm:px-6">
        <p role={error === null ? "status" : "alert"} className="text-sm text-muted-foreground">
          {error ??
            (diff === null
              ? "Looking for the project on this computer…"
              : "This computer has no checkout of the project.")}
        </p>
        {error === null ? null : (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canPost ? (
        <p className="shrink-0 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground sm:px-6">
          Drag a file or folder to the conversation to ask about it.
        </p>
      ) : null}
      <FileBrowserPanel
        key={diff.folder}
        environmentId={environmentId}
        cwd={diff.folder}
        projectName={projectName}
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={openNothing}
        {...(canPost ? { onAddToChat: onAdd } : {})}
        workspaceMutationId={null}
      />
    </div>
  );
}
