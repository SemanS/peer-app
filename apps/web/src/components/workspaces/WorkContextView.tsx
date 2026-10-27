import { contextFromStatus, contextViewRevision } from "@t3tools/client-runtime/peer/contextView";
import { CurrentContextReport } from "./handoff/HandoffReport";
import {
  type EnvironmentId,
  type PeerContextVersion,
  type PeerHubStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ContextComparison, SharedInputs } from "./SharedInputs";
import { SidebarInset } from "../ui/sidebar";
import { contextAgents, readState, type ContextAgent } from "./contextAgents.logic";
import { contextComparison } from "./contextCompare.logic";
import { PeerPageHeader, PeerSectionLabel } from "./PeerPageHeader";
import { TONE_TEXT } from "./signals";
import { useWorkActions } from "./useWorkActions";
import { confirmed, reportFailure } from "./workFeedback";
import { STATUS_LABEL, StatusGlyph } from "./workStatus";
import { usePeerHubStatus } from "./WorkspaceAccess";
import { PeerCoordTimeline } from "./PeerCoordTimeline";
import { HandoffChatContext, type HandoffChat } from "./review/HandoffChat";
import { handoffChat } from "./review/review.logic";
import { usePeerPlugins } from "./slots";
import { canWatchThreads } from "./slots.logic";
import {
  adviceLabel,
  adviceOnWork,
  buildWorkTree,
  contextSize,
  personName,
  type WorkAdviceRow,
  type WorkContextNode,
  type WorkOpen,
  type WorkThreadNode,
} from "./workTree.logic";

interface Place {
  readonly workspace: string;
  readonly project: string;
  readonly scope: string;
}

/**
 * The shared context of a task, or of a project's work on no task, as the
 * agent keeping it left it. One agent keeps it at a time; the others read it
 * and send it what they find. Below it: what waits to be folded in, the agents
 * on the work (to open yours or watch a colleague's they share), and the
 * versions the hub keeps, to see what changed and bring one back.
 */
