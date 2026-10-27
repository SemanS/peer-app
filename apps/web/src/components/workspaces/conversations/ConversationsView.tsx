import { contextViewRevision } from "@t3tools/client-runtime/peer/contextView";
import {
  PEER_LOCAL_WORKSPACE,
  ThreadId,
  type EnvironmentId,
  type PeerConversationReport,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LightbulbIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { ConversationReport } from "../ConversationReport";
import { PeerPageHeader } from "../PeerPageHeader";
import { useWorkActions } from "../useWorkActions";
import { reportFailure } from "../workFeedback";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { conversationExcerpts } from "./conversations.logic";

/** How many conversations a page shows, and so how many "Find knowledge" reads at once. */
const PAGE = 40;

/**
 * What the project's agents were asked and what they replied, including work on no task: the
 * project's history in the agents' own words. Current status shows where the work stands now and
 * Knowledge what holds beyond it; from here people ask kontext to propose what these conversations
 * add to Knowledge.
 */
export function ConversationsView({
  workspace,
  project,
  environmentId: requestedEnvironmentId,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly environmentId?: EnvironmentId | undefined;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    requestedEnvironmentId ??
    (primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null);
  const status = usePeerHubStatus(environmentId);
  const actions = useWorkActions(environmentId);
  const navigate = useNavigate();
  const placeKey = `${environmentId}:${workspace}:${project}`;
  const [page, setPage] = useState<{ place: string; cursor?: string }>({ place: "" });
  const cursor = page.place === placeKey ? page.cursor : undefined;
  const view = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerHubContextView({
          environmentId,
          input: {
            workspace,
            project,
            scope: "project-aggregate",
            limit: PAGE,
            revision: contextViewRevision(status, workspace, project),
            ...(cursor === undefined ? {} : { conversationCursor: cursor }),
          },
        }),
  );
  const refreshVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible" && document.hasFocus() && !view.isPending) {
      view.refresh();
    }
  });
  useEffect(() => {
    if (environmentId === null) return;
    const timer = window.setInterval(refreshVisible, 5_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [environmentId]);

  const projectName =
    status?.workspaces
      .find((entry) => entry.slug === workspace)
      ?.projects.find((entry) => entry.project.id === project)?.project.name ??
    status?.coordination.local?.projects?.find((entry) => entry.id === project)?.name ??
    project;
  const report = view.data?.conversations;
  const scopeOfStatus = workspace === PEER_LOCAL_WORKSPACE ? "project-aggregate" : "project";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          page="Conversations"
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-7">
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-foreground">
                What {projectName}&apos;s agents were asked and what they replied, including work
                outside any task.
              </p>
              <p className="text-muted-foreground">
                For where the work stands now, open Current status. For what holds beyond any one
                task, open Knowledge.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/context/$workspace/$project/$scope",
                      params: { workspace, project, scope: scopeOfStatus },
                      search: { environmentId: environmentId ?? undefined },
                    })
                  }
                >
                  Current status
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/knowledge/$workspace/$project",
                      params: { workspace, project },
                    })
                  }
                >
                  Knowledge
                </Button>
              </div>
            </div>
            {environmentId === null || report === undefined ? null : (
              <FindKnowledge
                environmentId={environmentId}
                workspace={workspace}
                project={project}
                items={report.items}
              />
            )}
            {report === undefined ? (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={environmentId === null || view.isPending}
                  onClick={view.refresh}
                >
                  {view.isPending ? "Loading…" : "Load conversations"}
                </Button>
                {view.error === null ? null : (
                  <p role="status" className="text-sm text-muted-foreground">
                    {view.error}
                  </p>
                )}
                {view.error === null || cursor === undefined ? null : (
                  <Button size="sm" variant="outline" onClick={() => setPage({ place: placeKey })}>
                    First conversations
                  </Button>
                )}
              </div>
            ) : (
              <ConversationReport
                report={report}
                isPending={view.isPending}
                isFirstPage={cursor === undefined}
                onRefresh={view.refresh}
                onPage={(next) =>
                  setPage({ place: placeKey, ...(next === undefined ? {} : { cursor: next }) })
                }
                onOpenThread={(threadId) => {
                  if (environmentId === null) return;
                  actions.open({
                    kind: "thread",
                    environmentId,
                    threadId: ThreadId.make(threadId),
                  });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/**
 * kontext reads the conversations on this page for decisions, conventions and lessons the project
 * should keep, and for what contradicts an entry it already keeps; each proposal waits in Knowledge's
 * Review for people to keep or dismiss. Offered where the project keeps knowledge with kontext's
 * model on this computer, and says why not where it does not.
 */
function FindKnowledge({
  environmentId,
  workspace,
  project,
  items,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly items: PeerConversationReport["items"];
}) {
  const harvest = useAtomCommand(serverEnvironment.peerHubHarvestContext, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const [reading, setReading] = useState(false);
  const knowledge = useEnvironmentQuery(
    serverEnvironment.peerHubKnowledgeStatus({ environmentId, input: { workspace, project } }),
  ).data;
  const excerpts = conversationExcerpts(items);
  if (knowledge == null) return null;
  const ready = knowledge.store === true && knowledge.llm;

  const find = async () => {
    if (excerpts === null) return;
    setReading(true);
    const result = await harvest({
      environmentId,
      input: { workspace, project, scope: "project", conversations: excerpts.text },
    });
    setReading(false);
    if (!reportFailure("Could not read them", result) || result._tag !== "Success") return;
    const proposed = result.value.proposed;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title:
          proposed === 0
            ? "Nothing in them holds beyond the work"
            : `${proposed} ${proposed === 1 ? "proposal" : "proposals"} waiting in Knowledge › Review`,
        description: "People keep or dismiss them there; nothing is kept on its own.",
        ...(proposed === 0
          ? {}
          : {
              actionProps: {
                children: "Review",
                onClick: () =>
                  void navigate({
                    to: "/knowledge/$workspace/$project",
                    params: { workspace, project },
                  }),
              },
            }),
      }),
    );
  };

  return (
    <section
      aria-label="Knowledge from conversations"
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LightbulbIcon aria-hidden className="size-4 text-peer-knowledge-foreground" />
          Knowledge from these conversations
        </h2>
        {ready ? (
          <Button
            size="sm"
            variant="outline"
            disabled={reading || excerpts === null}
            onClick={() => void find()}
          >
            {reading
              ? "Reading…"
              : excerpts === null
                ? "Nothing to read yet"
                : `Read ${excerpts.read} ${excerpts.read === 1 ? "conversation" : "conversations"}`}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {ready
          ? "kontext looks for decisions, conventions and lessons worth keeping, and for anything that contradicts what Knowledge already says. Each finding waits in Knowledge › Review; nothing is kept until someone keeps it."
          : knowledge.store !== true
            ? "This project keeps no knowledge on this computer yet, so conversations cannot be turned into proposals here."
            : "Proposing knowledge from conversations needs kontext's model on this computer."}
      </p>
    </section>
  );
}
