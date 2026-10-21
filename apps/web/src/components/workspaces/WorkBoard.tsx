import type { PeerHubStatus } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  InboxIcon,
  KanbanSquareIcon,
  ListIcon,
  MessageCircleIcon,
  SearchIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { cn } from "../../lib/utils";
import { InlineButton } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { SidebarInset, useSidebar } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { WorkspacePageIntro } from "../WorkspacePageIntro";
import type { WorkHere } from "./marks";
import { OwnerCallDecision } from "./ownership/OwnerCallDecision";
import { useWithdrawOwnerCall } from "./ownership/useWithdrawOwnerCall";
import { projectSignals } from "./ProjectSignals";
import { isLocalScope, peerProjectIndex, resolveProjectScope } from "./projectScope.logic";
import { RequestReview } from "./requests/TeamRequests";
import { useOpenScopedChats } from "./useOpenScopedChats";
import { ProjectMark, TONE_TEXT } from "./signals";
import type { ProjectSignal } from "./slots.types";
import { useWorkData } from "./useWorkData";
import { boardKinds, boardSearchPlaceholder } from "./vcsWords";
import {
  ALL_PROJECTS,
  doneLine,
  inScope,
  projectScopeKey,
  TASK_COLUMNS,
  taskCards,
  unsortedChats,
  type NeedCard,
  type TaskCard,
  type WorkTaskCard,
} from "./workBoard.logic";
import {
  NeedCardView,
  StateDot,
  TaskCardView,
  type CardActions,
  type OwnerCallCard,
} from "./WorkBoardCards";
import { COLUMN_STATE, type ListTab } from "./workList.logic";
import { WorkNoProjects } from "./WorkNoProjects";
import { WorkScopePicker } from "./WorkScopePicker";
import { useWorkScope } from "./workScope";
import { WorkTaskList } from "./WorkTaskList";
import { attentionCards } from "./workNavigation.logic";

const StoredLayout = Schema.NullOr(Schema.Literals(["board", "list"]));
const StoredWhose = Schema.NullOr(Schema.Literals(["everyone", "mine"]));
const StoredTab = Schema.NullOr(Schema.Literals(["active", "done"]));

type RequestCard = Extract<NeedCard, { readonly kind: "request" }>;

const isTask = (card: TaskCard): card is WorkTaskCard => card.kind === "task";

/**
 * The Work board: what happens on which project, at a glance. Every task of the team's projects is
 * a card in the column its state puts it in, and the first column is what waits on the person:
 * tasks to review, approve or answer, teammates' requests, overlaps to decide and inputs that
 * changed. A column with no card is one line under the board, with the person's chats that are on
 * no task and the tasks that are done. The sidebar's project selector scopes it; the strip
 * above shows what agents and the team say to each other on those projects, and the list lays the
 * same tasks out as rows.
 */
