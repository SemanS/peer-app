/**
 * Settings › Overview: every integration Peer connects to, grouped by where it lives (the
 * Workspace, Me, This computer), each with its status in the status language, what is left to do
 * and the page to do it on. `overviewRows` turns the facts the pages already read into the groups;
 * `overviewSummary` counts what needs attention and names the first thing to finish, for the
 * banner on the page and the badge in the navigation.
 *
 * Admin-only rows (Slack, webhooks, GitHub's checks, shared capacity) are listed for the workspace's
 * admins only, as the navigation lists their pages; a plugin turned off removes its rows.
 */
import { isWorkspaceAdmin } from "../workspaces/settings/peerSettings.logic";
import { CHECKING, type ConnectionView } from "./connectionFacts";
import { computerRows, type ComputerFacts } from "./overviewComputer.logic";
import { overviewRow, type OverviewGroupId, type OverviewRow } from "./overviewRow.logic";
import { meRows, workspaceRows, type PeerFacts } from "./overviewWorkspace.logic";

export type { ComputerFacts } from "./overviewComputer.logic";
export type { OverviewGroupId, OverviewRow } from "./overviewRow.logic";
export type { PeerFacts, PlansFact, WorkspaceFacts } from "./overviewWorkspace.logic";

/** What the Overview knows of this computer's Peer: not connected, not read yet, or its status. */
export type PeerAccess =
  | { readonly kind: "disconnected" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly peer: PeerFacts };

export interface OverviewFacts {
  readonly peer: PeerAccess;
  readonly computer: ComputerFacts;
}

export interface OverviewGroup {
  readonly id: OverviewGroupId;
  readonly title: string;
  /** Beside the title: whose these are. */
  readonly who: string;
  readonly rows: ReadonlyArray<OverviewRow>;
}

/** The one row of a workspace group that has no Hub to read from. */
function hubOnlyGroup(who: string, connection: ConnectionView, signIn: boolean): OverviewGroup {
  return {
    id: "workspace",
    title: "Workspace",
    who,
    rows: [
      overviewRow({
        id: "workspace:hub",
        group: "workspace",
        name: "Peer Hub",
        connection,
        action: signIn
          ? { label: "Sign in", target: { kind: "settings", to: "/settings/peer" } }
          : null,
      }),
    ],
  };
}

/** The rows by group; a group with no row is left out. */
export function overviewRows(facts: OverviewFacts): ReadonlyArray<OverviewGroup> {
  const { peer: access, computer } = facts;
  const groups: OverviewGroup[] = [];
  const peer = access.kind === "ready" && access.peer.status.signedIn ? access.peer : null;
  if (peer !== null) {
    const { workspace } = peer;
    groups.push({
      id: "workspace",
      title: "Workspace",
      who:
        workspace === null
          ? ""
          : isWorkspaceAdmin(workspace.role)
            ? `${workspace.name} · admins set these up`
            : workspace.name,
      rows: workspaceRows(peer),
    });
    groups.push({ id: "me", title: "Me", who: peer.status.email ?? "", rows: meRows(peer) });
  } else if (access.kind === "ready") {
    groups.push(
      hubOnlyGroup(
        "Optional Hub",
        { state: "off", detail: "Peer Local works here. Connect a Hub to share work with a team." },
        true,
      ),
    );
  } else if (access.kind === "loading") {
    groups.push(hubOnlyGroup("", CHECKING, false));
  } else {
    groups.push(
      hubOnlyGroup("", { state: "off", detail: "Peer is not connected on this computer." }, false),
    );
  }
  groups.push({
    id: "computer",
    title: "This computer",
    who: computer.name ?? "",
    rows: computerRows(access.kind === "ready" ? access.peer : null, computer),
  });
  return groups.filter((group) => group.rows.length > 0);
}

export interface OverviewSummary {
  /** Setups with a step left and connections that broke: what the navigation says is "to finish". */
  readonly toFinish: number;
  /** Everything that Needs setup or has a Problem: what the "Needs attention" filter lists. */
  readonly attention: number;
  /** The first connection to finish, told as the banner tells it; null when nothing is under way. */
  readonly first: { readonly row: OverviewRow; readonly text: string } | null;
}

const withFullStop = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** The banner's sentence: the first missing step, or the problem, and what it means until then. */
export function finishText(row: OverviewRow): string {
  const { connection } = row;
  const what =
    connection.step === undefined
      ? `${row.subject}: ${withFullStop(connection.detail ?? "needs your attention")}`
      : `${row.subject} is at step ${connection.step.n} of ${connection.step.of}: ${connection.step.title}.`;
  return row.consequence === null ? what : `${what} ${row.consequence}`;
}

export function overviewSummary(groups: ReadonlyArray<OverviewGroup>): OverviewSummary {
  const rows = groups.flatMap((group) => group.rows);
  const first = rows.find((row) => row.underway);
  return {
    toFinish: rows.filter((row) => row.underway).length,
    attention: rows.filter((row) => row.attention).length,
    first: first === undefined ? null : { row: first, text: finishText(first) },
  };
}

export type OverviewFilter = "all" | "attention";

/** The groups the filter shows: all of them, or only the rows that need attention. */
export function filterOverview(
  groups: ReadonlyArray<OverviewGroup>,
  filter: OverviewFilter,
): ReadonlyArray<OverviewGroup> {
  if (filter === "all") return groups;
  return groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.attention) }))
    .filter((group) => group.rows.length > 0);
}

/** The navigation's badge: "1 to finish"; null when nothing is. */
export function toFinishLabel(summary: Pick<OverviewSummary, "toFinish">): string | null {
  return summary.toFinish === 0 ? null : `${summary.toFinish} to finish`;
}
