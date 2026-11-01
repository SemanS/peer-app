/** The Feed's lists: what a person's rooms come to, in the order they ask for it. */
import { personName } from "@t3tools/client-runtime/peer/needs-you";
import type { RoomFeedRow, RoomFeedState } from "@t3tools/client-runtime/peer/rooms";
import type { PeerHubStatus } from "@t3tools/contracts";

import type { ResolvedProjectScope } from "../projectScope.logic";
import { ALL_PROJECTS, projectScopeKey } from "../workBoard.logic";

const FEED_HEADINGS: ReadonlyArray<{ readonly state: RoomFeedState; readonly title: string }> = [
  { state: "yours", title: "Waiting on you" },
  { state: "ready", title: "Ready to look at" },
  { state: "moving", title: "Moving" },
];

export interface FeedSection {
  readonly state: RoomFeedState;
  readonly title: string;
  readonly rows: ReadonlyArray<RoomFeedRow>;
}

/** The rooms of the sidebar's scope: every project, one project, or a project set's. */
export function feedInScope(
  rows: ReadonlyArray<RoomFeedRow>,
  { scope, members }: Pick<ResolvedProjectScope, "scope" | "members">,
): ReadonlyArray<RoomFeedRow> {
  return rows.filter((row) => {
    const key = projectScopeKey({ workspace: row.workspace, projectId: row.project });
    return members === undefined
      ? scope === ALL_PROJECTS || key === scope
      : members.some((member) => member.scope === key);
  });
}

/** The headed lists that hold a row, each in the order `roomFeed` gave. */
export function feedSections(rows: ReadonlyArray<RoomFeedRow>): ReadonlyArray<FeedSection> {
  return FEED_HEADINGS.flatMap(({ state, title }) => {
    const held = rows.filter((row) => row.state === state);
    return held.length === 0 ? [] : [{ state, title, rows: held }];
  });
}

/** Who wrote last in a room: a person, or a person's agent. */
export function feedAuthor(status: PeerHubStatus, row: RoomFeedRow): string | undefined {
  if (row.author === undefined) return undefined;
  const name = personName(status, row.workspace, row.author.email);
  return row.author.run === undefined ? name : `${name}'s agent`;
}
