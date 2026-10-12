import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon, GitBranchIcon, KanbanSquareIcon, ListIcon, SearchIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { activeLabel, agentLook, AgentMark, PersonMark, type WorkHere } from "./marks";
import { TaskKey } from "./PeerPageHeader";
import { projectSignals } from "./ProjectSignals";
import { RequestReview } from "./requests/TeamRequests";
import { ProjectMark, TONE_BADGE, TONE_TEXT, type SignalTone } from "./signals";
import type { PeerWebPlugin, ProjectSignal } from "./slots.types";
import { useWorkData } from "./useWorkData";
import {
  ALL_PROJECTS,
  BOARD_COLUMNS,
  boardCards,
  boardCardTitle,
  inScope,
  projectCounts,
  projectScopeKey,
  resolveScope,
  type BoardCard,
  type BoardColumn,
} from "./workBoard.logic";
import { WorkNoProjects } from "./WorkNoProjects";
import { AllProjectsMark } from "./WorkScopePicker";
import { useWorkScope } from "./workScope";
import { StatusGlyph } from "./workStatus";
import { personName, type WorkOpen } from "./workTree.logic";

const StoredLayout = Schema.NullOr(Schema.Literals(["board", "list"]));
const StoredWhose = Schema.NullOr(Schema.Literals(["everyone", "mine"]));

type ThreadCard = Extract<BoardCard, { readonly kind: "thread" }>;
type RequestCard = Extract<BoardCard, { readonly kind: "request" }>;

/** The hue of each column's state, as the tree's status glyphs draw it. */
const COLUMN_STATUS = {
  needs: "blocked",
  working: "working",
  review: "done",
  idle: "idle",
} as const satisfies Readonly<Record<BoardColumn, string>>;

const COLUMN_TONE: Readonly<Record<BoardColumn, SignalTone>> = {
  needs: "needs",
  working: "working",
  review: "delivery",
  idle: "neutral",
};

/** What a card does when the person acts on it, as the board hands it down. */
interface CardActions {
  readonly openThread: (open: WorkOpen) => void;
  readonly openContext: (card: BoardCard) => void;
  readonly openReview: (card: BoardCard) => void;
  readonly openOverlap: (card: Extract<BoardCard, { readonly kind: "overlap" }>) => void;
  readonly openRequest: (card: RequestCard, view: "accept" | "decline") => void;
}

/**
 * The Work board: what happens on which project, at a glance. Every thread of the team's projects
 * is a card in its state's column, and the first column is what waits on the person: their
 * threads waiting for an approval or an answer, teammates' requests, overlaps to decide and inputs
 * that changed. The project pills scope it (with the sidebar), and the strip above the columns
 * shows what agents and the team say to each other on those projects.
 */
