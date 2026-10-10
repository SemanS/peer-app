import {
  needsYouCardCopy,
  personName,
  workingAgents,
} from "@t3tools/client-runtime/peer/needs-you";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CircleDashedIcon,
  FileWarningIcon,
  HourglassIcon,
  InboxIcon,
  LayersIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { activeLabel, WorkSectionLabel } from "./marks";
import { RequestReview } from "./requests/TeamRequests";
import type { PeerWebPlugin } from "./slots.types";
import { NOTHING_NEEDS_YOU, needsYouCount, needsYouEmptyText } from "./slots.logic";
import { ProjectMark, SignalCount, TONE_SURFACE, TONE_TEXT, type SignalTone } from "./signals";
import { StatusGlyph } from "./workStatus";
import { projectScopeKey, type BoardCard } from "./workBoard.logic";
import { type ActiveAgentNode, openKey, type WorkOpen } from "./workTree.logic";

type RequestCard = Extract<BoardCard, { readonly kind: "request" }>;

/**
 * What waits on you, as the Work board's Needs you column lists it for the same projects: your
 * agents waiting for an approval or an answer (here or on your other computer), requests addressed
 * to you, overlaps that need your decision and inputs that changed under your agent. Each card
 * opens the screen where you act on it. Your agents that merely run fold into one line below. With
 * nothing waiting the section is gone, unless a plugin has a hint for the empty state.
 */
export function NeedsYou({
  environmentId,
  status,
  plugins,
  agents,
  cards,
  activeThread,
  onOpen,
  showProject,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly status: PeerHubStatus | null;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  /** Your agents in scope, for the line of those that merely run. */
  readonly agents: ReadonlyArray<ActiveAgentNode>;
  /** The Work board's Needs you cards in scope. */
  readonly cards: ReadonlyArray<BoardCard>;
  readonly activeThread: string | null;
  readonly onOpen: (open: WorkOpen) => void;
  /** Marks each card's project, while all projects show. */
  readonly showProject: boolean;
}) {
  const navigate = useNavigate();
  const [request, setRequest] = useState<RequestCard | null>(null);
  const others = plugins.filter((plugin) => plugin.id !== "requests");
  const pluginCount = status === null ? 0 : needsYouCount(others, status);
  const running = workingAgents(agents);
  const review =
    request === null || environmentId === null || status === null ? null : (
      <RequestReview
        key={request.key}
        environmentId={environmentId}
        status={status}
        plugins={plugins}
        workspace={request.item.workspace}
        request={request.item.request}
        view="accept"
        onClose={() => setRequest(null)}
      />
    );
  if (cards.length === 0 && pluginCount === 0) {
    const hint = needsYouEmptyText(plugins, status, running.length);
    return running.length === 0 && hint === NOTHING_NEEDS_YOU ? (
      review
    ) : (
      <section aria-label="Needs you">
        {hint === NOTHING_NEEDS_YOU ? null : (
          <p className="px-2 text-xs text-muted-foreground">{hint}</p>
        )}
        <RunningAgents running={running} onOpen={onOpen} />
        {review}
      </section>
    );
  }
  return (
    <section aria-label="Needs you">
      <WorkSectionLabel>
        Needs you
        <SignalCount tone="needs" count={cards.length + pluginCount} label="need you" />
      </WorkSectionLabel>
      <ul className="flex flex-col gap-1">
        {cards.map((card) => {
          const project = showProject
            ? { name: card.project.name, colorKey: projectScopeKey(card.project) }
            : undefined;
          switch (card.kind) {
            case "thread": {
              const { thread } = card;
              const open = thread.open;
              const look = threadNeed(card);
              return (
                <NeedCard
                  key={card.key}
                  icon={look.icon}
                  tone="needs"
                  title={thread.title}
                  project={project}
                  label={look.label}
                  since={thread.activeAt}
                  herdr={thread.source === "herdr"}
                  active={open !== undefined && activeThread === openKey(open)}
                  onClick={open === undefined ? undefined : () => onOpen(open)}
                />
              );
            }
            case "request":
              return (
                <NeedCard
                  key={card.key}
                  icon={InboxIcon}
                  tone="team"
                  title={card.item.title}
                  project={project}
                  label={
                    status === null
                      ? "Team request"
                      : `Request from ${personName(status, card.item.workspace, card.item.request.sender)}`
                  }
                  since={card.item.since}
                  onClick={() => setRequest(card)}
                />
              );
            case "overlap": {
              const { overlap } = card.item;
              return (
                <NeedCard
                  key={card.key}
                  icon={LayersIcon}
                  tone="coordination"
                  title={card.item.title}
                  project={project}
                  label={needsYouCardCopy(card.item).label}
                  detail={card.item.participants.join(" + ")}
                  since={card.item.since}
                  onClick={() =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: overlap.workspace,
                        project: overlap.project,
                        overlap: overlap.id,
                      },
                    })
                  }
                />
              );
            }
            case "stale": {
              const open = card.item.open;
              return (
                <NeedCard
                  key={card.key}
                  icon={FileWarningIcon}
                  tone="needs"
                  title={card.item.title}
                  project={project}
                  label="Inputs changed"
                  detail="update before handoff"
                  since={card.item.since}
                  onClick={open === undefined ? undefined : () => onOpen(open)}
                />
              );
            }
          }
        })}
      </ul>
      {environmentId === null || status === null
        ? null
        : others.map(({ id, needsYou }) =>
            needsYou?.Component === undefined ? null : (
              <needsYou.Component
                key={id}
                environmentId={environmentId}
                status={status}
                plugins={plugins}
              />
            ),
          )}
      <RunningAgents running={running} onOpen={onOpen} />
      {review}
    </section>
  );
}

