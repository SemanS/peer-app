import {
  workingAgents,
  needsYouCardCopy,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { RequestsInbox } from "./requests/TeamRequests";
import { StaleInputsCard } from "./needs-you/StaleInputsCard";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LayersIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useContext, useState } from "react";

import { cn } from "../../lib/utils";
import { agentLook, AgentMark, WorkHereContext } from "./marks";
import type { PeerWebPlugin } from "./slots.types";
import { NOTHING_NEEDS_YOU, needsYouCount, needsYouEmptyText } from "./slots.logic";
import { ProjectMark, SignalCount, TONE_SURFACE, TONE_TEXT, type SignalTone } from "./signals";
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
  Record<
    AgentNeed,
    { readonly label: string; readonly icon: LucideIcon; readonly tone: SignalTone }
  >
> = {
  approval: { label: "Needs approval", icon: ShieldQuestionIcon, tone: "needs" },
  input: { label: "Needs input", icon: MessageCircleQuestionIcon, tone: "needs" },
  review: { label: "Finished", icon: CircleCheckIcon, tone: "delivery" },
};

/**
 * What on this computer waits on you — an approval, an answer, finished work
 * to look at — with what merely runs folded away below it while all projects
 * show (one project lists its running work among its tasks). With nothing
 * waiting the section is gone, unless a plugin has a hint for the empty state.
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
  showRunning: listRunning = true,
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
  /** Lists the agents that merely run, folded; off where the tasks already show them. */
  readonly showRunning?: boolean;
}) {
  const navigate = useNavigate();
  const pluginCount =
    status === null
      ? 0
      : needsYouCount(
          plugins.filter((plugin) => plugin.id !== "requests"),
          status,
        );
  const byOpen = new Map(agents.map((agent) => [openKey(agent.open), agent]));
  const running = listRunning ? workingAgents(agents) : [];
  if (items.length === 0 && pluginCount === 0) {
    const hint = needsYouEmptyText(plugins, status, workingAgents(agents).length);
    return running.length === 0 && hint === NOTHING_NEEDS_YOU ? null : (
      <section aria-label="Needs you">
        {hint === NOTHING_NEEDS_YOU ? null : (
          <p className="px-2 text-xs text-muted-foreground">{hint}</p>
        )}
        <RunningAgents running={running} projectOf={projectOf} onOpen={onOpen} />
      </section>
    );
  }
  return (
    <section aria-label="Needs you">
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          Needs you
          <SignalCount tone="needs" count={items.length + pluginCount} label="need you" />
        </span>
      </SectionLabel>
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
              <li key={item.key} className="list-none">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-sidebar-border/70 bg-sidebar-control-surface px-2.5 py-2 text-left outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: item.overlap.workspace,
                        project: item.overlap.project,
                        overlap: item.overlap.id,
                      },
                    })
                  }
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
                      TONE_SURFACE.coordination,
                    )}
                  >
                    <LayersIcon className="size-3.5 text-peer-coordination-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs">
                      <span className="shrink-0 font-medium text-peer-coordination-foreground">
                        {needsYouCardCopy(item).label}
                      </span>
                      <span className="truncate text-muted-foreground">
                        · {item.participants.join(" + ")}
                      </span>
                    </span>
                  </span>
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
      <RunningAgents running={running} projectOf={projectOf} onOpen={onOpen} />
    </section>
  );
}

/** The agents that merely run, folded into one line until opened. */
function RunningAgents({
  running,
  projectOf,
  onOpen,
}: {
  readonly running: ReturnType<typeof workingAgents>;
  readonly projectOf: ((openKey: string) => ProjectTag | undefined) | undefined;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const [open, setOpen] = useState(false);
  if (running.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="mt-1 flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-row-hover"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon className={cn("size-3 shrink-0", open && "rotate-90")} />
        <CircleDashedIcon aria-hidden className="size-3.5 shrink-0 text-info" />
        {running.length === 1 ? "1 agent working" : `${running.length} agents working`}
      </button>
      {open ? (
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
          "flex w-full min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          active
            ? "border-sidebar-border bg-sidebar-row-active"
            : "border-sidebar-border/70 bg-sidebar-control-surface hover:bg-sidebar-row-hover",
        )}
        onClick={() => onOpen(agent.open)}
      >
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
            TONE_SURFACE[need.tone],
          )}
        >
          <Icon className={cn("size-3.5", TONE_TEXT[need.tone])} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {agent.title}
            </span>
            <span aria-hidden className="inline-flex shrink-0 items-center gap-1.5">
              {agent.open.kind === "herdr" ? (
                <span className="text-2xs text-muted-foreground/70">herdr</span>
              ) : null}
              <AgentMark look={look} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {project === undefined ? null : (
              <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3" />
            )}
            {agent.where === undefined && project === undefined ? null : (
              <span className="max-w-28 shrink truncate">{agent.where ?? project?.name}</span>
            )}
            <span className={cn("shrink-0 font-medium", TONE_TEXT[need.tone])}>{need.label}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