export function WorkBoard() {
  const { environmentId, status, plugins, tree, here, actions, needs, now } = useWorkData();
  const navigate = useNavigate();
  const { view } = useSearch({ from: "/_chat/work" });
  const attention = view === "needs-you";
  const { open: sidebarOpen, isMobile } = useSidebar();
  const showScopedChats = useOpenScopedChats();
  const [storedScope] = useWorkScope();
  const projectGroups = useSidebarProjectGroups();
  const selected = resolveProjectScope(storedScope, {
    peer: peerProjectIndex(status),
    groups: projectGroups,
  });
  const scope = selected.scope;
  const local = isLocalScope(scope);
  const [layout, setLayout] = useLocalStorage("peer:work-board-layout", null, StoredLayout);
  const [whose, setWhose] = useLocalStorage("peer:work-board-whose", null, StoredWhose);
  const [storedTab, setTab] = useLocalStorage("peer:work-list-tab", null, StoredTab);
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState<{
    readonly card: RequestCard;
    readonly view: "accept" | "decline";
  } | null>(null);
  const [deciding, setDeciding] = useState<{
    readonly card: OwnerCallCard;
    readonly decision: "accept" | "decline";
  } | null>(null);
  const withdrawOwnerCall = useWithdrawOwnerCall(environmentId);
  const mine = whose === "mine";
  const listing = layout === "list";
  const tab: ListTab = storedTab ?? "active";
  const me = status?.email ?? null;
  const cards = taskCards(tree, { scope, mine: attention ? false : mine, query, needs, me });
  const waiting = attentionCards(cards);
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
  const tasks = cards.filter(isTask);
  const doneTasks = tasks.filter((card) => card.column === null);
  const activeTasks = tasks.length - doneTasks.length;
  const cardActions: CardActions = {
    openTarget: (target) => {
      if (target.kind === "chat") {
        actions.open(target.open);
        return;
      }
      void navigate({
        to:
          target.kind === "task"
            ? "/task/$workspace/$project/$task"
            : "/review/$workspace/$project/$task",
        params: { workspace: target.workspace, project: target.project, task: target.task },
      });
    },
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
    openOverlap: (card) =>
      void navigate({
        to: "/overlap/$workspace/$project/$overlap",
        params: {
          workspace: card.item.overlap.workspace,
          project: card.item.overlap.project,
          overlap: card.item.overlap.id,
        },
      }),
    openOverlapPage: ({ workspace, project, overlap }) =>
      void navigate({
        to: "/overlap/$workspace/$project/$overlap",
        params: { workspace, project, overlap },
      }),
    openRequest: (card, view) => setRequest({ card, view }),
    openOwnerCall: (card, decision) => setDeciding({ card, decision }),
    withdrawOwnerCall: (card) =>
      void withdrawOwnerCall({
        workspace: card.item.workspace,
        project: card.item.project,
        id: card.item.call.id,
      }),
  };
  const showDone = () => {
    setLayout("list");
    setTab("done");
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron}>
          {attention ? (
            <InboxIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <KanbanSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 text-base font-semibold text-foreground">
            {attention ? "Needs you" : listing ? "Tasks" : "Overview"}
          </span>
          {isMobile || !sidebarOpen ? <WorkScopePicker groups={projectGroups} compact /> : null}
        </WorkspacePageHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-(--workspace-page-gutter) pt-6 pb-12 sm:pt-8">
          {status === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connecting…
            </p>
          ) : local ? (
            <div className="flex max-w-lg flex-col items-start gap-5">
              <WorkspacePageIntro
                title={selected.name ?? "This project"}
                description="This project is not shared with a workspace, so it has no team tasks or decisions."
              />
              <InlineButton onClick={showScopedChats}>Show its chats</InlineButton>
            </div>
          ) : !status.signedIn ? (
            <p className="text-sm text-muted-foreground">
              Sign in with your work email in Settings → Peer to see your team’s work.
            </p>
          ) : tree.length === 0 && scope === ALL_PROJECTS ? (
            environmentId === null ? null : (
              <WorkNoProjects
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                className="max-w-md"
                fallback={
                  <p className="text-sm text-muted-foreground">
                    No team projects yet. Share one from the sidebar’s Tasks view.
                  </p>
                }
              />
            )
          ) : (
            <>
              <WorkspacePageIntro
                title={attention ? "Needs you" : (selected.name ?? "Your workspace")}
                description={
                  <p>
                    {attention ? (
                      waiting.length === 0 ? (
                        query.trim() !== "" ? (
                          "No decisions match this search."
                        ) : (
                          "No decisions waiting in this project scope."
                        )
                      ) : (
                        `${waiting.length} ${waiting.length === 1 ? "item needs" : "items need"} your attention.`
                      )
                    ) : (
                      <>
                        {activeTasks} active {activeTasks === 1 ? "task" : "tasks"}
                        {" · "}
                        {doneTasks.length} done
                      </>
                    )}
                  </p>
                }
              />
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <InputGroup variant="search" className="w-full sm:min-w-48 sm:flex-1 sm:max-w-sm">
                    <InputGroupAddon>
                      <SearchIcon aria-hidden />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="search"
                      size="lg"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={boardSearchPlaceholder(
                        boardKinds(tree.filter((project) => inScope(scope, project))),
                      )}
                      aria-label={attention ? "Search what needs you" : "Search the Work board"}
                    />
                  </InputGroup>
                  {attention ? null : (
                    <ToggleGroup
                      aria-label="Whose work"
                      variant="liquid"
                      value={[mine ? "mine" : "everyone"]}
                      onValueChange={(next) => {
                        const value = next[0];
                        if (value === "everyone" || value === "mine") setWhose(value);
                      }}
                    >
                      <Toggle value="everyone">Everyone</Toggle>
                      <Toggle value="mine">Mine</Toggle>
                    </ToggleGroup>
                  )}
                  {attention ? null : (
                    <div className="ml-auto">
                      <ToggleGroup
                        aria-label="Layout"
                        variant="liquid"
                        value={[listing ? "list" : "board"]}
                        onValueChange={(next) => {
                          const value = next[0];
                          if (value === "board" || value === "list") setLayout(value);
                        }}
                      >
                        <Toggle value="board" aria-label="Board">
                          <KanbanSquareIcon aria-hidden className="size-3.5" />
                          <span className="hidden sm:inline">Board</span>
                        </Toggle>
                        <Toggle value="list" aria-label="List">
                          <ListIcon aria-hidden className="size-3.5" />
                          <span className="hidden sm:inline">List</span>
                        </Toggle>
                      </ToggleGroup>
                    </div>
                  )}
                </div>
              </div>

              {!attention && signals.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <span className="text-sm font-medium text-muted-foreground">Team activity</span>
                  {signals.map(({ project, signal }) => (
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
                  ))}
                </div>
              ) : null}

              {attention ? (
                <AttentionQueue
                  cards={waiting}
                  scope={scope}
                  here={here}
                  status={status}
                  now={now}
                  actions={cardActions}
                  searching={query.trim() !== ""}
                  onOverview={() => void navigate({ to: "/work", search: {} })}
                />
              ) : query.trim() !== "" && cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing matches.</p>
              ) : listing ? (
                <WorkTaskList
                  cards={cards}
                  scope={scope}
                  tab={tab}
                  onTab={setTab}
                  onOpen={cardActions.openTarget}
                  onShowNeeds={() => void navigate({ to: "/work", search: { view: "needs-you" } })}
                />
              ) : (
                <>
                  <BoardColumns
                    cards={cards}
                    scope={scope}
                    here={here}
                    status={status}
                    now={now}
                    actions={cardActions}
                  />
                  <BoardLines
                    cards={cards}
                    chatsOnNoTask={unsortedChats(tree, { scope, query })}
                    doneText={doneLine(doneTasks, now)}
                    onOpenChats={showScopedChats}
                    onShowDone={showDone}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {deciding === null || environmentId === null ? null : (
        <OwnerCallDecision
          key={`${deciding.card.key}/${deciding.decision}`}
          environmentId={environmentId}
          workspace={deciding.card.item.workspace}
          project={deciding.card.item.project}
          call={deciding.card.item.call}
          asker={deciding.card.item.asker}
          owner={deciding.card.item.owner}
          onBehalf={deciding.card.item.onBehalf}
          task={deciding.card.task?.key ?? deciding.card.task?.title}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
        />
      )}
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

function AttentionQueue({
  cards,
  scope,
  here,
  status,
  now,
  actions,
  searching,
  onOverview,
}: {
  readonly cards: ReadonlyArray<TaskCard>;
  readonly scope: string;
  readonly here: WorkHere;
  readonly status: PeerHubStatus;
  readonly now: number;
  readonly actions: CardActions;
  readonly searching: boolean;
  readonly onOverview: () => void;
}) {
  if (cards.length === 0) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 border-t border-border/60 py-8">
        <CircleCheckIcon aria-hidden className="size-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">
          {searching ? "No matching items need you" : "You’re all caught up"}
        </h2>
        <p className="max-w-lg text-sm text-muted-foreground">
          {searching
            ? "Try another search to find a waiting decision."
            : "Reviews, approvals, questions and team decisions for this project scope will appear here."}
        </p>
        <InlineButton onClick={onOverview}>Show all work</InlineButton>
      </div>
    );
  }
  return (
    <section
      aria-label="Items needing your attention"
      className="max-w-4xl divide-y divide-border/60 border-y border-border/60"
    >
      {cards.map((card) =>
        card.kind === "task" ? (
          <TaskCardView
            key={card.key}
            card={card}
            here={here}
            status={status}
            actions={actions}
            showProject={scope === ALL_PROJECTS}
          />
        ) : (
          <NeedCardView
            key={card.key}
            card={card}
            status={status}
            now={now}
            actions={actions}
            showProject={scope === ALL_PROJECTS}
          />
        ),
      )}
    </section>
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
  const content = (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
      {project === undefined ? (
        <span aria-hidden className={cn("size-2 rounded-xs bg-current", TONE_TEXT[signal.tone])} />
      ) : (
        <ProjectMark name={project.name} colorKey={project.colorKey} className="size-3.5" />
      )}
      <span className={cn("font-semibold", TONE_TEXT[signal.tone])}>{signal.label}</span>
      <span className={cn("tabular-nums", TONE_TEXT[signal.tone])}>{signal.count}</span>
      <span className="max-w-56 truncate font-normal text-foreground/80">{signal.detail}</span>
    </span>
  );
  return onOpen === undefined ? (
    content
  ) : (
    <InlineButton className="min-w-0 max-w-full" onClick={onOpen}>
      {content}
    </InlineButton>
  );
}

/** The columns that have cards, side by side; the ones that have none are lines under the board. */
function BoardColumns({
  cards,
  scope,
  here,
  status,
  now,
  actions,
}: {
  readonly cards: ReadonlyArray<TaskCard>;
  readonly scope: string;
  readonly here: WorkHere;
  readonly status: PeerHubStatus;
  readonly now: number;
  readonly actions: CardActions;
}) {
  const columns = TASK_COLUMNS.map((column) => ({
    ...column,
    cards: cards.filter((card) => card.column === column.id),
  })).filter((column) => column.cards.length > 0);
  if (columns.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-start gap-5">
      {columns.map((column) => (
        <section
          key={column.id}
          aria-label={column.title}
          className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/70"
        >
          <h2 className="flex items-center gap-2 border-b border-border/70 px-5 py-4 text-sm font-semibold">
            <StateDot kind={COLUMN_STATE[column.id]} />
            {column.title}
            <span
              aria-label={`${column.cards.length} ${column.cards.length === 1 ? "item" : "items"}`}
              className="ml-auto text-xs font-medium text-muted-foreground tabular-nums"
            >
              {column.cards.length}
            </span>
          </h2>
          <div className="flex flex-col divide-y divide-border/60">
            {column.cards.map((card) =>
              card.kind === "task" ? (
                <TaskCardView
                  key={card.key}
                  card={card}
                  here={here}
                  status={status}
                  actions={actions}
                  showProject={scope === ALL_PROJECTS}
                />
              ) : (
                <NeedCardView
                  key={card.key}
                  card={card}
                  status={status}
                  now={now}
                  actions={actions}
                  showProject={scope === ALL_PROJECTS}
                />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function BoardLine({
  icon,
  quiet = false,
  action,
  children,
}: {
  readonly icon: ReactNode;
  /** An empty column's line is quieter than one that says something is there. */
  readonly quiet?: boolean;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2.5 px-3.5 py-2 text-sm">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className={cn("min-w-0 flex-1", quiet ? "text-muted-foreground" : "text-foreground")}>
        {children}
      </span>
      {action}
    </div>
  );
}

/**
 * Under the board, one line for each column without a card, one for the chats of yours that are on
 * no task (they are in Chats), and one for the tasks that are done (they open in the list).
 */
function BoardLines({
  cards,
  chatsOnNoTask,
  doneText,
  onOpenChats,
  onShowDone,
}: {
  readonly cards: ReadonlyArray<TaskCard>;
  readonly chatsOnNoTask: number;
  readonly doneText: string | null;
  readonly onOpenChats: () => void;
  readonly onShowDone: () => void;
}) {
  if (cards.length > 0 && chatsOnNoTask === 0 && doneText === null) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
      {cards.length === 0 ? (
        <BoardLine quiet icon={<CircleCheckIcon aria-hidden className="size-4" />}>
          No active work in this view. Choose another project or start a task from the sidebar.
        </BoardLine>
      ) : null}
      {chatsOnNoTask === 0 ? null : (
        <BoardLine
          icon={<MessageCircleIcon aria-hidden className="size-3.5" />}
          action={<InlineButton onClick={onOpenChats}>Open in Chats</InlineButton>}
        >
          {chatsOnNoTask === 1
            ? "1 of your chats isn’t on a task"
            : `${chatsOnNoTask} of your chats aren’t on a task`}
        </BoardLine>
      )}
      {doneText === null ? null : (
        <BoardLine
          icon={<CircleCheckIcon aria-hidden className="size-3.5 text-success-foreground" />}
          action={<InlineButton onClick={onShowDone}>Show done</InlineButton>}
        >
          {doneText}
        </BoardLine>
      )}
    </div>
  );
}
