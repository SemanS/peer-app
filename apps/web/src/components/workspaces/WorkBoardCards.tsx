import { staleInputLine } from "@t3tools/client-runtime/coordinationTimeline";
import { ownerLine } from "@t3tools/client-runtime/peer/ownership";
import type { PeerHubStatus } from "@t3tools/contracts";
import { FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { activeLabel, agentLook, PersonMark, type WorkHere } from "./marks";
import { TaskKey } from "./PeerPageHeader";
import { ProjectMark, TONE_TEXT, type SignalTone } from "./signals";
import {
  projectScopeKey,
  taskHandoff,
  taskTarget,
  taskWhy,
  type ChatNeedCard,
  type NeedCard,
  type TaskPerson,
  type TaskStateKind,
  type TaskTarget,
  type WorkTaskCard,
} from "./workBoard.logic";
import { ownerCallCard } from "./ownership/ownerDecision.logic";
import { taskOverlap } from "./workGroups.logic";
import { chatsLabel, taskStateTone } from "./workList.logic";
import { personName, type WorkThreadNode } from "./workTree.logic";

type RequestCard = Extract<NeedCard, { readonly kind: "request" }>;
type OverlapCard = Extract<NeedCard, { readonly kind: "overlap" }>;
export type OwnerCallCard = Extract<NeedCard, { readonly kind: "owner-call" }>;

/** What a card does when the person acts on it, as the board hands it down. */
export interface CardActions {
  /** Opens a task: its review, or a chat of its. Every card and row goes through this. */
  readonly openTarget: (target: TaskTarget) => void;
  readonly openContext: (card: NeedCard) => void;
  readonly openOverlap: (card: OverlapCard) => void;
  /** Opens the page of an overlap a task's agents are in. */
  readonly openOverlapPage: (place: {
    readonly workspace: string;
    readonly project: string;
    readonly overlap: string;
  }) => void;
  readonly openRequest: (card: RequestCard, view: "accept" | "decline") => void;
  /** Opens the dialog that accepts or declines an owner's call with a note. */
  readonly openOwnerCall: (card: OwnerCallCard, decision: "accept" | "decline") => void;
  /** Takes back an owner's call the person's own agent opened. */
  readonly withdrawOwnerCall: (card: OwnerCallCard) => void;
}

const STATE_DOT: Readonly<Record<TaskStateKind, string>> = {
  review: "border-warning bg-warning",
  approval: "border-warning bg-warning",
  input: "border-warning bg-warning",
  working: "border-info bg-info",
  waiting: "border-info",
  paused: "border-muted-foreground/60 bg-muted-foreground/60",
  new: "border-muted-foreground/70",
  done: "border-success bg-success",
};

/** A state's dot: filled while it is on the way, hollow while nobody is on it, in its tone. */
export function StateDot({ kind }: { readonly kind: TaskStateKind }) {
  return (
    <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full border-2", STATE_DOT[kind])} />
  );
}

/** The people with chats on a task, as their marks; their names on hover. */
export function PeopleStack({ people }: { readonly people: ReadonlyArray<TaskPerson> }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  return (
    <span
      role="img"
      aria-label={people
        .map((person) => (person.mine ? `${person.name} (you)` : person.name))
        .join(", ")}
      className="relative flex items-center -space-x-1"
    >
      {shown.map((person) => (
        <Tooltip key={`${person.mine}:${person.name}`}>
          <TooltipTrigger render={<span className="flex rounded-full ring-2 ring-card" />}>
            <PersonMark name={person.name} mine={person.mine} />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {person.mine ? `${person.name} (you)` : person.name}
          </TooltipPopup>
        </Tooltip>
      ))}
      {more > 0 ? (
        <span className="pl-2 text-xs text-muted-foreground tabular-nums">+{more}</span>
      ) : null}
    </span>
  );
}

/** A shared column surface; only work waiting on a person gets a tinted background. */
function CardFrame({
  tone,
  children,
}: {
  readonly tone: SignalTone | undefined;
  readonly children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl p-5",
        tone === "needs"
          ? "bg-warning/6"
          : tone === "team"
            ? "bg-peer-team/6"
            : tone === "coordination"
              ? "bg-peer-coordination/6"
              : "rounded-none px-0",
      )}
    >
      {children}
    </article>
  );
}