const NEED_LOOK = {
  approval: { label: "Needs approval", icon: ShieldQuestionIcon },
  input: { label: "Needs input", icon: MessageCircleQuestionIcon },
  review: { label: "Finished", icon: ShieldQuestionIcon },
} as const;

/** What your waiting thread waits for, and where, as its card says it. */
function threadNeed(card: Extract<BoardCard, { readonly kind: "thread" }>): {
  readonly label: string;
  readonly icon: LucideIcon;
} {
  if (card.need !== undefined) return NEED_LOOK[card.need];
  return {
    label: card.thread.localEnvironment === true ? "Waits for you" : "On your other computer",
    icon: HourglassIcon,
  };
}

/** Your agents that merely run, folded into one line until opened. */
function RunningAgents({
  running,
  onOpen,
}: {
  readonly running: ReturnType<typeof workingAgents>;
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
        <CircleDashedIcon aria-hidden className="size-3.5 shrink-0 text-info" />
        <span className="min-w-0 flex-1 truncate">
          {running.length === 1
            ? "1 agent of yours working"
            : `${running.length} agents of yours working`}
        </span>
        <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0", open && "rotate-90")} />
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
interface ProjectTag {
  readonly name: string;
  readonly colorKey: string;
}

/**
 * One thing that waits on you: its icon in the signal's color, what it is, and below it the
 * project (while all projects show), what it waits for and since when. A card with nothing to
 * open here (your thread on another computer) only tells.
 */
function NeedCard({
  icon: Icon,
  tone,
  title,
  project,
  label,
  detail,
  since,
  herdr = false,
  active = false,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly tone: SignalTone;
  readonly title: string;
  readonly project: ProjectTag | undefined;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly since: string | undefined;
  readonly herdr?: boolean;
  readonly active?: boolean;
  readonly onClick: (() => void) | undefined;
}) {
  const when = activeLabel(since);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
          TONE_SURFACE[tone],
        )}
      >
        <Icon className={cn("size-3.5", TONE_TEXT[tone])} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {herdr ? <span className="shrink-0 text-2xs text-muted-foreground/70">herdr</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {project === undefined ? null : (
            <>
              <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3" />
              <span className="max-w-20 shrink-0 truncate">{project.name}</span>
            </>
          )}
          <span className={cn("min-w-0 truncate font-medium", TONE_TEXT[tone])}>{label}</span>
          {detail === undefined ? null : <span className="min-w-0 truncate">· {detail}</span>}
          {when === null ? null : <span className="shrink-0">· {when}</span>}
        </span>
      </span>
    </>
  );
  const frame =
    "flex w-full min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left outline-none select-none";
  return (
    <li className="list-none">
      {onClick === undefined ? (
        <div className={cn(frame, "border-sidebar-border/70 bg-sidebar-control-surface")}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className={cn(
            frame,
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            active
              ? "border-sidebar-border bg-sidebar-row-active"
              : "border-sidebar-border/70 bg-sidebar-control-surface hover:bg-sidebar-row-hover",
          )}
          onClick={onClick}
        >
          {body}
        </button>
      )}
    </li>
  );
}
