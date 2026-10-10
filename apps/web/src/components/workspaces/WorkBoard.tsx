import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon, GitBranchIcon, KanbanSquareIcon, ListIcon, SearchIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { activeLabel, agentLook, AgentMark, PersonMark, type WorkHere } from "./marks";
import { projectSignals } from "./ProjectSignals";
import { ProjectMark, TONE_BADGE } from "./signals";
import type { ProjectSignal } from "./slots.types";
import { useWorkData } from "./useWorkData";
import {
  ALL_PROJECTS,
  BOARD_COLUMNS,
  boardCards,
  inScope,
  projectCounts,
  projectScopeKey,
  resolveScope,
  type BoardCard,
  type BoardColumn,
} from "./workBoard.logic";
import { AllProjectsMark } from "./WorkScopePicker";
import { useWorkScope } from "./workScope";
import { StatusGlyph } from "./workStatus";
import type { WorkOpen } from "./workTree.logic";

const StoredLayout = Schema.NullOr(Schema.Literals(["board", "list"]));

/** A card of one of the tree's threads. */
type ThreadCard = Extract<BoardCard, { readonly kind: "thread" }>;
const isThreadCard = (card: BoardCard): card is ThreadCard => card.kind === "thread";
const StoredWhose = Schema.NullOr(Schema.Literals(["everyone", "mine"]));

/** The hue of each column's state, as the tree's status glyphs draw it. */
const COLUMN_STATUS = {
  needs: "blocked",
  working: "working",
  review: "done",
  idle: "idle",
} as const satisfies Readonly<Record<BoardColumn, string>>;

const COLUMN_TONE: Readonly<Record<BoardColumn, string>> = {
  needs: "text-warning-foreground",
  working: "text-info-foreground",
  review: "text-success-foreground",
  idle: "text-muted-foreground",
};

/**
 * The Work board: what happens on which project, at a glance. Every thread of the team's projects
 * is a card in its state's column; the project pills scope it (with the sidebar), and the strip
 * above the columns shows what agents and the team say to each other on those projects.
 */
