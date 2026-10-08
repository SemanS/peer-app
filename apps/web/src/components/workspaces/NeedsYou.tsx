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
import type { PeerWebPlugin } from "./slots";
import { needsYouCount, needsYouEmptyText } from "./slots.logic";
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
  activeThread,
  onOpen,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly status: PeerHubStatus | null;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly agents: ReadonlyArray<ActiveAgentNode>;
  readonly activeThread: string | null;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const [showRunning, setShowRunning] = useState(false);
  const pluginCount = status === null ? 0 : needsYouCount(plugins, status);
  const waiting = agents.filter((agent) => agent.needs !== undefined);
  const running = agents.filter((agent) => agent.needs === undefined);
  return (
    <section aria-label="Needs you">
      <SectionLabel>
        Needs you{waiting.length + pluginCount > 0 ? ` · ${waiting.length + pluginCount}` : ""}
      </SectionLabel>
      {waiting.length === 0 && pluginCount === 0 ? (
        status === null ? null : (
          <p className="px-2 text-xs text-muted-foreground">
            {needsYouEmptyText(plugins, status, running.length)}
          </p>
        )
      ) : (
        <ul className="flex flex-col">
          {waiting.map((agent) => (
            <NeedCard
              key={agent.key}
              agent={agent}
              active={activeThread === openKey(agent.open)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
      {environmentId === null || status === null
        ? null
        : plugins.map(({ id, needsYou }) =>
            needsYou?.Component === undefined ? null : (
              <needsYou.Component
                key={id}
                environmentId={environmentId}
                status={status}
                plugins={plugins}
              />
            ),
          )}
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

/** One thing that waits on you, as a card like the work tree's threads. */
function NeedCard({
  agent,
  active,
  onOpen,
}: {
  readonly agent: ActiveAgentNode;
  readonly active: boolean;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  const here = useContext(WorkHereContext);
  if (agent.needs === undefined) return null;
  const need = NEED[agent.needs];
  const Icon = need.icon;
  const look = agentLook(agent.agent, here.providers);
  return (
    <li className="list-none py-px">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative w-full rounded-md px-2.5 py-1.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
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
        {agent.where === undefined ? null : (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{agent.where}</span>
        )}
      </button>
    </li>
  );
}
