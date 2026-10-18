import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { buildTeamView, type ProjectOwnership } from "@t3tools/client-runtime/peer/ownership";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { PeerCallout } from "../PeerDialog";
import { PeerPageHeader } from "../PeerPageHeader";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { projectActionItems, teamPluginSignalsOf } from "../slots.logic";
import type { PeerWebPlugin } from "../slots.types";
import { useWorkData } from "../useWorkData";
import type { WorkProjectNode } from "../workTree.logic";
import { AreasBoard } from "./AreasBoard";
import { OwnerMapCard } from "./OwnerMapCard";
import { OwnerMapEditor } from "./OwnerMapEditor";
import { PeopleStrip } from "./PeopleStrip";
import {
  historyRevision,
  ownerMapSummary,
  teamHeaderState,
  teamPageState,
  type OwnerMapSummary,
} from "./team.logic";
import { openTeam, type TeamPageView } from "./teamNavigation";
import { TeamSignals } from "./TeamSignals";
import { TeamTimeline, type TimelineLoad } from "./TeamTimeline";
import { TIMELINE_LIMIT, ownerCleared, timelineChoices, timelineRows } from "./teamTimeline.logic";

/** The project's announcements are another plugin's: its More menu item, found by its address. */
const ANNOUNCE_ACTION = "announcements/notify-agents";

/**
 * A project's Team page: what the team's agents are doing, from facts Peer keeps, for every member
 * of the project, and its owner map, which leads and admins edit. It says what it cannot show (a
 * project the person is not on is "not available to you", and nothing of it is drawn) and draws
 * the rest: it leaves out only what needs this computer's coordination while that is off.
 */
