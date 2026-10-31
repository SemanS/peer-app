import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type PeerRoomDiff, ThreadId } from "@t3tools/contracts";
import { lazy, Suspense, useState } from "react";

import { DraftId } from "../../../composerDraftStore";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../../state/server";
import { Button } from "../../ui/button";

const FilePreviewPanel = lazy(() => import("../../files/FilePreviewPanel"));

const ignorePending = () => {};

// A room has no thread. A draft target reads assets by folder and path, so these ids reach nothing.
const ROOM_THREAD = ThreadId.make("room-files");
const ROOM_DRAFT = DraftId.make("room-files");

/**
 * The project's files in this computer's checkout of the task's work. A click shows the file beside
 * the tree, to read: changes stay with the agents. A row dragged to the conversation, or added from
 * its menu, goes into the draft as a path.
 */
export function RoomFiles({
  environmentId,
  diff,
  error,
  projectName,
  canPost,
  revision,
  onRefresh,
  onAdd,
}: {
  readonly environmentId: EnvironmentId;
  /** Names the folder, since the diff's read is what looks for the checkout. */
  readonly diff: PeerRoomDiff | null;
  readonly error: string | null;
  readonly projectName: string;
  readonly canPost: boolean;
  /** Moves as the task's agents work, so an open file and the tree read again. */
  readonly revision: string;
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
    <Suspense fallback={null}>
      <RoomFileSurface
        key={diff.folder}
        environmentId={environmentId}
        folder={diff.folder}
        projectName={projectName}
        revision={revision}
        {...(canPost ? { onAdd } : {})}
      />
    </Suspense>
  );
}

function RoomFileSurface({
  environmentId,
  folder,
  projectName,
  revision,
  onAdd,
}: {
  readonly environmentId: EnvironmentId;
  readonly folder: string;
  readonly projectName: string;
  readonly revision: string;
  readonly onAdd?: (path: string) => void;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const [path, setPath] = useState<string | null>(null);
  const [folderTrail, setFolderTrail] = useState<string | undefined>(undefined);
  const openFile = (relativePath: string) => {
    setPath(relativePath);
    setFolderTrail(undefined);
  };
  return (
    <FilePreviewPanel
      environmentId={environmentId}
      cwd={folder}
      projectName={projectName}
      threadRef={scopeThreadRef(environmentId, ROOM_THREAD)}
      composerDraftTarget={ROOM_DRAFT}
      keybindings={keybindings}
      availableEditors={availableEditors}
      relativePath={path}
      revealLine={null}
      revealRequestId={0}
      onOpenFile={openFile}
      onNavigateFolder={(relativePath, trail) => {
        setPath(relativePath === "" ? null : relativePath);
        setFolderTrail(trail === relativePath ? undefined : trail);
      }}
      folderTrail={folderTrail}
      onPendingChange={ignorePending}
      selectedFilePending={false}
      workspaceMutationId={revision}
      readOnly
      onClose={() => {
        setPath(null);
        setFolderTrail(undefined);
      }}
      {...(onAdd === undefined ? {} : { onAddToChat: onAdd })}
    />
  );
}