export function WorkContextView({
  workspace,
  project,
  scope,
  compare,
}: Place & {
  /** A version to put beside the latest, from a link that asks (a review's Compare). */
  readonly compare?: number | undefined;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const plugins = usePeerPlugins(status);
  const localThreads = useThreadShells();
  const now = useRelativeTimeTick(30_000);
  const actions = useWorkActions(environmentId);
  const navigate = useNavigate();
  const restoreContext = useAtomCommand(serverEnvironment.peerHubRestoreContext, {
    reportFailure: false,
  });
  const tree =
    status === null
      ? []
      : buildWorkTree({ status, localThreads, now, watch: canWatchThreads(plugins) });
  const node = tree.find((p) => p.workspace === workspace && p.projectId === project);
  const state = status?.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
  const task = scope.startsWith("task:")
    ? node?.areas.flatMap((area) => area.tasks).find((t) => t.id === scope.slice("task:".length))
    : undefined;
  const context =
    (scope === "project" ? node?.context : task?.context) ??
    (status === null ? undefined : contextFromStatus(status, workspace, project, scope));
  const comparing = contextComparison(compare, context?.version);
  const found = task === undefined ? null : handoffChat(task);
  const chat: HandoffChat | null =
    found === null ? null : { title: found.title, open: () => actions.open(found.open) };
  const read = useEnvironmentQuery(
    environmentId === null || context === undefined
      ? null
      : serverEnvironment.peerHubReadContext({
          environmentId,
          input: { workspace, project, scope, version: context.version },
        }),
  );
  const [inputPage, setInputPage] = useState<{ place: string; cursor?: string }>({ place: "" });
  const [findingPage, setFindingPage] = useState<{ place: string; cursor?: string }>({ place: "" });
  const placeKey = `${environmentId}:${workspace}:${project}:${scope}`;
  const onPageInputs = (cursor?: string) =>
    setInputPage({ place: placeKey, ...(cursor === undefined ? {} : { cursor }) });
  const onPageFindings = (cursor?: string) =>
    setFindingPage({ place: placeKey, ...(cursor === undefined ? {} : { cursor }) });
  const onOpenSource = (nextScope: string, revision?: string) =>
    void navigate({
      to: "/context/$workspace/$project/$scope",
      params: { workspace, project, scope: nextScope },
      search:
        revision !== undefined && Number.isSafeInteger(Number(revision)) && Number(revision) > 0
          ? { compare: Number(revision) }
          : {},
    });
  const currentView = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerHubContextView({
          environmentId,
          input: {
            workspace,
            project,
            scope,
            revision: contextViewRevision(status, workspace, project),
            ...(inputPage.place === placeKey && inputPage.cursor !== undefined
              ? { inputCursor: inputPage.cursor }
              : {}),
            ...(findingPage.place === placeKey && findingPage.cursor !== undefined
              ? { findingCursor: findingPage.cursor }
              : {}),
          },
        }),
  );
  const text = read.data?.text ?? "";
  const projectSessions =
    status?.coordination.sessions.filter(
      (session) => session.workspace === workspace && session.project === project,
    ) ?? [];
  const workSessions = projectSessions.filter((session) =>
    scope === "project" ? session.task === undefined : session.task === scope.slice(5),
  );
  const agents = (scope === "project" ? node?.unsorted : task?.threads) ?? [];
  const advice = status === null ? [] : adviceOnWork({ status, workspace, project, scope });

  const restore = async (version: number) => {
    if (environmentId === null) return;
    const sure = await confirmed(
      `Bring version ${version} back? It becomes the newest version, and the agent keeping the context goes on from it.`,
    );
    if (!sure) return;
    reportFailure(
      `Could not bring version ${version} back`,
      await restoreContext({ environmentId, input: { workspace, project, scope, version } }),
    );
  };

  const keeper = context?.keeper;
  const headerState =
    context === undefined
      ? undefined
      : {
          label:
            keeper === undefined
              ? `v${context.version} · nobody keeps it now`
              : `v${context.version} · kept by ${keeper.mine ? "your agent" : `${keeper.person}’s agent`}`,
          tone: "knowledge" as const,
        };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{
            name:
              node?.name ??
              state?.project.name ??
              (workspace === "@local" ? "Local project" : project),
            colorKey: `${workspace}/${project}`,
          }}
          task={task === undefined ? undefined : { key: task.key, title: task.title }}
          page={
            scope === "project-aggregate"
              ? "Current project context"
              : scope === "project"
                ? "Shared context"
                : "Task context"
          }
          state={headerState}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-wrap">
            <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6 px-4 py-6 sm:px-7">
              <div className="flex max-w-3xl flex-col gap-5">
                {comparing === null || environmentId === null ? null : (
                  <section aria-label="Compare versions" className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <PeerSectionLabel>
                        Comparing v{comparing.from} → v{comparing.to}
                      </PeerSectionLabel>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          void navigate({
                            to: "/context/$workspace/$project/$scope",
                            params: { workspace, project, scope },
                            search: {},
                            replace: true,
                          })
                        }
                      >
                        Close
                      </Button>
                    </div>
                    <ContextComparison
                      key={`${comparing.from}:${comparing.to}`}
                      {...{ environmentId, workspace, project, scope }}
                      readVersion={comparing.from}
                      currentVersion={comparing.to}
                      readLabel="Earlier"
                    />
                  </section>
                )}
                {environmentId === null ||
                compare === undefined ||
                !Number.isSafeInteger(compare) ||
                compare < 1 ? null : (
                  <ExactContextSource
                    environmentId={environmentId}
                    workspace={workspace}
                    project={project}
                    scope={scope}
                    version={compare}
                  />
                )}
                <div>
                  <Button size="sm" variant="outline" onClick={currentView.refresh}>
                    Refresh current context
                  </Button>
                </div>
                {currentView.error === null ? null : (
                  <div role="status" className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">{currentView.error}</p>
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onPageInputs();
                          onPageFindings();
                        }}
                      >
                        Restart evidence pages
                      </Button>
                    </div>
                  </div>
                )}
                {currentView.data != null ? (
                  <CurrentContextReport
                    view={currentView.data}
                    {...{ onPageInputs, onPageFindings, onOpenSource }}
                  />
                ) : null}
                {scope === "project-aggregate" ? null : context === undefined ? (
                  <p className="text-sm text-muted-foreground">
                    No shared context yet. The first agent on this work starts one and keeps it.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {keeperLine(context)}
                      {context.tokens > 0 ? ` · ${contextSize(context.tokens)}` : ""}
                    </p>
                    {read.data === null && read.error === null ? (
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading context…
                      </p>
                    ) : read.data == null && read.error !== null ? (
                      <p className="text-sm text-muted-foreground">{read.error}</p>
                    ) : text.trim() === "" ? (
                      <p className="text-sm text-muted-foreground">Nobody has written it yet.</p>
                    ) : (
                      <ChatMarkdown text={text} cwd={undefined} />
                    )}
                  </>
                )}
                <div className="flex flex-col divide-y divide-border *:py-5 *:first:pt-0 *:last:pb-0 empty:hidden">
                  {environmentId === null || status === null ? null : (
                    <HandoffChatContext value={chat}>
                      {plugins.map(({ id, taskContext: Section }) =>
                        Section === undefined ? null : (
                          <Section
                            key={id}
                            environmentId={environmentId}
                            status={status}
                            workspace={workspace}
                            project={project}
                            scope={scope}
                            contextText={context === undefined ? null : text}
                          />
                        ),
                      )}
                    </HandoffChatContext>
                  )}
                </div>
                {environmentId === null ? null : (
                  <SharedInputs
                    environmentId={environmentId}
                    workspace={workspace}
                    project={project}
                    sessions={workSessions}
                    tasks={state?.work.tasks ?? []}
                  />
                )}
                {agents.length === 0 ? null : (
                  <section aria-label="Conversations" className="flex flex-col gap-2">
                    <PeerSectionLabel>Conversations · {agents.length}</PeerSectionLabel>
                    <ul className="flex flex-col">
                      {agents.map((thread) => (
                        <AgentRow key={thread.key} thread={thread} onOpen={actions.open} />
                      ))}
                    </ul>
                  </section>
                )}
                {advice.length === 0 ? null : (
                  <Advice
                    rows={advice}
                    onOpenWork={(work) =>
                      void navigate({
                        to: "/context/$workspace/$project/$scope",
                        params: { workspace, project, scope: work },
                      })
                    }
                  />
                )}
                {environmentId === null ? null : (
                  <PeerCoordTimeline
                    environmentId={environmentId}
                    workspace={workspace}
                    project={project}
                    projectName={node?.name ?? state?.project.name ?? project}
                    {...(status === null ? {} : { computerPolicy: status.coordination.policy })}
                    {...(scope.startsWith("task:") ? { task: scope.slice(5) } : {})}
                    revision={
                      status?.coordination.overlaps
                        .filter(
                          (overlap) =>
                            overlap.workspace === workspace && overlap.project === project,
                        )
                        .map((overlap) => overlap.updatedAt)
                        .join(":") +
                      ":" +
                      context?.version
                    }
                    sessions={projectSessions}
                    tasks={state?.work.tasks ?? []}
                  />
                )}
              </div>
            </div>
            <aside
              aria-label="On this work"
              className="flex min-w-0 flex-[1_1_300px] flex-col gap-6 border-l border-border bg-card/40 px-5 py-6"
            >
              <ContextArchive
                environmentId={environmentId}
                workspace={workspace}
                project={project}
                revision={contextViewRevision(status, workspace, project)}
                onOpen={(scope) =>
                  void navigate({
                    to: "/context/$workspace/$project/$scope",
                    params: { workspace, project, scope },
                    search: {},
                  })
                }
              />
              {context === undefined ? null : <Reports context={context} />}
              {environmentId === null || status === null ? null : (
                <ContextAgents
                  environmentId={environmentId}
                  status={status}
                  place={{ workspace, project, scope }}
                  latest={context?.version ?? 0}
                />
              )}
              {context === undefined || context.version === 0 || environmentId === null ? null : (
                <History
                  environmentId={environmentId}
                  place={{ workspace, project, scope }}
                  current={context.version}
                  state={state}
                  onRestore={(version) => void restore(version)}
                />
              )}
            </aside>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function keeperLine(context: WorkContextNode): string {
  const keeper = context.keeper;
  return [
    keeper === undefined
      ? "Nobody keeps it now"
      : `${keeper.mine ? "Your agent" : `${keeper.person}’s agent`} keeps it${keeper.label === undefined ? "" : ` (${keeper.label})`}`,
    context.version === 0 ? undefined : `updated ${formatRelativeTimeLabel(context.updatedAt)}`,
    context.restoredFrom === undefined ? undefined : `restored from v${context.restoredFrom}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the work's agents found that the context's keeper has not decided yet. */
function Reports({ context }: { readonly context: WorkContextNode }) {
  return (
    <section aria-label="For the team" className="flex flex-col gap-2.5">
      <PeerSectionLabel
        after={
          context.reports.length === 0 ? undefined : (
            <Badge variant="knowledge" size="sm">
              {context.reports.length} waiting
            </Badge>
          )
        }
      >
        For the team
      </PeerSectionLabel>
      {context.reports.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing waits for the keeper. What the work&apos;s agents find goes to the agent keeping
          it until it incorporates or dismisses it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {context.reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3.5 py-3"
            >
              <p className="text-sm text-foreground">{report.text}</p>
              <p className="text-xs text-muted-foreground">
                {report.person}’s agent · {formatRelativeTimeLabel(report.at)} · waits for the
                keeper
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The agents on the work: the one keeping its context, and those reading it with what they read. */
function ContextAgents({
  environmentId,
  status,
  place,
  latest,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly place: Place;
  readonly latest: number;
}) {
  const agents = contextAgents(status, place);
  return (
    <section aria-label="Agents on this work" className="flex flex-col gap-2.5">
      <PeerSectionLabel>
        {place.scope === "project" ? "Agents on this work" : "Agents on this task"}
      </PeerSectionLabel>
      {agents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No agent works on it now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((agent) => (
            <ContextAgentRow
              key={agent.session}
              environmentId={environmentId}
              place={place}
              agent={agent}
              latest={latest}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ContextAgentRow({
  environmentId,
  place,
  agent,
  latest,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: Place;
  readonly agent: ContextAgent;
  readonly latest: number;
}) {
  // The same read the Shared inputs section asks for, so it is asked once.
  const reads = useEnvironmentQuery(
    agent.role === "keeps" || agent.environment === undefined
      ? null
      : serverEnvironment.peerHubStaleReads({
          environmentId,
          input: {
            workspace: place.workspace,
            project: place.project,
            session: agent.session,
            environment: agent.environment,
          },
        }),
  );
  const { read, behind } = readState(reads.data ?? null, place.scope, latest);
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-3xs font-semibold",
          agent.mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {agent.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{agent.name}</span>
      <Badge variant={agent.role === "keeps" ? "knowledge" : "secondary"} size="sm">
        {agent.role === "keeps" ? "keeps it" : "reads"}
      </Badge>
      <span
        className={cn(
          "shrink-0 text-xs",
          agent.role === "keeps"
            ? TONE_TEXT[agent.status === "working" ? "working" : "neutral"]
            : behind
              ? "text-warning-foreground"
              : read === undefined
                ? "text-muted-foreground"
                : "text-success-foreground",
        )}
      >
        {agent.role === "keeps"
          ? STATUS_LABEL[agent.status]
          : read === undefined
            ? "not read yet"
            : behind
              ? `Read v${read} · behind`
              : `Read v${read} · up to date`}
      </span>
    </li>
  );
}

/**
 * What this work's agents did with the team's work and the project's knowledge: which contexts they
 * read, whose agents they asked, what a model they asked pointed them to, and which decision of the
 * project governs files they change. The agents choose from an index Peer gives them; people see
 * here what they relied on, to trust it or to correct it.
 */
function Advice({
  rows,
  onOpenWork,
}: {
  readonly rows: ReadonlyArray<WorkAdviceRow>;
  readonly onOpenWork: (scope: string) => void;
}) {
  return (
    <section aria-label="What these agents looked at">
      <PeerSectionLabel>What these agents looked at · {rows.length}</PeerSectionLabel>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.key} className="flex min-w-0 items-start gap-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{row.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {adviceLabel(row)} · {formatRelativeTimeLabel(row.at)}
              </span>
              {row.why === "" ? null : (
                <span className="line-clamp-2 block text-xs text-muted-foreground">{row.why}</span>
              )}
              {row.path === undefined ? null : (
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {row.path}
                </span>
              )}
            </span>
            {row.about === "work" ? (
              <Button size="xs" variant="outline" onClick={() => onOpenWork(row.scope)}>
                Open
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentRow({
  thread,
  onOpen,
}: {
  readonly thread: WorkThreadNode;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const open = thread.open;
  return (
    <li className="flex min-w-0 items-center gap-2 py-1.5">
      <StatusGlyph status={thread.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{thread.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[
            thread.mine ? "You" : thread.person,
            thread.keepsContext ? "keeps the context" : null,
            thread.harness,
            thread.branch,
            thread.stale ? "not reporting" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {thread.concerns === undefined ? null : (
          <span className="block truncate text-xs text-warning-foreground">{thread.concerns}</span>
        )}
      </span>
      {open === undefined ? null : (
        <Button size="xs" variant="outline" onClick={() => onOpen(open)}>
          {open.kind === "observe" ? "Watch" : "Open"}
        </Button>
      )}
    </li>
  );
}

/**
 * The versions the hub keeps, folded until opened: who wrote each and how many
 * lines it added and dropped; one opened shows those lines and can be brought
 * back. The keeper compacts freely because of it, and people see what changed.
 */
function History({
  environmentId,
  place,
  current,
  state,
  onRestore,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: Place;
  readonly current: number;
  readonly state: PeerProjectState | undefined;
  readonly onRestore: (version: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const versions = useEnvironmentQuery(
    serverEnvironment.peerHubContextVersions({
      environmentId,
      input: { ...place, version: current },
    }),
  );
  const name = (email: string | undefined) =>
    email === undefined ? "Someone" : state === undefined ? email : personName(state, email);
  const author = (version: PeerContextVersion) =>
    version.session === undefined && version.restoredFrom !== undefined
      ? `${name(version.by)} brought v${version.restoredFrom} back`
      : `${name(version.by)}’s agent`;
  return (
    <section aria-label="Versions" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Versions</PeerSectionLabel>
      {versions.data == null ? (
        <p className="text-xs text-muted-foreground">{versions.error ?? "Loading…"}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.data.map((version) => (
            <li key={version.version} className="flex flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-expanded={selected === version.version}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 text-left text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() =>
                    setSelected((value) => (value === version.version ? null : version.version))
                  }
                >
                  <span className="w-7 shrink-0 font-semibold text-foreground tabular-nums">
                    v{version.version}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {author(version)} · +{version.added} −{version.dropped}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTimeLabel(version.at)}
                  </span>
                </button>
                {version.version === current ? (
                  <Badge variant="secondary" size="sm">
                    latest
                  </Badge>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => onRestore(version.version)}>
                    Restore
                  </Button>
                )}
              </div>
              {selected === version.version ? (
                <VersionChanges
                  environmentId={environmentId}
                  place={place}
                  version={version.version}
                  current={current}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The lines one version added and dropped. */
function VersionChanges({
  environmentId,
  place,
  version,
  current,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: Place;
  readonly version: number;
  readonly current: number;
}) {
  const read = useEnvironmentQuery(
    serverEnvironment.peerHubReadContextVersion({
      environmentId,
      input: { ...place, version },
    }),
  );
  const data = read.data;
  return (
    <div className="mb-2 ml-2 flex flex-col gap-2 border-l border-border pl-3">
      {data == null ? (
        <p className="text-xs text-muted-foreground">{read.error ?? "Loading…"}</p>
      ) : (
        <>
          {data.added.length + data.dropped.length === 0 ? (
            <p className="text-xs text-muted-foreground">No lines changed.</p>
          ) : (
            <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {data.added.length === 0 ? null : (
                <p className="text-success">{data.added.map((line) => `+ ${line}`).join("\n")}</p>
              )}
              {data.dropped.length === 0 ? null : (
                <p className="text-destructive">
                  {data.dropped.map((line) => `− ${line}`).join("\n")}
                </p>
              )}
            </div>
          )}
          {version === current ? null : (
            <p className="text-xs text-muted-foreground">
              Restore makes it the newest version; the agent keeping the context goes on from it.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ContextArchive({
  environmentId,
  workspace,
  project,
  revision,
  onOpen,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly workspace: string;
  readonly project: string;
  readonly revision: string;
  readonly onOpen: (scope: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const read = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.peerHubContextArchive({
          environmentId,
          input: {
            workspace,
            project,
            revision,
            history: true,
            topic,
            limit: 20,
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
  );
  return (
    <section aria-label="Project context archive" className="flex min-w-0 flex-col gap-3">
      <PeerSectionLabel>Project context archive</PeerSectionLabel>
      <div>
        <Button size="xs" variant="outline" onClick={read.refresh}>
          Refresh archive
        </Button>
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={() => onOpen("project-aggregate")}>
          Current project context
        </Button>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Find a topic
        <input
          type="search"
          value={topic}
          onChange={(event) => {
            setTopic(event.target.value);
            setCursor(undefined);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      </label>
      {read.error === null || cursor === undefined ? null : (
        <div>
          <Button size="xs" variant="outline" onClick={() => setCursor(undefined)}>
            Restart archive
          </Button>
        </div>
      )}
      {read.data == null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {read.error ?? "Loading archive…"}
        </p>
      ) : (
        <>
          {read.data.availability === "unavailable" || read.data.availability === "disabled" ? (
            <p role="status" className="text-xs text-muted-foreground">
              The archive is {read.data.availability}. Cached entries may be incomplete.
            </p>
          ) : null}
          {read.data.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching work.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {read.data.entries.map((entry) => (
                <li key={entry.scope}>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.scope)}
                    className="w-full rounded-md text-left text-sm text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {entry.title}
                    {entry.closed ? " · closed" : ""}
                    {entry.revision === null ? "" : ` · v${entry.revision}`}
                  </button>
                  {entry.gist === null ? null : (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{entry.gist}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {cursor === undefined ? null : (
              <Button size="xs" variant="outline" onClick={() => setCursor(undefined)}>
                Start again
              </Button>
            )}
            {read.data.coverage.nextCursor === null ? null : (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setCursor(read.data!.coverage.nextCursor!)}
              >
                More · {read.data.coverage.omittedCount}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ExactContextSource({
  environmentId,
  workspace,
  project,
  scope,
  version,
}: Place & { readonly environmentId: EnvironmentId; readonly version: number }) {
  const read = useEnvironmentQuery(
    serverEnvironment.peerHubReadContextVersion({
      environmentId,
      input: { workspace, project, scope, version },
    }),
  );
  return (
    <section aria-label={`Source version ${version}`} className="flex flex-col gap-3">
      <PeerSectionLabel>Source v{version} · historical snapshot</PeerSectionLabel>
      {read.data == null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {read.error ??
            (read.isPending
              ? "Loading exact source revision…"
              : "This source revision is unavailable; an exact comparison is not possible.")}
        </p>
      ) : (
        <ChatMarkdown text={read.data.text} cwd={undefined} />
      )}
    </section>
  );
}
