import { peerAgentIsBlocked, peerAgentIsGone } from "@t3tools/client-runtime/peer/needs-you";
import type { EnvironmentId, PeerAgentView } from "@t3tools/contracts";
import { peerCoordinationDetail, peerCoordinationLabel } from "@t3tools/client-runtime/peer/herdr";
import { useState } from "react";

import { isElectron } from "../../../env";
import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { Textarea } from "../../ui/textarea";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../ui/tooltip";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";
import { AgentTimeline } from "../AgentTimeline";
import { StatusGlyph } from "../workStatus";
import { failureMessage, usePeerHubStatus } from "../WorkspaceAccess";

/**
 * One of this computer's herdr agents, in Peer: what it has done so far (from
 * its own transcript when Peer knows its session, else the end of its
 * terminal) and a box for its next prompt. herdr keeps the agent running;
 * Peer is where you follow and steer it.
 */
export function AgentView({ agentId }: { readonly agentId: string }) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const view =
    useEnvironmentQuery(
      environmentId === null
        ? null
        : serverEnvironment.peerHubWatchAgent({ environmentId, input: { agentId } }),
    ).data ?? undefined;
  const focusAgent = useAtomCommand(serverEnvironment.peerHubFocusAgent, { reportFailure: false });
  const status = usePeerHubStatus(environmentId);
  const local = status?.agents.list.find(
    (agent) => agent.id === agentId || agent.paneId === view?.paneId,
  );
  const paneId = view?.paneId;
  const details = view === undefined ? [] : [view.agent, "herdr", view.branch].filter(Boolean);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {view === undefined ? null : <StatusGlyph status={view.status} />}
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {view?.title || "Agent"}
            </span>
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {details.join(" · ")}
            </span>
          </div>
          {environmentId !== null && paneId !== undefined && !view?.gone ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void focusAgent({ environmentId, input: { paneId } }).then((result) => {
                  const message = failureMessage(result);
                  if (message !== null) {
                    toastManager.add(
                      stackedThreadToast({
                        type: "error",
                        title: "Could not show that agent in herdr",
                        description: message,
                      }),
                    );
                  }
                })
              }
            >
              Show in herdr
            </Button>
          ) : null}
        </WorkspacePageHeader>
        {local === undefined ? null : (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} />}>
                {peerCoordinationLabel(
                  local.coordinationLevel,
                  status?.mcp?.agents.includes(local.id),
                )}
                {local.coordinationLevel === "C" && local.postHocPaths !== undefined
                  ? ` · ${local.postHocPaths.length} uncommitted paths observed`
                  : ""}
              </TooltipTrigger>
              <TooltipPopup>
                {peerCoordinationDetail(
                  local.coordinationLevel,
                  status?.mcp?.agents.includes(local.id),
                )}
              </TooltipPopup>
            </Tooltip>
            {(local.postHocPathsTruncated ?? 0) > 0 ? (
              <span> · {local.postHocPathsTruncated} additional paths remain local</span>
            ) : null}
            {(status?.agents.postHocSkipped ?? 0) > 0 ? (
              <p role="status">
                {status?.agents.postHocSkipped} agents' observations exceed the team's report limit.
              </p>
            ) : null}
          </div>
        )}
        <AgentTimeline view={view} />
        <AgentComposer environmentId={environmentId} view={view} />
      </div>
    </SidebarInset>
  );
}

/** The next prompt, sent into the agent's terminal through herdr. */
function AgentComposer({
  environmentId,
  view,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly view: PeerAgentView | undefined;
}) {
  const promptAgent = useAtomCommand(serverEnvironment.peerHubPromptAgent, {
    reportFailure: false,
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const blocked = view !== undefined && peerAgentIsBlocked(view.status);
  const unavailable = environmentId === null || peerAgentIsGone(view);
  const send = () => {
    const prompt = text.trim();
    if (
      prompt === "" ||
      sending ||
      unavailable ||
      blocked ||
      environmentId === null ||
      view === undefined
    )
      return;
    setSending(true);
    void promptAgent({ environmentId, input: { agentId: view.agentId, text: prompt } })
      .then((result) => {
        const message = failureMessage(result);
        if (message === null) {
          setText("");
          return;
        }
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not send the prompt",
            description: message,
          }),
        );
      })
      .finally(() => setSending(false));
  };
  return (
    <div className="border-t border-border px-6 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {blocked ? (
          <p className="text-xs text-warning-foreground">
            It is waiting for an answer in its terminal. Answer it in herdr, then continue here.
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            className="min-w-0 flex-1"
            rows={2}
            value={text}
            disabled={unavailable || blocked}
            placeholder={
              view?.status === "working"
                ? "It is working; a prompt now waits for its turn"
                : "Tell it what to do next"
            }
            aria-label="Prompt for the agent"
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <Button
            size="sm"
            disabled={unavailable || blocked || sending || text.trim() === ""}
            onClick={send}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