export function WorkBoard() {
  const { status, plugins, tree, here, actions } = useWorkData();
  const navigate = useNavigate();
  const [storedScope, setScope] = useWorkScope();
  const scope = resolveScope(storedScope, tree);
  const [layout, setLayout] = useLocalStorage("peer:work-board-layout", null, StoredLayout);
  const [whose, setWhose] = useLocalStorage("peer:work-board-whose", null, StoredWhose);
  const [query, setQuery] = useState("");
  const mine = whose === "mine";
  const cards = useMemo(
    () => boardCards(tree, { scope, mine, query }).filter(isThreadCard),
    [mine, query, scope, tree],
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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <KanbanSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Work</span>
          <span aria-hidden className="text-muted-foreground/60">
            /
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {current === undefined ? (
              <AllProjectsMark tree={tree} />
            ) : (
              <ProjectMark name={current.name} colorKey={scope} />
            )}
            <span className="truncate">{current?.name ?? "All projects"}</span>
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {cards.length} {cards.length === 1 ? "thread" : "threads"} · {count("needs")} need input
            · {count("working")} working
          </span>
        </WorkspacePageHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pt-4 pb-8 sm:px-6">
          {status === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : !status.signedIn ? (
            <p className="text-sm text-muted-foreground">
              Sign in with your work email in Settings → Workspaces to see your team’s work.
            </p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No team projects yet. Share one from the sidebar’s Work view.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-2.5 text-muted-foreground sm:max-w-sm">
                  <SearchIcon aria-hidden className="size-3.5 shrink-0" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search threads, tasks, branches, people"
                    aria-label="Search the Work board"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <span className="flex-1" />
                <ToggleGroup
                  aria-label="Whose work"
                  variant="segmented"
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
                  variant="segmented"
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

              <nav aria-label="Projects" className="flex gap-1.5 overflow-x-auto pb-0.5">
                <ProjectPill
                  active={scope === ALL_PROJECTS}
                  onClick={() => setScope(ALL_PROJECTS)}
                  mark={<AllProjectsMark tree={tree} />}
                  name="All projects"
                  total={tree.reduce((n, p) => n + sum(projectCounts(p, mine)), 0)}
                  needs={tree.reduce((n, p) => n + projectCounts(p, mine).needs, 0)}
                />
                {tree.map((project) => {
                  const key = projectScopeKey(project);
                  const counts = projectCounts(project, mine);
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

              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2">
                <span className="mr-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Between agents &amp; team
                </span>
                {signals.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Nothing open right now.</span>
                ) : (
                  signals.map(({ project, signal }) => (
                    <SignalStripChip
                      key={`${projectScopeKey(project)}:${signal.id}`}
                      signal={signal}
                      projectName={project.name}
                      colorKey={projectScopeKey(project)}
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
                          className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2"
                        >
                          <h2 className="flex items-center gap-2 px-1.5 pt-0.5 text-sm font-semibold">
                            <StatusGlyph status={COLUMN_STATUS[column.id]} />
                            {column.title}
                            <span className="text-xs font-normal text-muted-foreground tabular-nums">
                              {inColumn.length}
                            </span>
                          </h2>
                          {inColumn.length === 0 ? (
                            <p className="px-1.5 pb-1 text-xs text-muted-foreground">
                              Nothing here.
                            </p>
                          ) : (
                            inColumn.map((card) => (
                              <WorkCard
                                key={card.key}
                                card={card}
                                here={here}
                                onOpen={actions.open}
                                onContext={() => openContext(navigate, card)}
                              />
                            ))
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <WorkList cards={cards} here={here} onOpen={actions.open} />
              )}
            </>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function sum(counts: Readonly<Record<BoardColumn, number>>): number {
  return counts.needs + counts.working + counts.review + counts.idle;
}

function openContext(navigate: ReturnType<typeof useNavigate>, card: ThreadCard) {
  const context = card.task?.context;
  if (context === undefined) return;
  void navigate({
    to: "/context/$workspace/$project/$scope",
    params: { workspace: context.workspace, project: context.project, scope: context.scope },
  });
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
          aria-label={`${needs} need input`}
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
  projectName,
  colorKey,
  onOpen,
}: {
  readonly signal: ProjectSignal;
  readonly projectName: string;
  readonly colorKey: string;
  readonly onOpen: (() => void) | undefined;
}) {
  const content = (
    <>
      <ProjectMark name={projectName} colorKey={colorKey} className="size-3.5" />
      <span className="font-semibold">{signal.label}</span>
      <span className="tabular-nums">{signal.count}</span>
      <span className="max-w-56 truncate font-normal text-foreground/80">{signal.detail}</span>
    </>
  );
  return (
    <Badge
      variant={TONE_BADGE[signal.tone]}
      size="control"
      title={`${projectName} · ${signal.label}`}
      render={onOpen === undefined ? undefined : <button type="button" onClick={onOpen} />}
    >
      {content}
    </Badge>
  );
}

/** The chips a card carries: whose it is, what runs it, and its signals in their colors. */
function CardChips({ card, here }: { readonly card: ThreadCard; readonly here: WorkHere }) {
  const { thread } = card;
  const look = agentLook(thread.agent, here.providers);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 pl-0.5 text-xs text-foreground">
        <PersonMark name={thread.person} mine={thread.mine} />
        {thread.mine ? "You" : thread.person}
      </span>
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
      {thread.mine && card.column === "needs" ? (
        <Badge variant="warning" size="sm">
          Needs you
        </Badge>
      ) : null}
      {thread.concerns !== undefined ? (
        <Badge variant="coordination" size="sm" title={thread.concerns}>
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
      {thread.delivery === "review" ? (
        <Badge variant="success" size="sm">
          In review
        </Badge>
      ) : null}
      {thread.stale ? (
        <Badge variant="secondary" size="sm">
          Away
        </Badge>
      ) : null}
    </div>
  );
}

function openLabel(card: ThreadCard): string {
  if (card.thread.open?.kind === "observe") return "Watch";
  if (card.column === "needs" && card.thread.mine) return "Review";
  return "Open";
}

function WorkCard({
  card,
  here,
  onOpen,
  onContext,
}: {
  readonly card: ThreadCard;
  readonly here: WorkHere;
  readonly onOpen: (open: WorkOpen) => void;
  readonly onContext: () => void;
}) {
  const { thread, project, task } = card;
  const open = thread.open;
  const when = activeLabel(thread.activeAt);
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-xs",
        thread.stale && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ProjectMark name={project.name} colorKey={projectScopeKey(project)} className="size-3.5" />
        <span className="truncate text-foreground/80">{project.name}</span>
        {task?.key === undefined ? null : (
          <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs">{task.key}</span>
        )}
        <span className="flex-1" />
        {when === null ? null : <span className="shrink-0 tabular-nums">{when}</span>}
      </div>
      <h3 className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
        {thread.title}
      </h3>
      {task === undefined ? null : (
        <p className="truncate text-xs text-muted-foreground">On {task.title}</p>
      )}
      {thread.branch === undefined ? null : (
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{thread.branch}</span>
        </p>
      )}
      <CardChips card={card} here={here} />
      {open === undefined && task?.context === undefined ? null : (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {open === undefined ? null : (
            <Button
              size="xs"
              variant={card.column === "needs" && thread.mine ? "default" : "outline"}
              onClick={() => onOpen(open)}
            >
              {openLabel(card)}
            </Button>
          )}
          {task?.context === undefined ? null : (
            <Button size="xs" variant="ghost" onClick={onContext}>
              <FileTextIcon aria-hidden className="size-3.5 text-peer-knowledge-foreground" />
              Task context
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/** The same cards as rows: status, project, thread, who, signals. */
function WorkList({
  cards,
  here,
  onOpen,
}: {
  readonly cards: ReadonlyArray<ThreadCard>;
  readonly here: WorkHere;
  readonly onOpen: (open: WorkOpen) => void;
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">No threads match.</p>;
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
            <th className="px-3 py-2 font-medium">Thread</th>
            <th className="px-3 py-2 font-medium">Who and signals</th>
            <th className="px-3 py-2 text-right font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const open = card.thread.open;
            return (
              <tr key={card.key} className="border-b border-border/60 last:border-b-0">
                <td className="px-3 py-2">
                  <span className={cn("flex items-center gap-2 text-xs", COLUMN_TONE[card.column])}>
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
                    {card.task?.key === undefined ? null : (
                      <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
                        {card.task.key}
                      </span>
                    )}
                    <span className="truncate font-medium">{card.thread.title}</span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <CardChips card={card} here={here} />
                </td>
                <td className="px-3 py-2 text-right">
                  {open === undefined ? null : (
                    <Button size="xs" variant="outline" onClick={() => onOpen(open)}>
                      {openLabel(card)}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
