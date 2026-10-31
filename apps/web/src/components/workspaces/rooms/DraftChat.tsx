import { useAtomValue } from "@effect/atom-react";
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import { targetsFor, type RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerProjectState, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";

import { type DraftId, useComposerDraftStore } from "../../../composerDraftStore";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { PeerPageHeader } from "../PeerPageHeader";
import { useOrganizationStatus } from "../ActiveOrganization";
import { failureMessage, usePeerHubStatus } from "../WorkspaceAccess";
import { usePeerPlugins } from "../slots";
import { peopleOf } from "./room.logic";
import { RoomComposer } from "./RoomComposer";

const TITLE_CHARS = 80;
const OWN_AGENT = { text: "", selected: ["own-agent"] };

/** A chat's name, from the first line of what started it. */
export const chatTitle = (text: string) => {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
};

/**
 * A new thread of a project on the Hub opens as a chat: the room's composer, with the people on
 * the project and your agent. Everything else keeps the thread's own composer, which is `children`:
 * a project on no Hub, a Hub without rooms, a draft that already holds a prompt, and anyone who
 * asks for it, since a thread runs on this computer without a Hub.
 */
export function DraftChat({
  environmentId,
  draftId,
  projectId,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly draftId: DraftId;
  readonly projectId: ProjectId;
  readonly children: ReactNode;
}) {
  const status = useOrganizationStatus(usePeerHubStatus(environmentId));
  const plugins = usePeerPlugins(status);
  const [asThread, setAsThread] = useState(false);
  const hasPrompt = useComposerDraftStore(
    (store) => (store.getComposerDraft(draftId)?.prompt ?? "") !== "",
  );
  const canPost = useAtomValue(serverEnvironment.peerRooms.post.permissionAtom(environmentId));
  const found = (status?.workspaces ?? []).flatMap((workspace) =>
    workspace.projects
      .filter((state) => state.repositories.some((repo) => repo.projectId === projectId))
      .map((state) => ({ workspace: workspace.slug, state })),
  )[0];
  const me = status?.email ?? null;
  if (
    asThread ||
    hasPrompt ||
    !canPost ||
    found === undefined ||
    me === null ||
    status?.environmentId !== environmentId ||
    !plugins.some((plugin) => plugin.id === "rooms")
  ) {
    return children;
  }
  return (
    <NewChat
      environmentId={environmentId}
      workspace={found.workspace}
      projectState={found.state}
      me={me}
      onThread={() => setAsThread(true)}
    />
  );
}

function NewChat({
  environmentId,
  workspace,
  projectState,
  me,
  onThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectState: PeerProjectState;
  readonly me: string;
  readonly onThread: () => void;
}) {
  const navigate = useNavigate();
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const { project } = projectState;
  // A post that fails keeps its chat, so sending again adds no second one.
  const created = useRef<RoomPlace | null>(null);
  const nameOf = (email: string) => personName(projectState, email);

  const prepare = async (text: string): Promise<RoomPlace> => {
    if (created.current !== null) return created.current;
    const result = await createTask({
      environmentId,
      input: { workspace, projectId: project.id, title: chatTitle(text), chat: true },
    });
    if (result._tag !== "Success")
      throw new Error(failureMessage(result) ?? "The chat could not be started.");
    const task = result.value.createdTask?.id;
    if (task === undefined) throw new Error("The Hub did not start the chat.");
    created.current = { workspace, project: project.id, task };
    return created.current;
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: project.name, colorKey: `${workspace}/${project.id}` }}
          page="New chat"
          actions={
            <Button size="sm" variant="ghost" onClick={onThread}>
              Agent thread
            </Button>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4">
            <h1 className="text-center text-2xl font-medium text-foreground">
              What should we build in {project.name}?
            </h1>
            <RoomComposer
              environmentId={environmentId}
              place={{ workspace, project: project.id, task: "new-chat" }}
              targets={targetsFor(project, { id: "", createdBy: me }, [], me, {
                nameOf,
                chat: true,
              })}
              people={peopleOf(project.members, me, nameOf)}
              personalHarnesses={project.capacity.personalHarnesses}
              line={null}
              paths={null}
              chat
              emptyDraft={OWN_AGENT}
              prepare={prepare}
              placeholder="Write to your agent or anyone on the project. @ names a person."
              onDrafting={() => undefined}
              onSent={(place) =>
                void navigate({ to: "/room/$workspace/$project/$task", params: place })
              }
            />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
