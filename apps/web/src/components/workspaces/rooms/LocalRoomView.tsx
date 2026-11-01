import { PEER_LOCAL_WORKSPACE, type EnvironmentId, type PeerHubStatus } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../../env";
import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import ChatMarkdown from "../../ChatMarkdown";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Textarea } from "../../ui/textarea";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";
import { useWorkData } from "../useWorkData";
import { useRoomRead } from "./useRoom";

/** A project's room on a computer with no Hub for it: this person and their running agents. */
export function LocalRoomView({ project }: { readonly project: string }) {
  const { environmentId, status } = useWorkData();
  if (environmentId === null || status === null) return null;
  return <LocalRoom environmentId={environmentId} status={status} project={project} />;
}

function LocalRoom({
  environmentId,
  status,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly project: string;
}) {
  const post = useAtomCommand(serverEnvironment.peerRooms.post);
  const [text, setText] = useState("");
  const place = { workspace: PEER_LOCAL_WORKSPACE, project, task: "room" };
  const { messages, refresh } = useRoomRead({ environmentId, status, place, limit: 200 });
  const send = () => {
    const words = text.trim();
    if (words === "") return;
    const input = { ...place, op: randomUUID(), text: words, to: [] };
    setText("");
    void post({ environmentId, input }).then(refresh);
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron}>
          <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-base font-semibold text-foreground">Room</span>
        </WorkspacePageHeader>
        <ul className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-(--workspace-page-gutter) py-6">
          {messages.length === 0 ? (
            <li role="status" className="text-sm text-muted-foreground">
              Nothing was said yet. Your running agents on this project hear what you write here at
              their next step.
            </li>
          ) : (
            messages.map((message) => (
              <li key={message.seq} className="flex min-w-0 flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  {message.author.run === undefined ? "You" : (message.author.agent ?? "Agent")} ·{" "}
                  {formatRelativeTimeLabel(message.at)}
                  {message.anchor === undefined
                    ? ""
                    : ` · ${message.anchor.path}:${message.anchor.line}`}
                </p>
                <ChatMarkdown text={message.text} cwd={undefined} lineBreaks parseRawHtml={false} />
              </li>
            ))
          )}
        </ul>
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <Textarea
            aria-label="Write to your agents"
            placeholder="Write to your agents on this project."
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={text.trim() === ""}>
            Send
          </Button>
        </form>
      </div>
    </SidebarInset>
  );
}
