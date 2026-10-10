import {
  workingAgents,
  needsYouCardCopy,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { RequestsInbox } from "./requests/TeamRequests";
import { StaleInputsCard } from "./needs-you/StaleInputsCard";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import { cn } from "../../lib/utils";
import { agentLook, AgentMark, WorkHereContext } from "./marks";
import type { PeerWebPlugin } from "./slots.types";
import { needsYouCount, needsYouEmptyText } from "./slots.logic";
import { ProjectMark, SignalCount } from "./signals";
import { StatusGlyph } from "./workStatus";
import { type ActiveAgentNode, type AgentNeed, openKey, type WorkOpen } from "./workTree.logic";

function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

const NEED: Readonly<
  Record<AgentNeed, { readonly label: string; readonly icon: LucideIcon; readonly tone: string }>
> = {
  approval: { label: "Needs approval", icon: ShieldQuestionIcon, tone: "text-warning-foreground" },
  input: { label: "Needs input", icon: MessageCircleQuestionIcon, tone: "text-warning-foreground" },
  review: { label: "Finished", icon: CircleCheckIcon, tone: "text-success" },
};

/**
 * What on this computer waits on you — an approval, an answer, finished work
 * to look at — with what merely runs folded away below it.
 */
export function NeedsYou({
  environmentId,
  status,
  plugins,
  agents,
  items,
  activeThread,
  onOpen,
  projectOf,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly status: PeerHubStatus | null;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly agents: ReadonlyArray<ActiveAgentNode>;
  readonly items: ReadonlyArray<NeedsYouItem>;
  readonly activeThread: string | null;
  readonly onOpen: (open: WorkOpen) => void;
  /** The project a card's work is in, by what it opens, to mark it while all projects show. */
  readonly projectOf?: ((openKey: string) => ProjectTag | undefined) | undefined;
}) {
  const [showRunning, setShowRunning] = useState(false);
  const pluginCount =
    status === null
      ? 0
      : needsYouCount(
          plugins.filter((plugin) => plugin.id !== "requests"),
          status,
        );
  const byOpen = new Map(agents.map((agent) => [openKey(agent.open), agent]));
  const running = workingAgents(agents);
  return (
    <section aria-label="Needs you">
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          Needs you
          <SignalCount tone="needs" count={items.length + pluginCount} label="need you" />
        </span>
      </SectionLabel>
      {items.length === 0 && pluginCount === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          {needsYouEmptyText(plugins, status, running.length)}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            if (item.kind === "stale")
              return <StaleInputsCard key={item.key} item={item} onOpen={onOpen} />;
            if (item.kind === "request")
              return environmentId && status ? (
                <li key={item.key} className="list-none">
                  <RequestsInbox
                    environmentId={environmentId}
                    status={{
                      ...status,
                      requests: [{ workspace: item.workspace, request: item.request }],
                    }}
                    plugins={plugins}
                  />
                </li>
              ) : null;
            if (item.kind === "overlap")
              return (
                <li key={item.key} className="my-1 rounded-md border border-sidebar-border p-2.5">
                  <p className="text-xs font-medium text-warning-foreground">
                    {needsYouCardCopy(item).label}
                  </p>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.participants.join(" + ")}</p>
                  <button
                    type="button"
                    className="mt-1 text-xs underline"
                    onClick={() =>
                      document.getElementById("peer-overlaps")?.scrollIntoView({ block: "nearest" })
                    }
                  >
                    Review overlap
                  </button>
                </li>
              );
            const agent = byOpen.get(openKey(item.open));
            return agent ? (
              <NeedCard
                key={item.key}
                agent={agent}
                active={activeThread === openKey(item.open)}
                onOpen={onOpen}
                project={projectOf?.(openKey(item.open))}
              />
            ) : null;
          })}
        </ul>
      )}
      {environmentId === null || status === null
        ? null
        : plugins
            .filter((plugin) => plugin.id !== "requests")
            .map(({ id, needsYou }) =>
              needsYou?.Component === undefined ? null : (
                <needsYou.Component
                  key={id}
                  environmentId={environmentId}
                  status={status}
                  plugins={plugins}
                />
              ),
            )}
      {environmentId &&
      status &&
      plugins.some((plugin) => plugin.id === "requests") &&
      status.requests?.some(
        (row) => row.request.status === "accepted" && row.request.recipient === status.email,
      ) ? (
        <RequestsInbox
          environmentId={environmentId}
          status={{
            ...status,
            requests: status.requests.filter((row) => row.request.status === "accepted"),
          }}
          plugins={plugins}
        />
      ) : null}
      {running.length > 0 ? (
        <>
          <button
            type="button"
            className="mt-1 flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-row-hover"
            aria-expanded={showRunning}
            onClick={() => setShowRunning((value) => !value)}
          >
            <ChevronRightIcon className={cn("size-3 shrink-0", showRunning && "rotate-90")} />
            <CircleDashedIcon aria-hidden className="size-3.5 shrink-0 text-info" />
            {running.length === 1 ? "1 agent working" : `${running.length} agents working`}
          </button>
          {showRunning ? (
            <ul className="flex flex-col gap-px">
              {running.map((agent) => (
                <li key={agent.key}>
                  <button
                    type="button"
                    className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover"
                    onClick={() => onOpen(agent.open)}
                  >
                    <StatusGlyph status={agent.status} />
                    <RunningProject project={projectOf?.(openKey(agent.open))} />
                    <span className="min-w-0 flex-1 truncate">{agent.title}</span>
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {[agent.harness, agent.where].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Which project a card's work is in: its name and the key its color comes from. */
export interface ProjectTag {
  readonly name: string;
  readonly colorKey: string;
}

function RunningProject({ project }: { readonly project: ProjectTag | undefined }) {
  return project === undefined ? null : (
    <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3.5" />
  );
}

/** One thing that waits on you, as a card like the work tree's threads. */
function NeedCard({
  agent,
  active,
  onOpen,
  project,
}: {
  readonly agent: ActiveAgentNode;
  readonly active: boolean;
  readonly onOpen: (open: WorkOpen) => void;
  readonly project?: ProjectTag | undefined;
}) {
  const here = useContext(WorkHereContext);
  if (agent.needs === undefined) return null;
  const need = NEED[agent.needs];
  const Icon = need.icon;
  const look = agentLook(agent.agent, here.providers);
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative w-full rounded-lg border px-2.5 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "border-sidebar-border bg-sidebar-row-active"
            : "border-sidebar-border/70 bg-sidebar-control-surface hover:bg-sidebar-row-hover",
        )}
        onClick={() => onOpen(agent.open)}
      >
        <span className="flex h-5 min-w-0 items-center gap-1.5 text-xs">
          <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium", need.tone)}>
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {need.label}
          </span>
          <span aria-hidden className="ml-auto inline-flex shrink-0 items-center gap-1.5">
            {agent.open.kind === "herdr" ? (
              <span className="text-2xs text-muted-foreground/70">herdr</span>
            ) : null}
            <AgentMark look={look} />
          </span>
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
          {agent.title}
        </span>
        {agent.where === undefined && project === undefined ? null : (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {project === undefined ? null : (
              <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3.5" />
            )}
            <span className="truncate">{agent.where ?? project?.name}</span>
          </span>
        )}
      </button>
    </li>
  );
}