export function TeamPage({
  workspace,
  project: projectId,
  view,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly view: TeamPageView;
}) {
  const { environmentId, status, plugins, tree, needs, now } = useWorkData();
  const state = teamPageState({ status, tree, workspace, project: projectId });
  // What the person is told while the page has nothing of the project to draw.
  const note =
    state.kind === "unavailable"
      ? "This project is not available to you."
      : state.kind === "unknown"
        ? "Ownership for this project has not been read from Peer Hub yet."
        : null;
  const project = state.kind === "ready" || state.kind === "unknown" ? state.project : undefined;
  const live = state.kind === "ready" && status !== null && environmentId !== null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={
            project === undefined
              ? undefined
              : { name: project.name, colorKey: `${workspace}/${projectId}` }
          }
          page={
            view === "owner-map" && project !== undefined ? (
              <OwnerMapCrumb workspace={workspace} project={projectId} />
            ) : (
              "Team"
            )
          }
          state={
            live
              ? {
                  label: (
                    <HeaderState
                      at={state.ownership.view.at}
                      coordinationOff={!status.coordination.enabled}
                    />
                  ),
                  tone: status.coordination.enabled ? "delivery" : "neutral",
                }
              : undefined
          }
        />
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
            {note !== null ? (
              <p
                role={state.kind === "unknown" ? "status" : undefined}
                className="text-sm text-muted-foreground"
              >
                {note}
              </p>
            ) : !live ? (
              <p role="status" className="text-sm text-muted-foreground">
                Connecting…
              </p>
            ) : view === "owner-map" ? (
              <OwnerMapPage
                environmentId={environmentId}
                project={state.project}
                ownership={state.ownership}
                now={now}
              />
            ) : (
              <TeamBody
                environmentId={environmentId}
                status={status}
                plugins={plugins}
                project={state.project}
                ownership={state.ownership}
                needs={needs}
                now={now}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/** "Team › Owner map": the page's name over the map, with a way back. */
function OwnerMapCrumb({
  workspace,
  project,
}: {
  readonly workspace: string;
  readonly project: string;
}) {
  return (
    <>
      <Link
        to="/team/$workspace/$project"
        params={{ workspace, project }}
        search={{}}
        className="rounded-sm font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        Team
      </Link>
      <ChevronRightIcon aria-hidden className="mx-1.5 inline size-3.5 text-muted-foreground/70" />
      Owner map
    </>
  );
}

/**
 * Whether this computer's agents coordinate, and how old the Hub's view of the project is. It
 * counts seconds while the view is under a minute old, so it keeps its own clock, apart from the
 * page's, and re-renders only itself.
 */
function HeaderState({
  at,
  coordinationOff,
}: {
  readonly at: string | undefined;
  readonly coordinationOff: boolean;
}) {
  const now = useRelativeTimeTick(1_000);
  return <>{teamHeaderState({ at, coordinationOff }, now).label}</>;
}

/**
 * Reads the project's coordination history, and reads it again when something the history would
 * show changed (`historyRevision`: a task moved, an owner or a call changed, the map was saved) and
 * now and then while the page is visible, so what it says of the last half hour is not stale.
 */
function useTeamHistory(
  environmentId: EnvironmentId,
  ids: { readonly workspace: string; readonly project: string },
  revision: string,
) {
  const history = useEnvironmentQuery(
    serverEnvironment.peerHubCoordEvents({
      environmentId,
      input: { ...ids, limit: TIMELINE_LIMIT },
    }),
  );
  const { refresh } = history;
  // The revision the history was read for; the first read is the query's own.
  const read = useRef(revision);
  useEffect(() => {
    if (read.current === revision) return;
    read.current = revision;
    refresh();
  }, [revision, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return history;
}

function TeamBody({
  environmentId,
  status,
  plugins,
  project,
  ownership,
  needs,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly needs: ReadonlyArray<NeedsYouItem>;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const openSettings = useOpenPeerSettings();
  const [announcing, setAnnouncing] = useState(false);
  const ids = { workspace: project.workspace, project: project.projectId };
  const team = buildTeamView({ status, project, needs, now });
  const history = useTeamHistory(environmentId, ids, historyRevision(project, status));
  const events = history.data;
  const rows = timelineRows({ events: events ?? [], ownership, tasks: project.tasks, now });
  const choices = timelineChoices(rows, {
    areas: project.areas.flatMap((area) => (area.name === null ? [] : [area.name])),
    tasks: project.tasks,
  });
  const cleared = ownerCleared({
    events: events ?? [],
    ownership,
    ownerless: new Set(
      team.areas.flatMap((area) =>
        area.tasks.flatMap((task) => (task.owner === undefined ? [task.id] : [])),
      ),
    ),
  });
  const summary: OwnerMapSummary = ownerMapSummary({
    ownership,
    areas: project.areas.flatMap((area) => (area.name === null ? [] : [area.name])),
    now,
  });
  const slot = { environmentId, status, project, activeThread: null };
  const announce = projectActionItems(plugins, slot).find((item) => item.key === ANNOUNCE_ACTION);
  const load: TimelineLoad =
    history.error !== null
      ? { kind: "failed", message: history.error }
      : events === null
        ? { kind: "loading" }
        : { kind: "loaded" };
  const pluginSignals = teamPluginSignalsOf(plugins, { status, project, now });
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 basis-96 flex-col gap-1.5">
          <h1 className="text-xl font-semibold text-foreground">Team</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What the team's agents are doing, from facts Peer keeps. Other people's chats are
            counted, never listed. Requests and personal metrics stay out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {team.canManage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openTeam(navigate, { ...ids, view: "owner-map" })}
            >
              Edit owner map
            </Button>
          ) : null}
          {announce === undefined ? null : (
            <Button size="sm" variant="outline" onClick={() => setAnnouncing(true)}>
              Post the team's priority as an announcement
            </Button>
          )}
        </div>
      </div>
      {team.coordinationOff ? (
        <PeerCallout tone="neutral">
          <span role="status" className="flex flex-col items-start gap-1.5">
            <span>
              Agent coordination is off on this computer, so changes agents make in owned paths
              cannot be shown here.
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void openSettings({ kind: "computer", section: "coordination" })}
            >
              Open Coordination & plugins
            </Button>
          </span>
        </PeerCallout>
      ) : null}
      <PeopleStrip people={team.people} />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_46rem] flex-col gap-6">
          <TeamSignals
            environmentId={environmentId}
            project={project}
            ownership={ownership}
            signals={team.signals}
            pluginSignals={pluginSignals}
            now={now}
          />
          <AreasBoard
            environmentId={environmentId}
            areas={team.areas}
            status={status}
            project={project}
            ownership={ownership}
            plugins={plugins}
            now={now}
            cleared={cleared}
          />
        </div>
        <aside className="flex min-w-0 flex-[1_1_22rem] flex-col gap-6">
          <OwnerMapCard
            summary={summary}
            canManage={team.canManage}
            onOpen={() => openTeam(navigate, { ...ids, view: "owner-map" })}
          />
          <TeamTimeline rows={rows} choices={choices} load={load} />
        </aside>
      </div>
      {announce === undefined || !announcing ? null : (
        <announce.action.Dialog {...slot} onClose={() => setAnnouncing(false)} />
      )}
    </>
  );
}

/** The project's owner map on a page of its own: edited by leads and admins, read by everybody else. */
function OwnerMapPage({
  environmentId,
  project,
  ownership,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: WorkProjectNode;
  readonly ownership: ProjectOwnership;
  readonly now: number;
}) {
  const areas = project.areas.flatMap((area) => (area.name === null ? [] : [area.name]));
  const summary = ownerMapSummary({ ownership, areas, now });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">Owner map</h1>
        <p className="text-sm text-muted-foreground">
          {`Who answers for each area and path of ${project.name}. Leads and admins change it; everyone on the project sees it.`}
        </p>
        <p className="text-xs text-muted-foreground">{summary.page}</p>
      </div>
      <OwnerMapEditor
        key={`${ownership.workspace}/${ownership.project}`}
        environmentId={environmentId}
        ownership={ownership}
        areas={areas}
        summary={summary}
      />
    </div>
  );
}