function CardButtons({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5 pt-0.5">{children}</div>;
}

/** The title of a card that opens something; plain text when there is nothing to open. */
function OpenTitle({
  title,
  target,
  onOpen,
}: {
  readonly title: string;
  readonly target: TaskTarget | null;
  readonly onOpen: (target: TaskTarget) => void;
}) {
  return target === null ? (
    <span className="[overflow-wrap:anywhere]">{title}</span>
  ) : (
    <button
      type="button"
      className="block w-full min-w-0 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => onOpen(target)}
    >
      <span className="[overflow-wrap:anywhere]">{title}</span>
    </button>
  );
}

/** "Claude", whatever the case the agent reported itself in. */
function agentName(thread: WorkThreadNode, here: WorkHere): string | undefined {
  const name = agentLook(thread.agent, here.providers)?.displayName.trim();
  return name === undefined || name === ""
    ? undefined
    : `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** The top line of a card of a task: its key and area, and its project while all projects show. */
function TaskPlace({
  card,
  showProject,
}: {
  readonly card: WorkTaskCard;
  readonly showProject: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {showProject ? (
        <>
          <ProjectMark
            name={card.project.name}
            colorKey={projectScopeKey(card.project)}
            className="size-3.5"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">{card.project.name}</span>
        </>
      ) : null}
      <span className="flex-1" />
      {card.task.key === undefined ? null : <TaskKey>{card.task.key}</TaskKey>}
      {showProject || card.area === null ? null : <span>{card.area}</span>}
    </div>
  );
}

/**
 * A task on the board: where it is (key, area), its title that opens it, its state and one line of
 * why, who is on it and how many chats it has, and, when it waits on the person, the one thing it
 * asks of them.
 */
export function TaskCardView({
  card,
  here,
  status,
  showProject,
  actions,
}: {
  readonly card: WorkTaskCard;
  readonly here: WorkHere;
  readonly status: PeerHubStatus;
  readonly showProject: boolean;
  readonly actions: CardActions;
}) {
  const why = taskWhy(card, {
    handoff: taskHandoff(status, card.project, card.task),
    agentName: (thread) => agentName(thread, here),
  });
  const action = card.action;
  // The same orange mark the task's row in the sidebar carries, opening the same page.
  const overlap = taskOverlap(status, card.project, card.task.id);
  return (
    <CardFrame tone={card.column === "needs" ? "needs" : undefined}>
      <TaskPlace card={card} showProject={showProject} />
      <h3 className="text-base leading-snug font-semibold tracking-tight text-foreground">
        <OpenTitle title={card.task.title} target={taskTarget(card)} onOpen={actions.openTarget} />
      </h3>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
        <p
          className={cn(
            "flex items-center gap-1.5 font-medium",
            TONE_TEXT[taskStateTone(card.state.kind)],
          )}
        >
          <StateDot kind={card.state.kind} />
          {card.state.label}
        </p>
        <p className="text-muted-foreground">
          {why.text}
          {why.at === undefined ? "" : ` · ${formatRelativeTimeLabel(why.at)}`}
        </p>
        {overlap === undefined ? null : (
          <button
            type="button"
            className={cn(
              "self-start rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              TONE_TEXT.coordination,
            )}
            onClick={() =>
              actions.openOverlapPage({
                workspace: card.project.workspace,
                project: card.project.projectId,
                overlap: overlap.id,
              })
            }
          >
            {overlap.label}
          </button>
        )}
      </div>
      {card.project.ownership === undefined ? null : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PersonMark name={card.owner?.name ?? "–"} mine={card.owner?.mine ?? false} />
          {ownerLine(card.owner)}
        </p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <PeopleStack people={card.people} />
        {card.chats === 0 ? null : (
          <span className="text-xs text-muted-foreground">{chatsLabel(card.chats)}</span>
        )}
        <span className="flex-1" />
        {action === undefined ? null : (
          <Button size="sm" variant="ghost" onClick={() => actions.openTarget(action.target)}>
            {action.label}
          </Button>
        )}
      </div>
    </CardFrame>
  );
}

/** The top line of a card for a request, an overlap or stale inputs: project and task key, and when. */
function NeedPlace({
  card,
  showProject,
}: {
  readonly card: NeedCard | ChatNeedCard;
  readonly showProject: boolean;
}) {
  const when = activeLabel(card.item.since);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {showProject ? (
        <>
          <ProjectMark
            name={card.project.name}
            colorKey={projectScopeKey(card.project)}
            className="size-3.5"
          />
          <span className="truncate text-foreground/80">{card.project.name}</span>
        </>
      ) : null}
      {card.task?.key === undefined ? null : <TaskKey>{card.task.key}</TaskKey>}
      <span className="flex-1" />
      {when === null ? null : <span className="shrink-0 tabular-nums">{when}</span>}
    </div>
  );
}

function PersonChip({ name }: { readonly name: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 pl-0.5 text-xs text-foreground">
      <PersonMark name={name} mine={false} />
      {name}
    </span>
  );
}

/**
 * A card for what waits on the person besides tasks: a request, an overlap, inputs that changed,
 * an agent's call to change a path they own, or a chat of theirs on no task that waits for their
 * approval or answer.
 */
export function NeedCardView({
  card,
  status,
  showProject,
  now,
  actions,
}: {
  readonly card: NeedCard | ChatNeedCard;
  readonly status: PeerHubStatus;
  readonly showProject: boolean;
  /** The clock a call's age and expiry are counted by. */
  readonly now: number;
  readonly actions: CardActions;
}) {
  const title = (
    <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-foreground">
      {card.item.title}
    </h3>
  );
  switch (card.kind) {
    case "request": {
      const sender = personName(status, card.item.workspace, card.item.request.sender);
      return (
        <CardFrame tone="team">
          <NeedPlace card={card} showProject={showProject} />
          {title}
          <p className="text-xs text-peer-team-foreground">
            {sender} asks you for this. Nothing starts until you accept.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <PersonChip name={sender} />
            <Badge variant="team" size="sm">
              Team request
            </Badge>
          </div>
          <CardButtons>
            <Button size="xs" onClick={() => actions.openRequest(card, "accept")}>
              Accept
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => actions.openRequest(card, "decline")}
            >
              Decline
            </Button>
          </CardButtons>
        </CardFrame>
      );
    }
    case "overlap":
      return (
        <CardFrame tone="coordination">
          <NeedPlace card={card} showProject={showProject} />
          {title}
          <p className="text-xs text-peer-coordination-foreground">
            {card.item.participants.join(" + ")} on the same files ·{" "}
            {card.item.phase === "unanswered" ? "no agreement yet" : "needs your decision"}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="coordination" size="sm">
              Overlap
            </Badge>
          </div>
          <CardButtons>
            <Button size="xs" onClick={() => actions.openOverlap(card)}>
              Open overlap
            </Button>
          </CardButtons>
        </CardFrame>
      );
    case "chat": {
      const approval = card.item.need === "approval";
      const open = card.item.open;
      return (
        <CardFrame tone="needs">
          <NeedPlace card={card} showProject={showProject} />
          {title}
          <p className="text-xs text-warning-foreground">
            {approval ? "Needs your approval" : "Asks you a question"} · a chat on no task
          </p>
          <CardButtons>
            <Button size="xs" onClick={() => actions.openTarget({ kind: "chat", open })}>
              {approval ? "Approve" : "Answer"}
            </Button>
          </CardButtons>
        </CardFrame>
      );
    }
    case "stale": {
      const tasks =
        status.workspaces
          .find((workspace) => workspace.slug === card.project.workspace)
          ?.projects.find((project) => project.project.id === card.project.projectId)?.work.tasks ??
        [];
      return (
        <CardFrame tone="needs">
          <NeedPlace card={card} showProject={showProject} />
          {title}
          <p className="text-xs font-medium text-warning-foreground">Inputs changed</p>
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {card.item.stale.scopes.map((input) => (
              <li key={input.scope}>{staleInputLine(input, tasks)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Agent must update these inputs before handoff.
          </p>
          <CardButtons>
            <Button size="xs" variant="outline" onClick={() => actions.openContext(card)}>
              <FileTextIcon aria-hidden className="text-peer-knowledge-foreground" />
              Task context
            </Button>
          </CardButtons>
        </CardFrame>
      );
    }
    case "owner-call": {
      const model = ownerCallCard({ ownership: card.project.ownership, item: card.item, now });
      return (
        <CardFrame
          tone={model.stand === "decide" || model.stand === "on-behalf" ? "needs" : undefined}
        >
          <NeedPlace card={card} showProject={showProject} />
          <div className="flex items-start gap-2">
            {model.stand === "decide" ? (
              <span className="mt-0.5 flex">
                <PersonMark name={card.item.asker} mine={false} />
              </span>
            ) : null}
            <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-foreground">
              {model.title}
            </h3>
          </div>
          {card.task === undefined ? null : (
            <p className="line-clamp-1 text-xs text-muted-foreground">{card.task.title}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {model.paths.map((path) => (
              <li key={path} className="font-mono text-xs break-all text-foreground">
                {path}
              </li>
            ))}
            {model.morePaths === 0 ? null : (
              <li className="text-xs text-muted-foreground">and {model.morePaths} more</li>
            )}
          </ul>
          <blockquote className="flex flex-col gap-1 rounded-lg bg-muted/60 px-2.5 py-2 text-sm break-words text-foreground">
            <span>{`“${model.reason}”`}</span>
            <span className="text-2xs text-muted-foreground">{model.meta}</span>
          </blockquote>
          {model.explanation === undefined ? null : (
            <p className="text-xs text-muted-foreground">{model.explanation}</p>
          )}
          <CardButtons>
            {model.accept === undefined ? null : (
              <Button
                size="xs"
                disabled={model.accept.disabled}
                onClick={() => actions.openOwnerCall(card, "accept")}
              >
                {model.accept.label}
              </Button>
            )}
            {model.decline === undefined ? null : (
              <Button
                size="xs"
                variant="outline"
                onClick={() => actions.openOwnerCall(card, "decline")}
              >
                {model.decline.label}
              </Button>
            )}
            {model.withdraw ? (
              <Button size="xs" variant="outline" onClick={() => actions.withdrawOwnerCall(card)}>
                Withdraw
              </Button>
            ) : null}
          </CardButtons>
        </CardFrame>
      );
    }
  }
}