export function WorkBoard() {
  const { environmentId, status, plugins, tree, here, actions, needs } = useWorkData();
  const navigate = useNavigate();
  const [storedScope, setScope] = useWorkScope();
  const scope = resolveScope(storedScope, tree);
  const [layout, setLayout] = useLocalStorage("peer:work-board-layout", null, StoredLayout);
  const [whose, setWhose] = useLocalStorage("peer:work-board-whose", null, StoredWhose);
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState<{
    readonly card: RequestCard;
    readonly view: "accept" | "decline";
  } | null>(null);
  const mine = whose === "mine";
  const cards = useMemo(
    () => boardCards(tree, { scope, mine, query, needs }),
    [mine, needs, query, scope, tree],
  );
  const current = tree.find((project) => projectScopeKey(project) === scope);
  const signals =
    status === null
      ? []
      : tree
          .filter((project) => inScope(scope, project))
          .flatMap((project) =>
            projectSignals(status, project, plugins)
              .filter((signal) => signal.count !== null && signal.count > 0)
              .map((signal) => ({ project, signal })),
          );
  const count = (column: BoardColumn) => cards.filter((card) => card.column === column).length;
  const threads = cards.filter((card) => card.kind === "thread").length;
  const cardActions: CardActions = {
    openThread: actions.open,
    openContext: (card) => {
      const context = card.task?.context;
      if (context !== undefined) {
        void navigate({
          to: "/context/$workspace/$project/$scope",
          params: { workspace: context.workspace, project: context.project, scope: context.scope },
        });
        return;
      }
      if (card.kind === "stale" && card.item.open?.kind === "context") {
        const open = card.item.open;
        void navigate({
          to: "/context/$workspace/$project/$scope",
          params: { workspace: open.workspace, project: open.project, scope: open.scope },
        });
      }
    },
    openReview: (card) => {
      if (card.task === undefined) return;
      void navigate({
        to: "/review/$workspace/$project/$task",
        params: {
          workspace: card.project.workspace,
          project: card.project.projectId,
          task: card.task.id,
        },
      });
    },
    openOverlap: (card) =>
      void navigate({
        to: "/overlap/$workspace/$project/$overlap",
        params: {
          workspace: card.item.overlap.workspace,
          project: card.item.overlap.project,
          overlap: card.item.overlap.id,
        },
      }),
    openRequest: (card, view) => setRequest({ card, view }),
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <KanbanSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-base font-semibold text-foreground">Work</span>
          <span aria-hidden className="text-muted-foreground/60">
            /
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {current === undefined ? (
              <AllProjectsMark tree={tree} />
            ) : (
              <ProjectMark name={current.name} colorKey={scope} />
            )}
            <span className="truncate font-medium">{current?.name ?? "All projects"}</span>
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {threads} {threads === 1 ? "thread" : "threads"} · {count("needs")} need you ·{" "}
            {count("working")} working
          </span>
        </WorkspacePageHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-8 sm:px-6">
          {status === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : !status.signedIn ? (
            <p className="text-sm text-muted-foreground">
              Sign in with your work email in Settings → Peer to see your team’s work.
            </p>
          ) : tree.length === 0 ? (
            environmentId === null ? null : (
              <WorkNoProjects
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                className="max-w-md"
                fallback={
                  <p className="text-sm text-muted-foreground">
                    No team projects yet. Share one from the sidebar’s Work view.
                  </p>
                }
              />
            )
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <InputGroup className="min-w-48 flex-1 sm:max-w-sm">
                  <InputGroupAddon>
                    <SearchIcon aria-hidden />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search threads, tasks, branches, people"
                    aria-label="Search the Work board"
                  />
                </InputGroup>
                <span className="flex-1" />
                <ToggleGroup
                  aria-label="Whose work"
                  value={[mine ? "mine" : "everyone"]}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "everyone" || value === "mine") setWhose(value);
                  }}
                >
                  <Toggle value="everyone">Everyone</Toggle>
                  <Toggle value="mine">Mine</Toggle>
                </ToggleGroup>
                <ToggleGroup
                  aria-label="Layout"
                  value={[layout ?? "board"]}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "board" || value === "list") setLayout(value);
                  }}
                >
                  <Toggle value="board" aria-label="Board">
                    <KanbanSquareIcon aria-hidden className="size-3.5" />
                    Board
                  </Toggle>
                  <Toggle value="list" aria-label="List">
                    <ListIcon aria-hidden className="size-3.5" />
                    List
                  </Toggle>
                </ToggleGroup>
              </div>

              <nav aria-label="Projects" className="flex flex-wrap gap-1.5">
                <ProjectPill
                  active={scope === ALL_PROJECTS}
                  onClick={() => setScope(ALL_PROJECTS)}
                  mark={<AllProjectsMark tree={tree} />}
                  name="All projects"
                  total={tree.reduce((n, p) => n + sum(projectCounts(p, mine, needs)), 0)}
                  needs={tree.reduce((n, p) => n + projectCounts(p, mine, needs).needs, 0)}
                />
                {tree.map((project) => {
                  const key = projectScopeKey(project);
                  const counts = projectCounts(project, mine, needs);
                  return (
                    <ProjectPill
                      key={key}
                      active={scope === key}
                      onClick={() => setScope(key)}
                      mark={<ProjectMark name={project.name} colorKey={key} />}
                      name={project.name}
                      total={sum(counts)}
                      needs={counts.needs}
                    />
                  );
                })}
              </nav>

              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="mr-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Between agents &amp; team
                </span>
                {signals.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Nothing open right now.</span>
                ) : (
                  signals.map(({ project, signal }) => (
                    <SignalStripChip
                      key={`${projectScopeKey(project)}:${signal.id}`}
                      signal={signal}
                      project={
                        scope === ALL_PROJECTS
                          ? { name: project.name, colorKey: projectScopeKey(project) }
                          : undefined
                      }
                      onOpen={signal.open === undefined ? undefined : () => signal.open?.(navigate)}
                    />
                  ))
                )}
              </div>

              {(layout ?? "board") === "board" ? (
                <div className="overflow-x-auto pb-1">
                  <div className="grid min-w-[60rem] grid-cols-4 items-start gap-3">
                    {BOARD_COLUMNS.map((column) => {
                      const inColumn = cards.filter((card) => card.column === column.id);
                      return (
                        <section
                          key={column.id}
                          aria-label={column.title}
                          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card/50 p-2"
                        >
                          <h2 className="flex items-center gap-2 px-1.5 pt-1 pb-0.5 text-sm font-semibold">
                            <StatusGlyph status={COLUMN_STATUS[column.id]} />
                            {column.title}
                            <span className="text-xs font-normal text-muted-foreground tabular-nums">
                              {inColumn.length}
                            </span>
                          </h2>
                          {inColumn.length === 0 ? (
                            <p className="px-1.5 pb-1.5 text-xs text-muted-foreground">
                              {column.id === "needs" ? "Nothing waits on you." : "Nothing here."}
                            </p>
                          ) : (
                            inColumn.map((card) => (
                              <BoardCardView
                                key={card.key}
                                card={card}
                                here={here}
                                status={status}
                                environmentId={environmentId}
                                plugins={plugins}
                                actions={cardActions}
                              />
                            ))
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <WorkList cards={cards} here={here} actions={cardActions} />
              )}
            </>
          )}
        </div>
      </div>
      {request === null || environmentId === null || status === null ? null : (
        <RequestReview
          key={`${request.card.key}/${request.view}`}
          environmentId={environmentId}
          status={status}
          plugins={plugins}
          workspace={request.card.item.workspace}
          request={request.card.item.request}
          view={request.view}
          onClose={() => setRequest(null)}
        />
      )}
    </SidebarInset>
  );
}

function sum(counts: Readonly<Record<BoardColumn, number>>): number {
  return counts.needs + counts.working + counts.review + counts.idle;
}

function ProjectPill({
  active,
  onClick,
  mark,
  name,
  total,
  needs,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly mark: ReactNode;
  readonly name: string;
  readonly total: number;
  readonly needs: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 pl-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground/25 bg-accent font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {mark}
      <span className="max-w-40 truncate">{name}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
      {needs > 0 ? (
        <span
          aria-label={`${needs} need you`}
          className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning px-1 text-2xs font-semibold text-black tabular-nums"
        >
          {needs}
        </span>
      ) : null}
    </button>
  );
}

function SignalStripChip({
  signal,
  project,
  onOpen,
}: {
  readonly signal: ProjectSignal;
  /** Named while all projects show, so each chip says whose it is. */
  readonly project: { readonly name: string; readonly colorKey: string } | undefined;
  readonly onOpen: (() => void) | undefined;
}) {
  return (
    <Badge
      variant={TONE_BADGE[signal.tone]}
      size="control"
      render={onOpen === undefined ? undefined : <button type="button" onClick={onOpen} />}
    >
      {project === undefined ? (
        <span aria-hidden className={cn("size-2 rounded-xs bg-current", TONE_TEXT[signal.tone])} />
      ) : (
        <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3.5" />
      )}
      <span className="font-semibold">{signal.label}</span>
      <span className="tabular-nums">{signal.count}</span>
      <span className="max-w-56 truncate font-normal text-foreground/80">{signal.detail}</span>
    </Badge>
  );
}

/** The top line of every card: project, task key, and when. */
function CardPlace({ card, when }: { readonly card: BoardCard; readonly when: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <ProjectMark
        name={card.project.name}
        colorKey={projectScopeKey(card.project)}
        className="size-3.5"
      />
      <span className="truncate text-foreground/80">{card.project.name}</span>
      {card.task?.key === undefined ? null : <TaskKey>{card.task.key}</TaskKey>}
      <span className="flex-1" />
      {when === null ? null : <span className="shrink-0 tabular-nums">{when}</span>}
    </div>
  );
}

/** One card of the board, by what it is. */
function BoardCardView({
  card,
  here,
  status,
  environmentId,
  plugins,
  actions,
}: {
  readonly card: BoardCard;
  readonly here: WorkHere;
  readonly status: PeerHubStatus;
  readonly environmentId: EnvironmentId | null;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly actions: CardActions;
}) {
  switch (card.kind) {
    case "thread":
      return (
        <ThreadCardView
          card={card}
          here={here}
          status={status}
          environmentId={environmentId}
          plugins={plugins}
          actions={actions}
        />
      );
    case "request": {
      const sender = personName(status, card.item.workspace, card.item.request.sender);
      return (
        <CardFrame tone="team">
          <CardPlace card={card} when={activeLabel(card.item.since)} />
          <CardTitle>{card.item.title}</CardTitle>
          <p className="text-xs text-peer-team-foreground">
            {sender} asks you for this. Nothing starts until you accept.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <PersonChip name={sender} mine={false} />
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
          <CardPlace card={card} when={activeLabel(card.item.since)} />
          <CardTitle>{card.item.title}</CardTitle>
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
    case "stale":
      return (
        <CardFrame tone="needs">
          <CardPlace card={card} when={activeLabel(card.item.since)} />
          <CardTitle>{card.item.title}</CardTitle>
          <p className="text-xs text-warning-foreground">
            Your agent read inputs that changed since. It updates them before its handoff.
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {card.item.stale.scopes.map((input) => (
              <li key={input.scope}>
                Read v{input.readVersion} ·{" "}
                {input.currentVersion === null ? "removed" : `v${input.currentVersion} now`}
              </li>
            ))}
          </ul>
          <CardButtons>
            <Button size="xs" variant="outline" onClick={() => actions.openContext(card)}>
              <FileTextIcon aria-hidden className="text-peer-knowledge-foreground" />
              Task context
            </Button>
          </CardButtons>
        </CardFrame>
      );
  }
}

const NEED_LINE = {
  approval: "Needs approval",
  input: "Needs input",
  review: "Finished",
} as const;

function ThreadCardView({
  card,
  here,
  status,
  environmentId,
  plugins,
  actions,
}: {
  readonly card: ThreadCard;
  readonly here: WorkHere;
  readonly status: PeerHubStatus;
  readonly environmentId: EnvironmentId | null;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly actions: CardActions;
}) {
  const { thread, project, task } = card;
  const open = thread.open;
  const projectState = status.workspaces
    .find((workspace) => workspace.slug === project.workspace)
    ?.projects.find((state) => state.project.id === project.projectId);
  const inReview = projectState?.work.tasks.find((t) => t.id === task?.id)?.status === "review";
  const look = agentLook(thread.agent, here.providers);
  const line =
    card.column === "needs"
      ? {
          text:
            card.need !== undefined
              ? NEED_LINE[card.need]
              : thread.localEnvironment === true
                ? "Waits for you"
                : "Waits for you on your other computer",
          tone: "text-warning-foreground",
        }
      : card.waitingOn !== undefined
        ? { text: `Waiting on ${card.waitingOn}`, tone: "text-warning-foreground" }
        : thread.concerns !== undefined
          ? { text: thread.concerns, tone: "text-peer-coordination-foreground" }
          : undefined;
  const primary =
    card.column === "needs" && thread.mine && open !== undefined
      ? {
          label: card.need === "input" ? "Answer" : "Review",
          run: () => actions.openThread(open),
        }
      : card.column === "review" && inReview
        ? { label: "Open review", run: () => actions.openReview(card) }
        : undefined;
  return (
    <CardFrame tone={card.column === "needs" ? "needs" : undefined} faded={thread.stale}>
      <CardPlace card={card} when={activeLabel(thread.activeAt)} />
      <CardTitle>{thread.title}</CardTitle>
      {task === undefined ? null : (
        <p className="truncate text-xs text-muted-foreground">On {task.title}</p>
      )}
      {line === undefined ? null : <p className={cn("text-xs", line.tone)}>{line.text}</p>}
      {thread.branch === undefined ? null : (
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{thread.branch}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <PersonChip name={thread.person} mine={thread.mine} />
        {look === null ? null : (
          <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-xs text-muted-foreground">
            <AgentMark look={look} />
            {look.displayName}
          </span>
        )}
        {thread.source === "herdr" ? (
          <Badge variant="secondary" size="sm">
            herdr
          </Badge>
        ) : null}
        {thread.concerns !== undefined ? (
          <Badge variant="coordination" size="sm">
            Overlap
          </Badge>
        ) : null}
        {thread.keepsContext ? (
          <Badge variant="knowledge" size="sm">
            Keeps task context
          </Badge>
        ) : null}
        {thread.observable ? (
          <Badge variant="team" size="sm">
            {thread.mine ? "Shared to watch" : "Watch live"}
          </Badge>
        ) : null}
        {thread.stale ? (
          <Badge variant="secondary" size="sm">
            Away
          </Badge>
        ) : null}
        {task === undefined || environmentId === null
          ? null
          : plugins.map(({ id, taskBadges: Badges }) =>
              Badges === undefined ? null : (
                <Badges
                  key={id}
                  environmentId={environmentId}
                  status={status}
                  workspace={project.workspace}
                  project={projectState}
                  task={task}
                />
              ),
            )}
      </div>
      {primary === undefined && open === undefined && task?.context === undefined ? null : (
        <CardButtons>
          {primary === undefined ? null : (
            <Button size="xs" onClick={primary.run}>
              {primary.label}
            </Button>
          )}
          {open === undefined ? null : (
            <Button
              size="xs"
              variant={primary === undefined ? "outline" : "ghost"}
              onClick={() => actions.openThread(open)}
            >
              {open.kind === "observe" ? "Watch" : "Open thread"}
            </Button>
          )}
          {task?.context === undefined ? null : (
            <Button size="xs" variant="ghost" onClick={() => actions.openContext(card)}>
              <FileTextIcon aria-hidden className="text-peer-knowledge-foreground" />
              Task context
            </Button>
          )}
        </CardButtons>
      )}
    </CardFrame>
  );
}

/** A card's frame: a quiet surface, with a hairline in the tone of what waits on the person. */
function CardFrame({
  tone,
  faded = false,
  children,
}: {
  readonly tone: SignalTone | undefined;
  readonly faded?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs",
        tone === "needs"
          ? "border-warning/30"
          : tone === "team"
            ? "border-peer-team/30"
            : tone === "coordination"
              ? "border-peer-coordination/30"
              : "border-border",
        faded && "opacity-70",
      )}
    >
      {children}
    </article>
  );
}

function CardTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-foreground">{children}</h3>
  );
}

function CardButtons({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5 pt-0.5">{children}</div>;
}

function PersonChip({ name, mine }: { readonly name: string; readonly mine: boolean }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 pl-0.5 text-xs text-foreground">
      <PersonMark name={name} mine={mine} />
      {mine ? "You" : name}
    </span>
  );
}

/** The same cards as rows: status, project, what it is, and the way to open it. */
function WorkList({
  cards,
  here,
  actions,
}: {
  readonly cards: ReadonlyArray<BoardCard>;
  readonly here: WorkHere;
  readonly actions: CardActions;
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing matches.</p>;
  }
  const title = (column: BoardColumn) =>
    BOARD_COLUMNS.find((candidate) => candidate.id === column)?.title ?? column;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-2xs tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="px-3 py-2 font-medium">What</th>
            <th className="px-3 py-2 font-medium">Who</th>
            <th className="px-3 py-2 text-right font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const look =
              card.kind === "thread" ? agentLook(card.thread.agent, here.providers) : null;
            return (
              <tr key={card.key} className="border-b border-border/60 last:border-b-0">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "flex items-center gap-2 text-xs",
                      TONE_TEXT[COLUMN_TONE[card.column]],
                    )}
                  >
                    <StatusGlyph status={COLUMN_STATUS[card.column]} />
                    {title(card.column)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <ProjectMark
                      name={card.project.name}
                      colorKey={projectScopeKey(card.project)}
                      className="size-3.5"
                    />
                    <span className="truncate">{card.project.name}</span>
                  </span>
                </td>
                <td className="max-w-0 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {card.task?.key === undefined ? null : <TaskKey>{card.task.key}</TaskKey>}
                    <span className="truncate font-medium">{boardCardTitle(card)}</span>
                    {card.kind === "thread" ? null : (
                      <Badge
                        variant={
                          card.kind === "request"
                            ? "team"
                            : card.kind === "overlap"
                              ? "coordination"
                              : "warning"
                        }
                        size="sm"
                      >
                        {card.kind === "request"
                          ? "Team request"
                          : card.kind === "overlap"
                            ? "Overlap"
                            : "Inputs changed"}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {card.kind === "thread" ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <PersonChip name={card.thread.person} mine={card.thread.mine} />
                      {look === null ? null : <AgentMark look={look} />}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTimeLabel(card.item.since)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <ListOpen card={card} actions={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListOpen({ card, actions }: { readonly card: BoardCard; readonly actions: CardActions }) {
  switch (card.kind) {
    case "thread": {
      const open = card.thread.open;
      return open === undefined ? null : (
        <Button size="xs" variant="outline" onClick={() => actions.openThread(open)}>
          {open.kind === "observe" ? "Watch" : "Open"}
        </Button>
      );
    }
    case "request":
      return (
        <Button size="xs" variant="outline" onClick={() => actions.openRequest(card, "accept")}>
          Review
        </Button>
      );
    case "overlap":
      return (
        <Button size="xs" variant="outline" onClick={() => actions.openOverlap(card)}>
          Open
        </Button>
      );
    case "stale":
      return (
        <Button size="xs" variant="outline" onClick={() => actions.openContext(card)}>
          Context
        </Button>
      );
  }
}
